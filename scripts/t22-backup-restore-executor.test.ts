import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

interface ProcessCommand {
  executable: 'pg_dump' | 'pg_restore' | 'tar';
  args: string[];
  outputPath?: string;
  environment: Record<string, string>;
}

interface CommandResult {
  exitCode: 0 | 1;
  output: {
    status: 'completed' | 'failed';
    backupId: string;
    manifestPath?: string;
    reasonCode?: string;
  };
}

interface BackupExecutorModule {
  executeBackupCommand(input: {
    outputRoot: string;
    backupId: string;
    manifest: Record<string, unknown>;
    finishedAt: string;
    databaseServices: Record<'ui4a' | 'keycloak' | 'temporal' | 'temporal_visibility', string>;
    pgPassFileRef: string;
    prestagedArtifacts: Array<{ ref: string; content: string }>;
    archiveSources?: Array<{ ref: string; sourceRoot: string; entry: string }>;
    run(command: ProcessCommand): Promise<void>;
  }): Promise<CommandResult>;
}

interface RestoreExecutorModule {
  executeRestoreCommand(input: {
    backupId: string;
    backupRoot: string;
    targetDatabaseServices: Record<
      'ui4a' | 'keycloak' | 'temporal' | 'temporal_visibility',
      string
    >;
    pgPassFileRef: string;
    validatedIsolatedPlan: { mode: 'isolated'; destructive: false; useCleanRestore: false };
    run(command: ProcessCommand): Promise<void>;
  }): Promise<CommandResult>;
}

const backupModulePath = './t22-backup-contract';
const restoreModulePath = './t22-restore-contract';

async function backupApi(): Promise<BackupExecutorModule> {
  return (await import(backupModulePath)) as BackupExecutorModule;
}

async function restoreApi(): Promise<RestoreExecutorModule> {
  return (await import(restoreModulePath)) as RestoreExecutorModule;
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ui4a-backup-contract-'));
  temporaryRoots.push(root);
  return root;
}

const BACKUP_ID = 'ui4a-v0.1.0-experimental.1-compose-20260824T120102Z-abcdef0';
const SERVICES = {
  ui4a: 'ui4a-backup',
  keycloak: 'keycloak-backup',
  temporal: 'temporal-backup',
  temporal_visibility: 'temporal-visibility-backup',
} as const;
const QUIESCENCE_RECEIPT = {
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
} as const;

function incompleteManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    backupId: BACKUP_ID,
    state: 'incomplete',
    release: 'v0.1.0-experimental.1',
    gitSha: 'abcdef0123456789',
    environment: 'compose',
    postgresMajor: 17,
    startedAt: '2026-08-24T12:01:02.000Z',
    singleReplica: true,
    ha: false,
    strategy: 'quiesced-pg-dump',
    quiescenceReceipt: QUIESCENCE_RECEIPT,
    artifacts: [],
    checksums: {},
  };
}

describe('T22 generic backup command seam', () => {
  it('uses controlled pg_dump argv, hashes staged inventory, and atomically completes', async () => {
    const { executeBackupCommand } = await backupApi();
    const outputRoot = await temporaryRoot();
    const archiveSourceRoot = await temporaryRoot();
    await mkdir(join(archiveSourceRoot, 'pki'));
    const commands: ProcessCommand[] = [];
    const run = vi.fn(async (command: ProcessCommand) => {
      commands.push(command);
      await writeFile(command.outputPath!, `dump:${command.args.at(-1)}`, 'utf8');
    });

    const result = await executeBackupCommand({
      outputRoot,
      backupId: BACKUP_ID,
      manifest: incompleteManifest(),
      finishedAt: '2026-08-24T12:04:05.000Z',
      databaseServices: SERVICES,
      pgPassFileRef: '/run/secrets/postgres-backup.pgpass',
      prestagedArtifacts: [
        { ref: 'runtime/coding/run-1.tar', content: 'portable-runtime-hook' },
        { ref: 'runtime/writing/run-2.tar', content: 'writing-runtime-hook' },
        { ref: 'runtime/authoring/run-3.tar', content: 'authoring-runtime-hook' },
        { ref: 'identity/realm-import.json', content: '{"realm":"ui4a"}' },
        { ref: 'identity/deployment-bindings.json', content: '{"schemaVersion":1}' },
        { ref: 'private/deployment-secrets.tar', content: 'private-config-hook' },
      ],
      archiveSources: [{ ref: 'private/pki.tar', sourceRoot: archiveSourceRoot, entry: 'pki' }],
      run,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        status: 'completed',
        backupId: BACKUP_ID,
        manifestPath: join(outputRoot, BACKUP_ID, 'manifest.json'),
      },
    });
    const databaseCommands = commands.filter(({ executable }) => executable === 'pg_dump');
    const archiveCommands = commands.filter(({ executable }) => executable === 'tar');
    expect(databaseCommands).toHaveLength(4);
    for (const command of databaseCommands) {
      expect(command.executable).toBe('pg_dump');
      expect(command.args).toEqual(
        expect.arrayContaining(['--format=custom', '--no-owner', '--no-acl']),
      );
      expect(command.args.some((arg) => arg.startsWith('--file='))).toBe(true);
      expect(command.args.at(-1)).toMatch(/^service=[a-z0-9-]+-backup$/);
      expect(command.environment).toEqual({
        PGPASSFILE: '/run/secrets/postgres-backup.pgpass',
      });
    }
    expect(archiveCommands).toEqual([
      {
        executable: 'tar',
        args: [
          '--create',
          `--file=${join(outputRoot, `${BACKUP_ID}.incomplete`, 'private/pki.tar')}`,
          `--directory=${archiveSourceRoot}`,
          '--',
          'pki',
        ],
        outputPath: join(outputRoot, `${BACKUP_ID}.incomplete`, 'private/pki.tar'),
        environment: {},
      },
    ]);
    expect(await readdir(outputRoot)).toEqual([BACKUP_ID]);
    const manifest = JSON.parse(
      await readFile(join(outputRoot, BACKUP_ID, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      state: 'completed',
      strategy: 'quiesced-pg-dump',
      quiescenceReceipt: QUIESCENCE_RECEIPT,
    });
    expect((manifest.checksums as Record<string, unknown>)['databases/ui4a.dump']).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(JSON.stringify({ result, commands, manifest })).not.toContain('private-config-hook');
  });

  it('leaves no completed directory or completed marker when a command fails', async () => {
    const { executeBackupCommand } = await backupApi();
    const outputRoot = await temporaryRoot();

    const result = await executeBackupCommand({
      outputRoot,
      backupId: BACKUP_ID,
      manifest: incompleteManifest(),
      finishedAt: '2026-08-24T12:04:05.000Z',
      databaseServices: SERVICES,
      pgPassFileRef: '/run/secrets/postgres-backup.pgpass',
      prestagedArtifacts: [],
      run: async () => {
        throw new Error('pg_dump failed with __secret__');
      },
    });

    expect(result).toEqual({
      exitCode: 1,
      output: { status: 'failed', backupId: BACKUP_ID, reasonCode: 'BACKUP_COMMAND_FAILED' },
    });
    expect(await readdir(outputRoot)).toEqual([`${BACKUP_ID}.incomplete`]);
    expect(JSON.stringify(result)).not.toContain('__secret__');
  });

  it.each([
    ['missing receipt', undefined],
    ['unverified receipt', { ...QUIESCENCE_RECEIPT, verified: false }],
    [
      'service still running',
      { ...QUIESCENCE_RECEIPT, stopped: { ...QUIESCENCE_RECEIPT.stopped, worker: false } },
    ],
  ])('rejects %s before creating output or invoking any pg_dump', async (_case, receipt) => {
    const { executeBackupCommand } = await backupApi();
    const outputRoot = await temporaryRoot();
    const manifest = incompleteManifest();
    if (receipt === undefined) delete manifest.quiescenceReceipt;
    else manifest.quiescenceReceipt = receipt;
    const run = vi.fn(async () => undefined);

    const result = await executeBackupCommand({
      outputRoot,
      backupId: BACKUP_ID,
      manifest,
      finishedAt: '2026-08-24T12:04:05.000Z',
      databaseServices: SERVICES,
      pgPassFileRef: '/run/secrets/postgres-backup.pgpass',
      prestagedArtifacts: [],
      run,
    });

    expect(result).toEqual({
      exitCode: 1,
      output: {
        status: 'failed',
        backupId: BACKUP_ID,
        reasonCode: 'BACKUP_QUIESCENCE_INVALID',
      },
    });
    expect(run).not.toHaveBeenCalled();
    expect(await readdir(outputRoot)).toEqual([]);
  });
});

describe('T22 generic isolated restore command seam', () => {
  it('invokes pg_restore only for a prevalidated isolated target and never uses --clean', async () => {
    const { executeRestoreCommand } = await restoreApi();
    const backupRoot = await temporaryRoot();
    const databaseDirectory = join(backupRoot, 'databases');
    await mkdir(databaseDirectory);
    await Promise.all(
      Object.keys(SERVICES).map(async (database) => {
        await writeFile(join(databaseDirectory, `${database}.dump`), database, 'utf8');
      }),
    );
    const commands: ProcessCommand[] = [];

    const result = await executeRestoreCommand({
      backupId: BACKUP_ID,
      backupRoot,
      targetDatabaseServices: {
        ui4a: 'ui4a-restore-fixture',
        keycloak: 'keycloak-restore-fixture',
        temporal: 'temporal-restore-fixture',
        temporal_visibility: 'temporal-visibility-restore-fixture',
      },
      pgPassFileRef: '/run/secrets/postgres-restore.pgpass',
      validatedIsolatedPlan: { mode: 'isolated', destructive: false, useCleanRestore: false },
      run: async (command) => {
        commands.push(command);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(commands).toHaveLength(4);
    for (const command of commands) {
      expect(command.executable).toBe('pg_restore');
      expect(command.args).toEqual(
        expect.arrayContaining(['--exit-on-error', '--no-owner', '--no-acl']),
      );
      expect(command.args).not.toContain('--clean');
      expect(command.args.join(' ')).not.toContain('compose-main');
    }
  });

  it('preflights every dump before invoking any restore mutation', async () => {
    const { executeRestoreCommand } = await restoreApi();
    const backupRoot = await temporaryRoot();
    const databaseDirectory = join(backupRoot, 'databases');
    await mkdir(databaseDirectory);
    await Promise.all(
      ['keycloak', 'temporal', 'temporal_visibility'].map(async (database) => {
        await writeFile(join(databaseDirectory, `${database}.dump`), database, 'utf8');
      }),
    );
    const run = vi.fn(async () => undefined);

    const result = await executeRestoreCommand({
      backupId: BACKUP_ID,
      backupRoot,
      targetDatabaseServices: {
        ui4a: 'ui4a-restore-fixture',
        keycloak: 'keycloak-restore-fixture',
        temporal: 'temporal-restore-fixture',
        temporal_visibility: 'temporal-visibility-restore-fixture',
      },
      pgPassFileRef: '/run/secrets/postgres-restore.pgpass',
      validatedIsolatedPlan: { mode: 'isolated', destructive: false, useCleanRestore: false },
      run,
    });

    expect(result).toEqual({
      exitCode: 1,
      output: { status: 'failed', backupId: BACKUP_ID, reasonCode: 'RESTORE_COMMAND_FAILED' },
    });
    expect(run).not.toHaveBeenCalled();
  });
});
