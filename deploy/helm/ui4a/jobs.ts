import {
  dependencyApiTokenVolume,
  dependencyGates,
  productionEnvironment,
  productionVolumeMounts,
  productionVolumes,
  stateSecretMount,
  stateSecretVolume,
  trustInit,
} from './init-containers';
import type { KubernetesObject, Ui4aHelmValues } from './values';
import {
  container,
  externalHostAliases,
  job,
  metadata,
  podTemplate,
  ui4aNodeSecurityContext,
  vendorNonRootSecurityContext,
} from './workload-helpers';

export function renderJobs(values: Ui4aHelmValues): KubernetesObject[] {
  const namespace = values.namespace.name;
  const postgresHost = `postgres.${namespace}.svc.cluster.local`;
  return [
    job(
      namespace,
      'postgres-bootstrap',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.postgres,
      [
        '/bin/sh',
        '-ec',
        'export PGPASSWORD="$(cat /run/secrets/postgres-bootstrap-password)"; exec psql -v ON_ERROR_STOP=1 -v ui4a_migration_password="$(cat /run/secrets/ui4a-migration-password)" -v ui4a_runtime_password="$(cat /run/secrets/ui4a-runtime-password)" -v keycloak_runtime_password="$(cat /run/secrets/keycloak-database-password)" -v temporal_schema_password="$(cat /run/secrets/temporal-schema-password)" -v temporal_runtime_password="$(cat /run/secrets/temporal-runtime-password)" -v postgres_backup_password="$(cat /run/secrets/postgres-backup-password)" -f /opt/ui4a/bootstrap-roles.sql',
      ],
      {
        env: [
          { name: 'PGHOST', value: 'postgres' },
          { name: 'PGDATABASE', value: 'postgres' },
          { name: 'PGUSER', value: 'postgres' },
          { name: 'PGPASSWORD_FILE', value: '/run/secrets/postgres-bootstrap-password' },
        ],
        volumeMounts: [
          { name: 'bootstrap-sql', mountPath: '/opt/ui4a', readOnly: true },
          stateSecretMount,
        ],
        securityContext: vendorNonRootSecurityContext(70, 70),
      },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(values, ['postgres'], false, values.images.adminWorker),
        volumes: [
          { name: 'bootstrap-sql', configMap: { name: 'ui4a-postgres-bootstrap' } },
          stateSecretVolume(values.secrets.existingSecretName),
        ],
      },
    ),
    job(
      namespace,
      'temporal-schema',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.temporalAdminTools,
      [
        '/bin/sh',
        '-ec',
        'TEMPORAL_SCHEMA_PASSWORD="$(cat /run/secrets/temporal-schema-password)"; temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal setup-schema -v 0.0 && temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned && temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility setup-schema -v 0.0 && exec temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned',
      ],
      {
        volumeMounts: [stateSecretMount],
        securityContext: vendorNonRootSecurityContext(1000, 1000, false),
      },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(
          values,
          ['postgres-bootstrap'],
          true,
          values.images.adminWorker,
        ),
        volumes: [stateSecretVolume(values.secrets.existingSecretName), dependencyApiTokenVolume()],
      },
    ),
    job(
      namespace,
      'temporal-namespace',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.temporalAdminTools,
      [
        '/bin/sh',
        '-ec',
        'temporal operator namespace describe --namespace ui4a --address temporal:7233 >/dev/null 2>&1 || exec temporal operator namespace create --namespace ui4a --address temporal:7233 --retention 72h',
      ],
      { securityContext: vendorNonRootSecurityContext(1000, 1000) },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(values, ['temporal'], false, values.images.adminWorker),
      },
    ),
    job(
      namespace,
      'pki-init',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.pkiRunner,
      ['node', 'dist/main.js', 'pki-init'],
      {
        env: [
          { name: 'UI4A_DEPLOYMENT_PROFILE', value: 'production' },
          { name: 'UI4A_DEPLOYMENT_SETTINGS_FILE', value: '/run/ui4a/settings.json' },
          {
            name: 'UI4A_DEPLOYMENT_SECRETS_FILE',
            value: '/run/secrets/ui4a-deployment-secrets',
          },
          { name: 'UI4A_PKI_ROOT', value: '/var/lib/ui4a/ca' },
          { name: 'UI4A_HOST', value: values.hosts.web },
          { name: 'KEYCLOAK_HOST', value: values.hosts.keycloak },
          { name: 'UI4A_POSTGRES_HOST', value: postgresHost },
        ],
        volumeMounts: [
          ...productionVolumeMounts.filter(({ name }) => name !== 'pki-data'),
          { name: 'pki-data', mountPath: '/var/lib/ui4a/ca' },
          { name: 'tmp', mountPath: '/tmp' },
        ],
      },
      {
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
        ],
      },
    ),
    job(
      namespace,
      'migration',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.adminWorker,
      ['node', 'dist/t22-migrate.js'],
      {
        env: productionEnvironment(),
        volumeMounts: [...productionVolumeMounts, { name: 'tmp', mountPath: '/tmp' }],
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [
          trustInit(values, values.images.pkiRunner),
          ...dependencyGates(
            values,
            ['postgres-bootstrap', 'pki-init'],
            false,
            values.images.adminWorker,
          ),
        ],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
        ],
      },
    ),
    job(
      namespace,
      'realm-bootstrap',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.adminWorker,
      ['node', 'dist/t22-keycloak-realm-bootstrap.js', '--apply'],
      {
        env: productionEnvironment([
          { name: 'UI4A_REALM_IMPORT_FILE', value: '/opt/ui4a/realm-import.json' },
        ]),
        volumeMounts: [
          ...productionVolumeMounts,
          { name: 'tmp', mountPath: '/tmp' },
          {
            name: 'realm-import',
            mountPath: '/opt/ui4a/realm-import.json',
            subPath: 'realm-import.json',
            readOnly: true,
          },
        ],
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [
          trustInit(values, values.images.pkiRunner),
          ...dependencyGates(values, ['keycloak', 'pki-init'], false, values.images.adminWorker),
        ],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
          { name: 'realm-import', configMap: { name: 'ui4a-realm-import' } },
        ],
      },
    ),
  ];
}

export function renderBackupCronJob(values: Ui4aHelmValues): KubernetesObject {
  const namespace = values.namespace.name;
  const secretEnvironment = {
    envFrom: [{ secretRef: { name: values.secrets.existingSecretName } }],
  };
  return {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: metadata('backup', namespace),
    spec: {
      schedule: values.backup.schedule,
      concurrencyPolicy: 'Forbid',
      suspend: true,
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 2,
          template: podTemplate(
            'backup',
            values.serviceAccounts.backup,
            values.scheduling.nodeSelector,
            [
              container('backup', values.images.postgres, {
                ...secretEnvironment,
                command: ['pg_dump', '--format=custom', '--file=/backups/ui4a.dump', 'ui4a'],
                volumeMounts: [{ name: 'backup-data', mountPath: '/backups' }],
                securityContext: vendorNonRootSecurityContext(70, 70),
              }),
            ],
            {
              restartPolicy: 'Never',
              volumes: [
                { name: 'backup-data', persistentVolumeClaim: { claimName: 'backup-data' } },
              ],
            },
          ),
        },
      },
    },
  };
}
