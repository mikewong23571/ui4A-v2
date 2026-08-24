import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const statefulContractPath = 'deploy/postgres/stateful-contract.json';
const deploymentBindingsPath = 'deploy/postgres/deployment-bindings.json';
const backupContractPath = 'deploy/postgres/backup-contract.json';
const roleBootstrapPath = 'deploy/postgres/bootstrap-roles.sql';

interface RoleContract {
  id: string;
  purpose: string;
  login: boolean;
  databaseScope: string[];
  ddl: boolean;
  dml: boolean;
  truncate: boolean;
  replication: boolean;
  readOnly?: boolean;
  availableToRuntime: boolean;
}

interface StatefulContract {
  schemaVersion: 1;
  topology: {
    postgresMajor: 17;
    instances: 1;
    replicas: 1;
    highAvailability: false;
    imageDigestRequired: true;
  };
  databases: Array<{
    name: string;
    ownerRole: string;
    runtimeRole: string;
  }>;
  roles: RoleContract[];
  tls: {
    required: true;
    clientMode: 'verify-full';
    serverCertificateRequired: true;
    clientCaRequired: true;
  };
  storage: {
    data: { accessMode: 'ReadWriteOnce'; reclaimPolicy: 'Retain' };
    backup: { accessMode: 'ReadWriteOnce'; reclaimPolicy: 'Retain' };
    separateClaimsRequired: true;
  };
}

interface DeploymentBindings {
  schemaVersion: 1;
  statefulContractRef: string;
  backupContractRef: string;
  roleBootstrap: {
    sqlRef: string;
    secretBindings: Array<{ variable: string; secretRef: string }>;
  };
  compose: {
    replicas: 1;
    publishedDatabasePort: false;
    dataVolume: { kind: 'named-volume'; mountPath: '/var/lib/postgresql/data' };
    backupVolume: { kind: 'named-volume'; mountPath: '/backups' };
  };
  kubernetes: {
    replicas: 1;
    dataClaim: {
      kind: 'PersistentVolumeClaim';
      accessMode: 'ReadWriteOnce';
      storageClassSource: 'deployment-values';
    };
    backupClaim: {
      kind: 'PersistentVolumeClaim';
      accessMode: 'ReadWriteOnce';
      storageClassSource: 'deployment-values';
    };
    localPathSource: 'overlay-required';
    nodeAffinitySource: 'overlay-required';
  };
}

interface BackupContract {
  schemaVersion: 1;
  strategy: 'quiesced-pg-dump';
  postgresMajor: 17;
  imageDigestRequired: true;
  role: 'postgres-backup';
  targetStorage: 'backup';
  quiescence: {
    receiptRequired: true;
    requiredStoppedServices: ['web', 'worker', 'runner', 'keycloak', 'temporal'];
    eventHighWaterMarkRequired: true;
  };
  databaseBackup: {
    tool: 'pg_dump';
    format: 'custom';
    databases: ['ui4a', 'keycloak', 'temporal', 'temporal_visibility'];
  };
  job: {
    dedicatedServiceAccount: true;
    automountServiceAccountToken: false;
    restartPolicy: 'Never';
    backoffLimit: 0;
    activeDeadlineSeconds: number;
    resourcesRequired: true;
    credentialSource: 'secret-ref';
    caMountReadOnly: true;
  };
  cronJob: {
    concurrencyPolicy: 'Forbid';
    suspendByDefault: true;
    successfulJobsHistoryLimit: number;
    failedJobsHistoryLimit: number;
  };
  output: {
    atomicCompletionMarker: true;
    checksums: 'sha256';
    manifestFields: string[];
  };
  restore: {
    tool: 'pg_restore';
    isolatedTargetRequired: true;
    currentTargetForbidden: true;
    checksumVerificationRequired: true;
    matchingPostgresMajorRequired: true;
  };
}

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing planned T22 PostgreSQL artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

function requiredJson<T>(path: string): T {
  return JSON.parse(requiredSource(path)) as T;
}

function roleById(contract: StatefulContract, id: string): RoleContract {
  const role = contract.roles.find((candidate) => candidate.id === id);
  if (role === undefined) throw new Error(`PostgreSQL contract is missing role ${id}`);
  return role;
}

describe('T22 generic PostgreSQL stateful deployment contract', () => {
  it('pins one non-HA PostgreSQL 17 instance and exactly four isolated databases', () => {
    const contract = requiredJson<StatefulContract>(statefulContractPath);

    expect(contract).toMatchObject({
      schemaVersion: 1,
      topology: {
        postgresMajor: 17,
        instances: 1,
        replicas: 1,
        highAvailability: false,
        imageDigestRequired: true,
      },
    });
    expect(contract.databases).toEqual([
      { name: 'ui4a', ownerRole: 'ui4a-migration', runtimeRole: 'ui4a-runtime' },
      { name: 'keycloak', ownerRole: 'keycloak-runtime', runtimeRole: 'keycloak-runtime' },
      { name: 'temporal', ownerRole: 'temporal-schema', runtimeRole: 'temporal-runtime' },
      {
        name: 'temporal_visibility',
        ownerRole: 'temporal-schema',
        runtimeRole: 'temporal-runtime',
      },
    ]);
    expect(new Set(contract.databases.map(({ name }) => name)).size).toBe(4);
  });

  it('separates bootstrap, migration, runtime, service, and backup authority', () => {
    const contract = requiredJson<StatefulContract>(statefulContractPath);

    expect(contract.roles.map(({ id }) => id).sort()).toEqual(
      [
        'postgres-bootstrap',
        'ui4a-migration',
        'ui4a-runtime',
        'keycloak-runtime',
        'temporal-schema',
        'temporal-runtime',
        'postgres-backup',
      ].sort(),
    );
    expect(roleById(contract, 'postgres-bootstrap')).toMatchObject({
      purpose: 'cluster-bootstrap',
      availableToRuntime: false,
    });
    expect(roleById(contract, 'ui4a-migration')).toMatchObject({
      databaseScope: ['ui4a'],
      ddl: true,
      availableToRuntime: false,
    });
    expect(roleById(contract, 'ui4a-runtime')).toMatchObject({
      databaseScope: ['ui4a'],
      ddl: false,
      dml: true,
      truncate: false,
      replication: false,
      availableToRuntime: true,
    });
    expect(roleById(contract, 'keycloak-runtime').databaseScope).toEqual(['keycloak']);
    expect(roleById(contract, 'temporal-schema')).toMatchObject({
      databaseScope: ['temporal', 'temporal_visibility'],
      ddl: true,
      availableToRuntime: false,
    });
    expect(roleById(contract, 'temporal-runtime')).toMatchObject({
      databaseScope: ['temporal', 'temporal_visibility'],
      ddl: false,
      dml: true,
      truncate: false,
      availableToRuntime: true,
    });
    expect(roleById(contract, 'postgres-backup')).toMatchObject({
      databaseScope: ['ui4a', 'keycloak', 'temporal', 'temporal_visibility'],
      ddl: false,
      dml: false,
      truncate: false,
      replication: false,
      readOnly: true,
      availableToRuntime: false,
    });
  });

  it('requires verify-full TLS and separate retained data and backup storage', () => {
    const contract = requiredJson<StatefulContract>(statefulContractPath);

    expect(contract.tls).toEqual({
      required: true,
      clientMode: 'verify-full',
      serverCertificateRequired: true,
      clientCaRequired: true,
    });
    expect(contract.storage).toEqual({
      data: { accessMode: 'ReadWriteOnce', reclaimPolicy: 'Retain' },
      backup: { accessMode: 'ReadWriteOnce', reclaimPolicy: 'Retain' },
      separateClaimsRequired: true,
    });
  });

  it('maps one contract to Compose named volumes and configurable Kubernetes PVCs', () => {
    const bindings = requiredJson<DeploymentBindings>(deploymentBindingsPath);

    expect(bindings).toEqual({
      schemaVersion: 1,
      statefulContractRef: statefulContractPath,
      backupContractRef: backupContractPath,
      roleBootstrap: {
        sqlRef: roleBootstrapPath,
        secretBindings: [
          {
            variable: 'ui4a_migration_password',
            secretRef: 'settings.postgres.migrationPasswordRef',
          },
          {
            variable: 'ui4a_runtime_password',
            secretRef: 'settings.postgres.runtimePasswordRef',
          },
          {
            variable: 'keycloak_runtime_password',
            secretRef: 'settings.keycloak.databasePasswordRef',
          },
          {
            variable: 'temporal_schema_password',
            secretRef: 'deploymentSecrets.temporal-schema-password',
          },
          {
            variable: 'temporal_runtime_password',
            secretRef: 'deploymentSecrets.temporal-runtime-password',
          },
          {
            variable: 'postgres_backup_password',
            secretRef: 'deploymentSecrets.postgres-backup-password',
          },
        ],
      },
      compose: {
        replicas: 1,
        publishedDatabasePort: false,
        dataVolume: { kind: 'named-volume', mountPath: '/var/lib/postgresql/data' },
        backupVolume: { kind: 'named-volume', mountPath: '/backups' },
      },
      kubernetes: {
        replicas: 1,
        dataClaim: {
          kind: 'PersistentVolumeClaim',
          accessMode: 'ReadWriteOnce',
          storageClassSource: 'deployment-values',
        },
        backupClaim: {
          kind: 'PersistentVolumeClaim',
          accessMode: 'ReadWriteOnce',
          storageClassSource: 'deployment-values',
        },
        localPathSource: 'overlay-required',
        nodeAffinitySource: 'overlay-required',
      },
    });

    const generic = JSON.stringify(bindings);
    expect(generic).not.toMatch(
      /mothership|k8s-(?:cp|w)-|10\.134\.|\/srv\/ui4a|hostnameValue|nodeName/i,
    );
  });

  it('provides idempotent executable role/database bootstrap with Secret variables only', () => {
    const sql = requiredSource(roleBootstrapPath);

    expect(sql).toContain('\\set ON_ERROR_STOP on');
    expect(sql).toContain('\\gexec');
    for (const database of ['ui4a', 'keycloak', 'temporal', 'temporal_visibility']) {
      expect(sql).toMatch(new RegExp(`CREATE DATABASE[^\\n]+${database}`, 'i'));
    }
    for (const role of [
      'ui4a_migration',
      'ui4a_runtime',
      'keycloak_runtime',
      'temporal_schema',
      'temporal_runtime',
      'postgres_backup',
    ]) {
      expect(sql).toContain(role);
    }
    expect(sql).toMatch(/postgres_backup[^\n]+NOREPLICATION/i);
    expect(sql).toMatch(/GRANT SELECT ON ALL TABLES[^\n]+postgres_backup/i);
    expect(sql).toMatch(/GRANT SELECT ON ALL SEQUENCES[^\n]+postgres_backup/i);
    expect(sql.match(/\\connect (?:ui4a|keycloak|temporal|temporal_visibility)/g)).toHaveLength(4);
    expect(
      sql
        .split('\n')
        .filter((line) => line.includes('postgres_backup'))
        .join('\n'),
    ).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]+ui4a_runtime/i);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]+temporal_runtime/i);
    expect(sql).toMatch(/GRANT CONNECT ON DATABASE ui4a TO ui4a_runtime/i);
    expect(sql).toMatch(/GRANT CONNECT ON DATABASE keycloak TO keycloak_runtime/i);
    expect(sql).not.toMatch(/mothership|k8s-(?:cp|w)-|10\.134\.|\/srv\/ui4a/i);
    expect(sql).not.toMatch(/PASSWORD\s+'[^']+'/i);
    expect(sql.match(/PASSWORD\s+:'[a-z0-9_]+'/gi)).toHaveLength(6);
  });

  it('defines bounded secret-backed backup Job and disabled-by-default CronJob semantics', () => {
    const backup = requiredJson<BackupContract>(backupContractPath);

    expect(backup).toMatchObject({
      schemaVersion: 1,
      strategy: 'quiesced-pg-dump',
      postgresMajor: 17,
      imageDigestRequired: true,
      role: 'postgres-backup',
      targetStorage: 'backup',
      quiescence: {
        receiptRequired: true,
        requiredStoppedServices: ['web', 'worker', 'runner', 'keycloak', 'temporal'],
        eventHighWaterMarkRequired: true,
      },
      databaseBackup: {
        tool: 'pg_dump',
        format: 'custom',
        databases: ['ui4a', 'keycloak', 'temporal', 'temporal_visibility'],
      },
      job: {
        dedicatedServiceAccount: true,
        automountServiceAccountToken: false,
        restartPolicy: 'Never',
        backoffLimit: 0,
        activeDeadlineSeconds: expect.any(Number),
        resourcesRequired: true,
        credentialSource: 'secret-ref',
        caMountReadOnly: true,
      },
      cronJob: {
        concurrencyPolicy: 'Forbid',
        suspendByDefault: true,
        successfulJobsHistoryLimit: expect.any(Number),
        failedJobsHistoryLimit: expect.any(Number),
      },
      output: {
        atomicCompletionMarker: true,
        checksums: 'sha256',
      },
      restore: {
        tool: 'pg_restore',
        isolatedTargetRequired: true,
        currentTargetForbidden: true,
        checksumVerificationRequired: true,
        matchingPostgresMajorRequired: true,
      },
    });
    expect(backup.job.activeDeadlineSeconds).toBeGreaterThan(0);
    expect(backup.cronJob.successfulJobsHistoryLimit).toBeGreaterThanOrEqual(0);
    expect(backup.cronJob.failedJobsHistoryLimit).toBeGreaterThanOrEqual(0);
    expect(backup.output.manifestFields.sort()).toEqual(
      [
        'schemaVersion',
        'backupName',
        'releaseVersion',
        'gitSha',
        'postgresMajor',
        'migrationVersion',
        'bootstrapReceipt',
        'quiescenceReceipt',
        'startedAt',
        'completedAt',
        'databases',
        'files',
        'sha256',
        'status',
      ].sort(),
    );
    expect(JSON.stringify(backup)).not.toMatch(
      /"(?:password|secretValue|accessToken|privateKey)"\s*:/i,
    );
  });
});
