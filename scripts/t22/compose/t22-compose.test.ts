import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  executeComposeCommand,
  planComposeCommand,
  type ComposeProcessCommand,
} from './t22-compose';

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const imageEnvironment = {
  UI4A_POSTGRES_IMAGE: `registry.internal/postgres@sha256:${'1'.repeat(64)}`,
  UI4A_TEMPORAL_IMAGE: `registry.internal/temporal@sha256:${'2'.repeat(64)}`,
  UI4A_TEMPORAL_ADMIN_TOOLS_IMAGE: `registry.internal/temporal-admin@sha256:${'3'.repeat(64)}`,
  UI4A_TEMPORAL_UI_IMAGE: `registry.internal/temporal-ui@sha256:${'4'.repeat(64)}`,
  UI4A_KEYCLOAK_IMAGE: `registry.internal/keycloak@sha256:${'5'.repeat(64)}`,
  UI4A_WEB_IMAGE: `registry.internal/web@sha256:${'6'.repeat(64)}`,
  UI4A_WORKER_IMAGE: `registry.internal/worker@sha256:${'7'.repeat(64)}`,
  UI4A_RUNNER_IMAGE: `registry.internal/runner@sha256:${'8'.repeat(64)}`,
  UI4A_EDGE_IMAGE: `registry.internal/edge@sha256:${'9'.repeat(64)}`,
};
const currentGitRevision = 'a'.repeat(40);
const releaseGitRevision = 'c'.repeat(40);
const ui4aImages = [
  imageEnvironment.UI4A_WEB_IMAGE,
  imageEnvironment.UI4A_WORKER_IMAGE,
  imageEnvironment.UI4A_RUNNER_IMAGE,
] as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function environment(): Promise<Record<string, string>> {
  const root = await mkdtemp(join(tmpdir(), 'ui4a-compose-command-'));
  roots.push(root);
  const files = {
    UI4A_DEPLOYMENT_SETTINGS_FILE: 'settings.json',
    UI4A_DEPLOYMENT_SECRETS_FILE: 'deployment-secrets.json',
    UI4A_POSTGRES_BOOTSTRAP_PASSWORD_FILE: 'postgres-bootstrap-password',
    UI4A_MIGRATION_PASSWORD_FILE: 'ui4a-migration-password',
    UI4A_RUNTIME_PASSWORD_FILE: 'ui4a-runtime-password',
    UI4A_KEYCLOAK_DATABASE_PASSWORD_FILE: 'keycloak-database-password',
    UI4A_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD_FILE: 'keycloak-bootstrap-admin-password',
    UI4A_TEMPORAL_SCHEMA_PASSWORD_FILE: 'temporal-schema-password',
    UI4A_TEMPORAL_RUNTIME_PASSWORD_FILE: 'temporal-runtime-password',
    UI4A_POSTGRES_BACKUP_PASSWORD_FILE: 'postgres-backup-password',
    UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: 'capability-callback-token',
  };
  await Promise.all(
    Object.values(files).map((name) =>
      writeFile(join(root, name), name.endsWith('.json') ? '{}' : '__private_test_value__'),
    ),
  );
  return {
    UI4A_DEPLOYMENT_PROFILE: 'production',
    UI4A_RELEASE_GIT_SHA: releaseGitRevision,
    ...imageEnvironment,
    ...Object.fromEntries(Object.entries(files).map(([key, name]) => [key, join(root, name)])),
  };
}

function dependencies(
  options: {
    failFirst?: boolean;
    imageRevision?: string;
    releaseExists?: boolean;
    releaseIsAncestor?: boolean;
  } = {},
) {
  const commands: ComposeProcessCommand[] = [];
  const run = vi.fn(async (command: ComposeProcessCommand) => {
    commands.push(command);
    return { exitCode: options.failFirst && commands.length === 1 ? 23 : 0 };
  });
  const validateCanonicalDeployment = vi.fn(() => undefined);
  const readCurrentGitRevision = vi.fn(async () => currentGitRevision);
  const readImageRevision = vi.fn(async (_image: string) => {
    return options.imageRevision ?? releaseGitRevision;
  });
  const commitExists = vi.fn(async (_revision: string) => options.releaseExists ?? true);
  const isAncestor = vi.fn(
    async (_ancestor: string, _descendant: string) => options.releaseIsAncestor ?? true,
  );
  return {
    commands,
    run,
    validateCanonicalDeployment,
    readCurrentGitRevision,
    readImageRevision,
    commitExists,
    isAncestor,
  };
}

describe('T22 Compose single-command operations', () => {
  it('binds production preflight to the operator-owned input validator', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile('scripts/t22/compose/t22-compose.ts', 'utf8'),
    );

    expect(source).toContain('validateComposeProductionEnvironment');
  });

  it('pins UI4A images to the operator release SHA and records its ancestry to checkout HEAD', async () => {
    const env = await environment();
    const deps = dependencies();

    const result = await executeComposeCommand(deps, ['preflight'], env);

    expect(result).toEqual({
      ok: true,
      code: 'COMPOSE_PREFLIGHT_COMPLETED',
      plan: {
        releaseGitSha: releaseGitRevision,
        operatorGitSha: currentGitRevision,
        relationship: 'ancestor-or-equal',
      },
    });
    expect(deps.validateCanonicalDeployment).toHaveBeenCalledOnce();
    expect(deps.readCurrentGitRevision).toHaveBeenCalledOnce();
    expect(deps.commitExists).toHaveBeenCalledWith(releaseGitRevision);
    expect(deps.isAncestor).toHaveBeenCalledWith(releaseGitRevision, currentGitRevision);
    expect(deps.readImageRevision.mock.calls.map(([image]) => image)).toEqual(ui4aImages);
    expect(deps.run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('__private_test_value__');
  });

  it.each([
    ['absent', { releaseExists: false }],
    ['not an ancestor', { releaseIsAncestor: false }],
  ])('rejects a release SHA that is %s relative to operator HEAD', async (_case, options) => {
    const deps = dependencies(options);

    expect(await executeComposeCommand(deps, ['preflight'], await environment())).toEqual({
      ok: false,
      code: 'COMPOSE_RELEASE_REVISION_NOT_ANCESTOR',
    });
    expect(deps.readImageRevision).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('rejects a stale UI4A image revision before PKI or any Compose process', async () => {
    const deps = dependencies({ imageRevision: 'b'.repeat(40) });

    expect(await executeComposeCommand(deps, ['up'], await environment())).toEqual({
      ok: false,
      code: 'COMPOSE_IMAGE_REVISION_MISMATCH',
    });
    expect(deps.readImageRevision).toHaveBeenCalledTimes(1);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('preflights canonical files and all nine digest images before ordered up', async () => {
    const env = await environment();
    const deps = dependencies();

    const result = await executeComposeCommand(deps, ['up'], env);

    expect(result).toEqual({ ok: true, code: 'COMPOSE_UP_COMPLETED' });
    expect(deps.validateCanonicalDeployment).toHaveBeenCalledOnce();
    expect(deps.readImageRevision).toHaveBeenCalledTimes(3);
    expect(deps.commands.map(({ executable, args }) => [executable, ...args])).toEqual([
      [
        'docker',
        'compose',
        '--project-name',
        'ui4a',
        '-f',
        'deploy/compose/compose.yaml',
        'run',
        '--rm',
        'pki-init',
      ],
      [
        'docker',
        'compose',
        '--project-name',
        'ui4a',
        '-f',
        'deploy/compose/compose.yaml',
        'up',
        '-d',
        '--wait',
      ],
    ]);
    expect(JSON.stringify(result)).not.toContain('__private_test_value__');
  });

  it('never starts Compose when PKI initialization fails', async () => {
    const deps = dependencies({ failFirst: true });
    const result = await executeComposeCommand(deps, ['up'], await environment());

    expect(result).toEqual({ ok: false, code: 'COMPOSE_PKI_INIT_FAILED' });
    expect(deps.commands).toHaveLength(1);
  });

  it('fails closed before a process for missing, mutable, or symlinked inputs', async () => {
    const missingDeps = dependencies();
    const missing = await environment();
    delete missing.UI4A_TEMPORAL_RUNTIME_PASSWORD_FILE;
    expect(await executeComposeCommand(missingDeps, ['up'], missing)).toEqual({
      ok: false,
      code: 'COMPOSE_PREFLIGHT_FAILED',
    });
    expect(missingDeps.run).not.toHaveBeenCalled();

    const mutableDeps = dependencies();
    const mutable = await environment();
    mutable.UI4A_WEB_IMAGE = 'registry.internal/web:latest';
    expect(await executeComposeCommand(mutableDeps, ['up'], mutable)).toEqual({
      ok: false,
      code: 'COMPOSE_PREFLIGHT_FAILED',
    });
    expect(mutableDeps.run).not.toHaveBeenCalled();

    const symlinkDeps = dependencies();
    const linked = await environment();
    const linkedRoot = join(roots.at(-1)!, 'links');
    await mkdir(linkedRoot);
    const link = join(linkedRoot, 'runtime-password');
    await symlink(linked.UI4A_RUNTIME_PASSWORD_FILE!, link);
    linked.UI4A_RUNTIME_PASSWORD_FILE = link;
    expect(await executeComposeCommand(symlinkDeps, ['up'], linked)).toEqual({
      ok: false,
      code: 'COMPOSE_PREFLIGHT_FAILED',
    });
    expect(symlinkDeps.run).not.toHaveBeenCalled();
  });

  it('supports status and ordinary non-destructive down without deployment preflight', async () => {
    const status = dependencies();
    expect(await executeComposeCommand(status, ['status'], {})).toEqual({
      ok: true,
      code: 'COMPOSE_STATUS_COMPLETED',
    });
    expect(status.commands[0]?.args.at(-1)).toBe('ps');

    const down = dependencies();
    expect(await executeComposeCommand(down, ['down'], {})).toEqual({
      ok: true,
      code: 'COMPOSE_DOWN_COMPLETED',
    });
    expect(down.commands[0]?.args.at(-1)).toBe('down');
    expect(down.commands[0]?.args).not.toEqual(expect.arrayContaining(['-v', '--volumes']));
  });

  it('returns backup and isolated restore plans bound to existing contracts', async () => {
    const backupDeps = dependencies();
    const backup = await executeComposeCommand(backupDeps, ['backup'], await environment());
    expect(backup).toMatchObject({
      ok: true,
      code: 'COMPOSE_BACKUP_PLAN',
      plan: {
        contract: 'scripts/t22/backup/t22-backup-contract.ts',
        strategy: 'quiesced-pg-dump',
      },
    });
    expect(backupDeps.run).not.toHaveBeenCalled();

    const restoreDeps = dependencies();
    const restore = await executeComposeCommand(restoreDeps, ['restore-plan'], await environment());
    expect(restore).toMatchObject({
      ok: true,
      code: 'COMPOSE_RESTORE_PLAN',
      plan: {
        contract: 'scripts/t22/backup/t22-restore-contract.ts',
        target: 'isolated',
        destructive: false,
      },
    });
    expect(restoreDeps.run).not.toHaveBeenCalled();
    expect(JSON.stringify({ backup, restore })).not.toContain('__private_test_value__');
  });

  it('only plans explicit project-targeted volume cleanup after exact confirmation', () => {
    expect(() => planComposeCommand(['clean'], {})).toThrowError('COMPOSE_USAGE_INVALID');
    expect(() =>
      planComposeCommand(['clean', '--confirm-destroy-volumes', 'not-ui4a'], {}),
    ).toThrowError('COMPOSE_CLEAN_CONFIRMATION_REQUIRED');

    const plan = planComposeCommand(['clean', '--confirm-destroy-volumes', 'ui4a'], {});
    expect(plan.commands).toEqual([
      {
        executable: 'docker',
        args: [
          'compose',
          '--project-name',
          'ui4a',
          '-f',
          'deploy/compose/compose.yaml',
          'down',
          '--volumes',
        ],
      },
    ]);
  });

  it('plans one explicit realm migration with a volume-contained backup path', () => {
    expect(() => planComposeCommand(['realm-migrate'], {})).toThrowError('COMPOSE_USAGE_INVALID');
    expect(() =>
      planComposeCommand(['realm-migrate', '--backup-file', '/tmp/realm.json'], {}),
    ).toThrowError('COMPOSE_REALM_BACKUP_PATH_INVALID');

    const backup = '/var/lib/ui4a/realm/backups/ui4a-before-v2.json';
    expect(planComposeCommand(['realm-migrate', '--backup-file', backup], {}).commands).toEqual([
      {
        executable: 'docker',
        args: [
          'compose',
          '--project-name',
          'ui4a',
          '-f',
          'deploy/compose/compose.yaml',
          'run',
          '--rm',
          '--no-deps',
          'realm-bootstrap',
          'node',
          'dist/t22-keycloak-realm-migration.js',
          '--backup-file',
          backup,
        ],
      },
    ]);
  });

  it('preflights and executes the explicit realm migration once', async () => {
    const backup = '/var/lib/ui4a/realm/backups/ui4a-before-v2.json';
    const deps = dependencies();
    await expect(
      executeComposeCommand(deps, ['realm-migrate', '--backup-file', backup], await environment()),
    ).resolves.toEqual({ ok: true, code: 'COMPOSE_REALM_MIGRATION_COMPLETED' });
    expect(deps.commands).toHaveLength(1);
    expect(deps.validateCanonicalDeployment).toHaveBeenCalledOnce();
  });

  it('rejects unknown arguments with a stable usage code before preflight', async () => {
    const deps = dependencies();
    expect(await executeComposeCommand(deps, ['deploy'], {})).toEqual({
      ok: false,
      code: 'COMPOSE_USAGE_INVALID',
    });
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.validateCanonicalDeployment).not.toHaveBeenCalled();
  });

  it('emits one stable JSON error envelope from the executable tsx entry', async () => {
    await expect(
      execFileAsync(
        'apps/worker/node_modules/.bin/tsx',
        ['scripts/t22/compose/t22-compose.ts', 'invalid'],
        {
          cwd: process.cwd(),
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: '{"ok":false,"code":"COMPOSE_USAGE_INVALID"}\n',
    });
  });
});
