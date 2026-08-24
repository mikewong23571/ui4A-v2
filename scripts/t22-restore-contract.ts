import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { runProcessCommand, type CommandResult, type ProcessCommand } from './t22-backup-contract';

export type RestoreErrorCode =
  | 'ARCHIVE_ENTRY_TYPE_UNSAFE'
  | 'ARCHIVE_PATH_UNSAFE'
  | 'BACKUP_CHECKSUM_MISMATCH'
  | 'BACKUP_INCOMPLETE'
  | 'BACKUP_INVENTORY_INCOMPLETE'
  | 'POSTGRES_MAJOR_MISMATCH'
  | 'RESTORE_IN_PLACE_FORBIDDEN'
  | 'RESTORE_TARGET_EXISTS';

export class RestoreContractError extends Error {
  constructor(readonly code: RestoreErrorCode) {
    super(code);
    this.name = 'RestoreContractError';
  }
}

export interface RestoreArtifact {
  kind: 'database' | 'runtime' | 'realm' | 'pki' | 'private-config';
  ref: string;
  digest: string;
  actualDigest: string;
  entryType: 'file' | 'directory' | 'symlink' | 'device';
}

export interface RestoreInput {
  backupId: string;
  backupState: 'incomplete' | 'completed';
  source: { environmentId: string; postgresMajor: number; root: string };
  target: { environmentId: string; postgresMajor: number; root: string; exists: boolean };
  artifacts: RestoreArtifact[];
}

export interface RestorePlan {
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

const REQUIRED_DATABASE_REFS = [
  'databases/ui4a.dump',
  'databases/keycloak.dump',
  'databases/temporal.dump',
  'databases/temporal_visibility.dump',
] as const;
const DATABASE_NAMES = ['ui4a', 'keycloak', 'temporal', 'temporal_visibility'] as const;

function fail(code: RestoreErrorCode): never {
  throw new RestoreContractError(code);
}

function safeRef(ref: string): boolean {
  return (
    ref !== '' &&
    !isAbsolute(ref) &&
    !ref.includes('\\') &&
    ref.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function inventoryComplete(artifacts: readonly RestoreArtifact[]): boolean {
  const refs = new Set(artifacts.map(({ ref }) => ref));
  return (
    REQUIRED_DATABASE_REFS.every((ref) => refs.has(ref)) &&
    ['coding', 'writing', 'authoring'].every((kind) =>
      artifacts.some(({ ref }) => ref.startsWith(`runtime/${kind}/`)),
    ) &&
    refs.has('identity/realm-import.json') &&
    refs.has('identity/deployment-bindings.json') &&
    refs.has('private/pki.tar') &&
    refs.has('private/deployment-secrets.tar')
  );
}

/** Validate an already inventoried backup and return an isolated, non-destructive restore plan. */
export function planIsolatedRestore(input: RestoreInput): RestorePlan {
  const sourceRoot = resolve(input.source.root);
  const targetRoot = resolve(input.target.root);
  if (
    input.source.environmentId === input.target.environmentId ||
    sourceRoot === targetRoot ||
    targetRoot === resolve('/') ||
    targetRoot === resolve(homedir())
  ) {
    fail('RESTORE_IN_PLACE_FORBIDDEN');
  }
  if (input.target.exists) fail('RESTORE_TARGET_EXISTS');
  if (input.source.postgresMajor !== input.target.postgresMajor) {
    fail('POSTGRES_MAJOR_MISMATCH');
  }
  if (input.backupState !== 'completed') fail('BACKUP_INCOMPLETE');
  for (const artifact of input.artifacts) {
    if (!safeRef(artifact.ref)) fail('ARCHIVE_PATH_UNSAFE');
    if (artifact.entryType !== 'file' && artifact.entryType !== 'directory') {
      fail('ARCHIVE_ENTRY_TYPE_UNSAFE');
    }
    if (artifact.digest !== artifact.actualDigest) fail('BACKUP_CHECKSUM_MISMATCH');
  }
  if (!inventoryComplete(input.artifacts)) fail('BACKUP_INVENTORY_INCOMPLETE');
  return {
    schemaVersion: 1,
    backupId: input.backupId,
    mode: 'isolated',
    destructive: false,
    useCleanRestore: false,
    target: { ...input.target },
    phases: [
      'verify-manifest',
      'allocate-isolated-target',
      'restore-databases',
      'restore-private-files',
      'rebuild-projections',
      'verify-fingerprints',
    ],
  };
}

/** Restore four verified dumps through fixed argv; callers must supply a validated isolated plan. */
export async function executeRestoreCommand(input: {
  backupId: string;
  backupRoot: string;
  targetDatabaseServices: Record<'ui4a' | 'keycloak' | 'temporal' | 'temporal_visibility', string>;
  pgPassFileRef: string;
  validatedIsolatedPlan: { mode: 'isolated'; destructive: false; useCleanRestore: false };
  run?: (command: ProcessCommand) => Promise<void>;
}): Promise<CommandResult> {
  const root = resolve(input.backupRoot);
  if (!isAbsolute(input.backupRoot) || root === resolve('/') || root === resolve(homedir())) {
    return {
      exitCode: 1,
      output: { status: 'failed', backupId: input.backupId, reasonCode: 'RESTORE_PLAN_INVALID' },
    };
  }
  if (
    input.validatedIsolatedPlan.mode !== 'isolated' ||
    input.validatedIsolatedPlan.destructive !== false ||
    input.validatedIsolatedPlan.useCleanRestore !== false
  ) {
    return {
      exitCode: 1,
      output: { status: 'failed', backupId: input.backupId, reasonCode: 'RESTORE_PLAN_INVALID' },
    };
  }
  const run = input.run ?? runProcessCommand;
  try {
    if (
      Object.keys(input.targetDatabaseServices).sort().join(',') !==
      [...DATABASE_NAMES].sort().join(',')
    ) {
      throw new Error('RESTORE_DATABASE_SET_INVALID');
    }
    const commands = await Promise.all(
      DATABASE_NAMES.map(async (database): Promise<ProcessCommand> => {
        const service = input.targetDatabaseServices[database];
        if (!/^[A-Za-z0-9._-]*restore[A-Za-z0-9._-]*$/.test(service)) {
          throw new Error('RESTORE_TARGET_SERVICE_INVALID');
        }
        const dumpPath = join(root, 'databases', `${database}.dump`);
        if (!(await stat(dumpPath)).isFile()) throw new Error('RESTORE_DUMP_INVALID');
        return {
          executable: 'pg_restore',
          args: [
            '--exit-on-error',
            '--no-owner',
            '--no-acl',
            `--dbname=service=${service}`,
            dumpPath,
          ],
          environment: { PGPASSFILE: input.pgPassFileRef },
        };
      }),
    );
    for (const command of commands) {
      await run(command);
    }
    return { exitCode: 0, output: { status: 'completed', backupId: input.backupId } };
  } catch {
    return {
      exitCode: 1,
      output: { status: 'failed', backupId: input.backupId, reasonCode: 'RESTORE_COMMAND_FAILED' },
    };
  }
}
