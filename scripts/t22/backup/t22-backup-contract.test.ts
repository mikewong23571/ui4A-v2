import { describe, expect, it } from 'vitest';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type DeploymentEnvironment = 'compose' | 'kubernetes';
type BackupState = 'incomplete' | 'completed';

interface QuiescenceReceipt {
  verified: true;
  quiescedAt: string;
  eventHighWaterMark: number;
  stopped: {
    web: true;
    worker: true;
    runner: true;
    keycloak: true;
    temporal: true;
  };
}

interface BackupArtifact {
  kind: 'database' | 'runtime' | 'realm' | 'pki' | 'private-config';
  ref: string;
  digest: string;
  bytes: number;
  private: boolean;
}

interface BackupManifest {
  schemaVersion: 1;
  backupId: string;
  state: BackupState;
  release: 'v0.1.0-experimental.1';
  gitSha: string;
  environment: DeploymentEnvironment;
  postgresMajor: 17;
  startedAt: string;
  finishedAt?: string;
  singleReplica: true;
  ha: false;
  strategy: 'quiesced-pg-dump';
  quiescenceReceipt: QuiescenceReceipt;
  artifacts: BackupArtifact[];
  checksums: Record<string, string>;
}

interface BackupPlan {
  backupId: string;
  stagingDirectoryName: string;
  completedDirectoryName: string;
  manifest: BackupManifest;
}

interface BackupContractModule {
  createBackupPlan(input: {
    release: 'v0.1.0-experimental.1';
    gitSha: string;
    environment: DeploymentEnvironment;
    startedAt: string;
    postgresMajor: 17;
    quiescenceReceipt: QuiescenceReceipt;
  }): BackupPlan;
  completeBackup(input: {
    plan: BackupPlan;
    finishedAt: string;
    artifacts: BackupArtifact[];
  }): BackupManifest;
}

const plannedModulePath = './t22-backup-contract';

async function plannedApi(): Promise<BackupContractModule> {
  return (await import(plannedModulePath)) as BackupContractModule;
}

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const QUIESCENCE_RECEIPT: QuiescenceReceipt = {
  verified: true,
  quiescedAt: '2026-08-24T12:00:59.000Z',
  eventHighWaterMark: 42,
  stopped: {
    web: true,
    worker: true,
    runner: true,
    keycloak: true,
    temporal: true,
  },
};

function artifact(
  kind: BackupArtifact['kind'],
  ref: string,
  digest: string,
  privateArtifact = false,
): BackupArtifact {
  return { kind, ref, digest, bytes: 1_024, private: privateArtifact };
}

describe('T22 named backup contract', () => {
  it('derives one deterministic, filesystem-safe backup id and incomplete staging name', async () => {
    const { createBackupPlan } = await plannedApi();

    const plan = createBackupPlan({
      release: 'v0.1.0-experimental.1',
      gitSha: 'abcdef0123456789',
      environment: 'kubernetes',
      startedAt: '2026-08-24T12:01:02.000Z',
      postgresMajor: 17,
      quiescenceReceipt: QUIESCENCE_RECEIPT,
    });

    expect(plan).toMatchObject({
      backupId: 'ui4a-v0.1.0-experimental.1-kubernetes-20260824T120102Z-abcdef0',
      stagingDirectoryName:
        'ui4a-v0.1.0-experimental.1-kubernetes-20260824T120102Z-abcdef0.incomplete',
      completedDirectoryName: 'ui4a-v0.1.0-experimental.1-kubernetes-20260824T120102Z-abcdef0',
      manifest: {
        schemaVersion: 1,
        state: 'incomplete',
        singleReplica: true,
        ha: false,
        strategy: 'quiesced-pg-dump',
        quiescenceReceipt: QUIESCENCE_RECEIPT,
        artifacts: [],
        checksums: {},
      },
    });
    expect(plan.backupId).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('completes only a full four-database, Runtime, realm, PKI, and private-ref inventory', async () => {
    const { completeBackup, createBackupPlan } = await plannedApi();
    const plan = createBackupPlan({
      release: 'v0.1.0-experimental.1',
      gitSha: 'abcdef0123456789',
      environment: 'compose',
      startedAt: '2026-08-24T12:01:02.000Z',
      postgresMajor: 17,
      quiescenceReceipt: QUIESCENCE_RECEIPT,
    });
    const artifacts = [
      artifact('database', 'databases/ui4a.dump', SHA_A, true),
      artifact('database', 'databases/keycloak.dump', SHA_B, true),
      artifact('database', 'databases/temporal.dump', SHA_C, true),
      artifact('database', 'databases/temporal_visibility.dump', SHA_D, true),
      artifact('runtime', 'runtime/coding/run-1.tar', SHA_A, true),
      artifact('runtime', 'runtime/writing/run-2.tar', SHA_B, true),
      artifact('runtime', 'runtime/authoring/run-3.tar', SHA_C, true),
      artifact('realm', 'identity/realm-import.json', SHA_D),
      artifact('realm', 'identity/deployment-bindings.json', SHA_A),
      artifact('pki', 'private/pki.tar', SHA_B, true),
      artifact('private-config', 'private/deployment-secrets.tar', SHA_C, true),
    ];

    const manifest = completeBackup({
      plan,
      finishedAt: '2026-08-24T12:04:05.000Z',
      artifacts,
    });

    expect(manifest.state).toBe('completed');
    expect(manifest.finishedAt).toBe('2026-08-24T12:04:05.000Z');
    expect(manifest.artifacts.map(({ ref }) => ref)).toEqual(
      [...artifacts.map(({ ref }) => ref)].sort(),
    );
    expect(manifest.checksums).toEqual(
      Object.fromEntries(artifacts.map(({ ref, digest }) => [ref, digest]).sort()),
    );
    expect(manifest.artifacts.filter(({ kind }) => kind === 'database')).toHaveLength(4);
  });

  it('whitelists refs and digests without copying Secret material into manifest JSON', async () => {
    const { createBackupPlan } = await plannedApi();
    const secret = '__backup_secret_must_not_escape__';
    const input = {
      release: 'v0.1.0-experimental.1' as const,
      gitSha: 'abcdef0123456789',
      environment: 'compose' as const,
      startedAt: '2026-08-24T12:01:02.000Z',
      postgresMajor: 17 as const,
      quiescenceReceipt: QUIESCENCE_RECEIPT,
      databasePassword: secret,
      rootCaPrivateKey: secret,
    };

    const plan = createBackupPlan(input);

    expect(JSON.stringify(plan)).not.toContain(secret);
    expect(plan.manifest).not.toHaveProperty('databasePassword');
    expect(plan.manifest).not.toHaveProperty('rootCaPrivateKey');
  });

  it('requires the versioned manifest schema to encode verified quiescence before backup', async () => {
    const schema = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, '../../../deploy/backup/backup-manifest.schema.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(schema).toMatchObject({
      required: expect.arrayContaining(['strategy', 'quiescenceReceipt']),
      properties: {
        strategy: { const: 'quiesced-pg-dump' },
        quiescenceReceipt: {
          type: 'object',
          additionalProperties: false,
          required: ['verified', 'quiescedAt', 'eventHighWaterMark', 'stopped'],
          properties: {
            verified: { const: true },
            quiescedAt: { type: 'string', format: 'date-time' },
            eventHighWaterMark: { type: 'integer', minimum: 0 },
            stopped: {
              required: ['web', 'worker', 'runner', 'keycloak', 'temporal'],
              properties: {
                web: { const: true },
                worker: { const: true },
                runner: { const: true },
                keycloak: { const: true },
                temporal: { const: true },
              },
            },
          },
        },
      },
    });
  });
});
