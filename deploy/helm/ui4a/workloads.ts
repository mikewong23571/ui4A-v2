import {
  dependencyApiTokenVolume,
  dependencyGates,
  productionEnvironment,
  productionVolumeMounts,
  productionVolumes,
  trustInit,
} from './init-containers';
import type { KubernetesObject, Ui4aHelmValues } from './values';
import {
  container,
  deployment,
  externalHostAliases,
  grpcProbe,
  httpProbe,
  metadata,
  podTemplate,
  POSTGRES_17_ALPINE_IDENTITY,
  selector,
  tcpProbe,
  ui4aNodeSecurityContext,
  vendorNonRootSecurityContext,
} from './workload-helpers';

export function renderPostgresStatefulSet(values: Ui4aHelmValues): KubernetesObject {
  const namespace = values.namespace.name;
  const postgresHost = `postgres.${namespace}.svc.cluster.local`;
  return {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: metadata('postgres', namespace),
    spec: {
      replicas: 1,
      serviceName: 'postgres',
      selector: { matchLabels: selector('postgres') },
      template: podTemplate(
        'postgres',
        values.serviceAccounts.postgres,
        values.scheduling.nodeSelector,
        [
          container('postgres', values.images.postgres, {
            args: [
              '-c',
              'ssl=on',
              '-c',
              'ssl_cert_file=/var/run/ui4a/postgres-tls/server.crt',
              '-c',
              'ssl_key_file=/var/run/ui4a/postgres-tls/server.key',
              '-c',
              'ssl_ca_file=/var/run/ui4a/postgres-tls/root-ca.crt',
            ],
            env: [
              { name: 'POSTGRES_USER', value: 'postgres' },
              { name: 'POSTGRES_DB', value: 'postgres' },
              {
                name: 'POSTGRES_PASSWORD_FILE',
                value: '/run/secrets/postgres-bootstrap-password',
              },
            ],
            ports: [{ name: 'postgres', containerPort: 5432 }],
            volumeMounts: [
              { name: 'postgres-data', mountPath: '/var/lib/postgresql/data' },
              { name: 'backup-data', mountPath: '/backups' },
              { name: 'postgres-run', mountPath: '/run/postgresql' },
              { name: 'tmp', mountPath: '/tmp' },
              {
                name: 'postgres-tls',
                mountPath: '/var/run/ui4a/postgres-tls',
                readOnly: true,
              },
              {
                name: 'postgres-bootstrap-password',
                mountPath: '/run/secrets/postgres-bootstrap-password',
                subPath: 'postgres-bootstrap-password',
                readOnly: true,
              },
            ],
            livenessProbe: { exec: { command: ['pg_isready', '-U', 'postgres'] } },
            readinessProbe: tcpProbe(5432),
            securityContext: {
              allowPrivilegeEscalation: false,
              runAsUser: 0,
              capabilities: {
                drop: ['ALL'],
                add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID'],
              },
              readOnlyRootFilesystem: true,
            },
          }),
        ],
        {
          securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
          initContainers: [
            container('postgres-tls-handoff', values.images.runner, {
              command: [
                '/bin/sh',
                '-ec',
                [
                  'set -eu',
                  'root=/var/lib/ui4a/ca/root-ca.crt',
                  'cert=/var/lib/ui4a/ca/postgres/server.crt',
                  'key=/var/lib/ui4a/ca/postgres/server.key',
                  `openssl x509 -in "$cert" -noout -checkhost ${postgresHost}`,
                  'openssl verify -CAfile "$root" "$cert"',
                  'openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER > /tmp/cert.pub',
                  'openssl pkey -in "$key" -pubout -outform DER > /tmp/key.pub',
                  'cmp /tmp/cert.pub /tmp/key.pub',
                  `install -o ${POSTGRES_17_ALPINE_IDENTITY.uid} -g ${POSTGRES_17_ALPINE_IDENTITY.gid} -m 0644 "$root" /var/run/ui4a/postgres-tls/root-ca.crt`,
                  `install -o ${POSTGRES_17_ALPINE_IDENTITY.uid} -g ${POSTGRES_17_ALPINE_IDENTITY.gid} -m 0644 "$cert" /var/run/ui4a/postgres-tls/server.crt`,
                  `install -o ${POSTGRES_17_ALPINE_IDENTITY.uid} -g ${POSTGRES_17_ALPINE_IDENTITY.gid} -m 0600 "$key" /var/run/ui4a/postgres-tls/server.key`,
                  'chmod 0600 /var/run/ui4a/postgres-tls/server.key',
                  'test "$(stat -c %a /var/run/ui4a/postgres-tls/server.key)" = 600',
                ].join('; '),
              ],
              volumeMounts: [
                { name: 'pki-data', mountPath: '/var/lib/ui4a/ca', readOnly: true },
                { name: 'postgres-tls', mountPath: '/var/run/ui4a/postgres-tls' },
                { name: 'tls-handoff-tmp', mountPath: '/tmp' },
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                runAsUser: 0,
                capabilities: { drop: ['ALL'], add: ['CHOWN', 'DAC_READ_SEARCH', 'FOWNER'] },
                readOnlyRootFilesystem: true,
              },
            }),
          ],
          volumes: [
            { name: 'postgres-data', persistentVolumeClaim: { claimName: 'postgres-data' } },
            { name: 'backup-data', persistentVolumeClaim: { claimName: 'backup-data' } },
            { name: 'pki-data', persistentVolumeClaim: { claimName: 'pki-data' } },
            { name: 'postgres-tls', emptyDir: {} },
            { name: 'tls-handoff-tmp', emptyDir: {} },
            { name: 'postgres-run', emptyDir: {} },
            { name: 'tmp', emptyDir: {} },
            {
              name: 'postgres-bootstrap-password',
              secret: {
                secretName: values.secrets.existingSecretName,
                items: [
                  {
                    key: 'postgres-bootstrap-password',
                    path: 'postgres-bootstrap-password',
                  },
                ],
              },
            },
          ],
        },
      ),
    },
  };
}

export function renderDeployments(values: Ui4aHelmValues): KubernetesObject[] {
  const namespace = values.namespace.name;
  const keycloakPublicOrigin = new URL(values.istio.oidcIssuer).origin;
  return [
    deployment(
      namespace,
      'temporal',
      values.serviceAccounts.temporal,
      values.scheduling.nodeSelector,
      values.images.temporal,
      {
        command: ['/bin/sh', '-ec'],
        args: ['exec temporal-server --root /etc/temporal --config config --env docker start'],
        ports: [{ name: 'grpc', containerPort: 7233 }],
        volumeMounts: [
          {
            name: 'temporal-static-config',
            mountPath: '/etc/temporal/config/docker.yaml',
            subPath: 'docker.yaml',
            readOnly: true,
          },
          {
            name: 'temporal-dynamic-config',
            mountPath: '/etc/temporal/dynamicconfig/docker.yaml',
            subPath: 'docker.yaml',
            readOnly: true,
          },
          {
            name: 'temporal-runtime-password',
            mountPath: '/run/secrets/temporal-runtime-password',
            subPath: 'temporal-runtime-password',
            readOnly: true,
          },
          { name: 'tmp', mountPath: '/tmp' },
        ],
        livenessProbe: grpcProbe(7233, 20),
        readinessProbe: grpcProbe(7233, 5),
        securityContext: vendorNonRootSecurityContext(1000, 1000, false),
      },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(values, ['temporal-schema'], true),
        volumes: [
          { name: 'temporal-static-config', configMap: { name: 'ui4a-temporal-static' } },
          { name: 'temporal-dynamic-config', configMap: { name: 'ui4a-temporal-dynamic' } },
          {
            name: 'temporal-runtime-password',
            secret: {
              secretName: values.secrets.existingSecretName,
              items: [{ key: 'temporal-runtime-password', path: 'temporal-runtime-password' }],
            },
          },
          { name: 'tmp', emptyDir: {} },
          dependencyApiTokenVolume(),
        ],
      },
      { 'proxy.istio.io/config': '{"holdApplicationUntilProxyStarts":true}' },
    ),
    deployment(
      namespace,
      'temporal-ui',
      values.serviceAccounts.temporal,
      values.scheduling.nodeSelector,
      values.images.temporalUi,
      {
        env: [{ name: 'TEMPORAL_ADDRESS', value: 'temporal:7233' }],
        ports: [{ name: 'http', containerPort: 8080 }],
        volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
        livenessProbe: httpProbe('/', 8080),
        readinessProbe: tcpProbe(8080),
        securityContext: vendorNonRootSecurityContext(1000, 1000),
      },
      {
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        initContainers: dependencyGates(values, ['temporal']),
        volumes: [{ name: 'tmp', emptyDir: {} }],
      },
    ),
    deployment(
      namespace,
      'keycloak',
      values.serviceAccounts.keycloak,
      values.scheduling.nodeSelector,
      values.images.keycloak,
      {
        env: [
          { name: 'KC_DB', value: 'postgres' },
          { name: 'KC_DB_URL_HOST', value: 'postgres' },
          { name: 'KC_DB_URL_DATABASE', value: 'keycloak' },
          { name: 'KC_DB_USERNAME', value: 'keycloak_runtime' },
          { name: 'KC_HEALTH_ENABLED', value: 'true' },
          { name: 'KC_HTTP_ENABLED', value: 'true' },
          { name: 'KC_PROXY_HEADERS', value: 'xforwarded' },
          { name: 'KC_HOSTNAME', value: keycloakPublicOrigin },
          {
            name: 'KC_DB_PASSWORD',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'keycloak-database-password',
              },
            },
          },
          { name: 'KC_BOOTSTRAP_ADMIN_USERNAME', value: 'ui4a-bootstrap' },
          {
            name: 'KC_BOOTSTRAP_ADMIN_PASSWORD',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'keycloak-bootstrap-admin-password',
              },
            },
          },
        ],
        args: ['start'],
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ['ALL'] },
          readOnlyRootFilesystem: false,
        },
        ports: [{ name: 'http', containerPort: 8080 }],
        volumeMounts: [
          { name: 'tmp', mountPath: '/tmp' },
          { name: 'keycloak-data', mountPath: '/opt/keycloak/data' },
        ],
        startupProbe: {
          httpGet: { path: '/health/started', port: 9000 },
          periodSeconds: 5,
          timeoutSeconds: 3,
          failureThreshold: 60,
        },
        livenessProbe: httpProbe('/health/live', 9000),
        readinessProbe: httpProbe('/health/ready', 9000),
      },
      {
        automountServiceAccountToken: true,
        initContainers: dependencyGates(values, ['postgres-bootstrap', 'pki-init']),
        volumes: [
          { name: 'tmp', emptyDir: {} },
          { name: 'keycloak-data', emptyDir: {} },
        ],
      },
    ),
    deployment(
      namespace,
      'web',
      values.serviceAccounts.web,
      values.scheduling.nodeSelector,
      values.images.web,
      {
        env: productionEnvironment([
          { name: 'UI4A_PUBLIC_BASE_URL', value: 'http://web:3100' },
          {
            name: 'UI4A_CAPABILITY_CALLBACK_TOKEN',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'capability-callback-token',
              },
            },
          },
        ]),
        volumeMounts: [
          ...productionVolumeMounts,
          { name: 'tmp', mountPath: '/tmp' },
          { name: 'next-cache', mountPath: '/app/apps/web/.next/cache' },
        ],
        ports: [{ name: 'http', containerPort: 3100 }],
        livenessProbe: httpProbe('/live', 3100),
        readinessProbe: httpProbe('/ready', 3100),
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [
          trustInit(values),
          ...dependencyGates(values, [
            'migration',
            'realm-bootstrap',
            'temporal-namespace',
            'pki-init',
          ]),
        ],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
          { name: 'next-cache', emptyDir: {} },
        ],
      },
    ),
    deployment(
      namespace,
      'worker',
      values.serviceAccounts.worker,
      values.scheduling.nodeSelector,
      values.images.worker,
      {
        env: productionEnvironment([
          { name: 'UI4A_PUBLIC_BASE_URL', value: 'http://web:3100' },
          { name: 'UI4A_RUNNER_IMAGE', value: values.images.runner },
          {
            name: 'UI4A_KUBERNETES_SETTINGS_CONFIGMAP',
            value: 'ui4a-deployment-settings',
          },
          {
            name: 'UI4A_KUBERNETES_SECRETS_SECRET',
            value: values.secrets.runnerExistingSecretName,
          },
          { name: 'UI4A_KUBERNETES_SECRETS_KEY', value: values.secrets.runnerSecretsKey },
          { name: 'UI4A_KUBERNETES_WORKSPACE_CLAIM', value: 'runtime-data' },
          {
            name: 'UI4A_KUBERNETES_RUNNER_SERVICE_ACCOUNT',
            value: values.serviceAccounts.runner,
          },
          {
            name: 'UI4A_CAPABILITY_CALLBACK_TOKEN',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'capability-callback-token',
              },
            },
          },
        ]),
        volumeMounts: [
          ...productionVolumeMounts,
          { name: 'tmp', mountPath: '/tmp' },
          { name: 'worker-state', mountPath: '/var/lib/ui4a' },
          { name: 'runtime-data', mountPath: '/workspaces' },
        ],
        ports: [{ name: 'http', containerPort: 3101 }],
        livenessProbe: httpProbe('/live', 3101),
        readinessProbe: httpProbe('/ready', 3101),
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [
          trustInit(values),
          ...dependencyGates(values, ['migration', 'realm-bootstrap', 'temporal-namespace']),
        ],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
          { name: 'worker-state', emptyDir: {} },
          { name: 'runtime-data', persistentVolumeClaim: { claimName: 'runtime-data' } },
        ],
      },
    ),
  ];
}
