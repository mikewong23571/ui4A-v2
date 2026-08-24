import { describe, expect, it } from 'vitest';

interface RestoreArtifact {
  kind: 'database' | 'runtime' | 'realm' | 'pki' | 'private-config';
  ref: string;
  digest: string;
  actualDigest: string;
  entryType: 'file' | 'directory' | 'symlink' | 'device';
}

interface RestoreInput {
  backupId: string;
  backupState: 'incomplete' | 'completed';
  source: { environmentId: string; postgresMajor: number; root: string };
  target: { environmentId: string; postgresMajor: number; root: string; exists: boolean };
  artifacts: RestoreArtifact[];
}

interface RestorePlan {
  schemaVersion: 1;
  backupId: string;
  mode: 'isolated';
  destructive: false;
  useCleanRestore: false;
  target: RestoreInput['target'];
  phases: [
    'verify-manifest',
    'allocate-isolated-target',
    'restore-databases',
    'restore-private-files',
    'rebuild-projections',
    'verify-fingerprints',
  ];
}

interface RestoreContractModule {
  planIsolatedRestore(input: RestoreInput): RestorePlan;
}

const plannedModulePath = './t22-restore-contract';

async function plannedApi(): Promise<RestoreContractModule> {
  return (await import(plannedModulePath)) as RestoreContractModule;
}

const SHA = `sha256:${'a'.repeat(64)}`;

function completeArtifacts(): RestoreArtifact[] {
  return [
    'databases/ui4a.dump',
    'databases/keycloak.dump',
    'databases/temporal.dump',
    'databases/temporal_visibility.dump',
    'runtime/coding/run-1.tar',
    'runtime/writing/run-2.tar',
    'runtime/authoring/run-3.tar',
    'identity/realm-import.json',
    'identity/deployment-bindings.json',
    'private/pki.tar',
    'private/deployment-secrets.tar',
  ].map((ref) => ({
    kind: ref.startsWith('databases/')
      ? 'database'
      : ref.startsWith('runtime/')
        ? 'runtime'
        : ref.startsWith('identity/')
          ? 'realm'
          : ref.endsWith('pki.tar')
            ? 'pki'
            : 'private-config',
    ref,
    digest: SHA,
    actualDigest: SHA,
    entryType: 'file',
  })) as RestoreArtifact[];
}

function restoreInput(overrides: Partial<RestoreInput> = {}): RestoreInput {
  return {
    backupId: 'ui4a-v0.1.0-experimental.1-compose-20260824T120102Z-abcdef0',
    backupState: 'completed',
    source: { environmentId: 'compose-main', postgresMajor: 17, root: '/srv/ui4a' },
    target: {
      environmentId: 'compose-restore-fixture',
      postgresMajor: 17,
      root: '/srv/ui4a-restore-fixture',
      exists: false,
    },
    artifacts: completeArtifacts(),
    ...overrides,
  };
}

describe('T22 isolated restore contract', () => {
  it('plans a non-destructive isolated restore with verification before mutation', async () => {
    const { planIsolatedRestore } = await plannedApi();

    expect(planIsolatedRestore(restoreInput())).toEqual({
      schemaVersion: 1,
      backupId: 'ui4a-v0.1.0-experimental.1-compose-20260824T120102Z-abcdef0',
      mode: 'isolated',
      destructive: false,
      useCleanRestore: false,
      target: {
        environmentId: 'compose-restore-fixture',
        postgresMajor: 17,
        root: '/srv/ui4a-restore-fixture',
        exists: false,
      },
      phases: [
        'verify-manifest',
        'allocate-isolated-target',
        'restore-databases',
        'restore-private-files',
        'rebuild-projections',
        'verify-fingerprints',
      ],
    });
  });

  it.each([
    [
      'in-place environment',
      () => restoreInput({ target: { ...restoreInput().target, environmentId: 'compose-main' } }),
      'RESTORE_IN_PLACE_FORBIDDEN',
    ],
    [
      'in-place root',
      () => restoreInput({ target: { ...restoreInput().target, root: '/srv/ui4a' } }),
      'RESTORE_IN_PLACE_FORBIDDEN',
    ],
    [
      'existing target',
      () => restoreInput({ target: { ...restoreInput().target, exists: true } }),
      'RESTORE_TARGET_EXISTS',
    ],
    [
      'wrong PostgreSQL major',
      () => restoreInput({ target: { ...restoreInput().target, postgresMajor: 16 } }),
      'POSTGRES_MAJOR_MISMATCH',
    ],
    ['incomplete backup', () => restoreInput({ backupState: 'incomplete' }), 'BACKUP_INCOMPLETE'],
    [
      'tampered artifact',
      () => {
        const artifacts = completeArtifacts();
        artifacts[0] = { ...artifacts[0]!, actualDigest: `sha256:${'b'.repeat(64)}` };
        return restoreInput({ artifacts });
      },
      'BACKUP_CHECKSUM_MISMATCH',
    ],
    [
      'partial inventory',
      () => restoreInput({ artifacts: completeArtifacts().slice(1) }),
      'BACKUP_INVENTORY_INCOMPLETE',
    ],
    [
      'path traversal',
      () => {
        const artifacts = completeArtifacts();
        artifacts[0] = { ...artifacts[0]!, ref: '../source/ui4a.dump' };
        return restoreInput({ artifacts });
      },
      'ARCHIVE_PATH_UNSAFE',
    ],
    [
      'symlink entry',
      () => {
        const artifacts = completeArtifacts();
        artifacts[4] = { ...artifacts[4]!, entryType: 'symlink' };
        return restoreInput({ artifacts });
      },
      'ARCHIVE_ENTRY_TYPE_UNSAFE',
    ],
    [
      'device entry',
      () => {
        const artifacts = completeArtifacts();
        artifacts[4] = { ...artifacts[4]!, entryType: 'device' };
        return restoreInput({ artifacts });
      },
      'ARCHIVE_ENTRY_TYPE_UNSAFE',
    ],
  ])('rejects %s before restore execution', async (_case, input, code) => {
    const { planIsolatedRestore } = await plannedApi();

    expect(() => planIsolatedRestore(input())).toThrow(expect.objectContaining({ code }));
  });
});
