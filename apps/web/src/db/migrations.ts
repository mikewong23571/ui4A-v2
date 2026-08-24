import type { PoolClient } from 'pg';

import { AGENT_DEFINITION_DDL } from './agent-definitions';
import { AGENT_RUN_DDL } from './agent-runs';
import { CAPABILITY_RUN_DDL } from './capability-runs';
import { DRAFT_DDL } from './drafts';
import { EVENTS_DDL, type DbExecutor } from './events';
import { PRESENTATION_DDL } from './presentation';

export interface MigrationDefinition {
  version: number;
  name: string;
}

export interface MigrationStatus {
  state: 'pending' | 'ready' | 'incompatible';
  currentVersion: number;
  targetVersion: number;
  ready: boolean;
}

export interface ApplicationBootstrapReceipt {
  schemaVersion: 1;
  migrationVersion: number;
  eventHighWaterMark: number;
  replayHash: string;
}

export interface ApplicationBootstrapStatus {
  state: 'pending' | 'ready';
  ready: boolean;
  migrationVersion: number;
  receipt?: ApplicationBootstrapReceipt;
}

export type MigrationErrorCode =
  'BOOTSTRAP_REQUIRED' | 'MIGRATION_REQUIRED' | 'MIGRATION_VERSION_INCOMPATIBLE';

export class MigrationError extends Error {
  constructor(readonly code: MigrationErrorCode) {
    super(code);
    this.name = 'MigrationError';
  }
}

export const MIGRATION_REGISTRY: readonly MigrationDefinition[] = Object.freeze([
  Object.freeze({ version: 1, name: 'initial-ui4a-schema' }),
]);

const MIGRATION_HISTORY_TABLE = 'ui4a_schema_migrations';
const BOOTSTRAP_STATE_TABLE = 'ui4a_bootstrap_state';
const MIGRATION_LOCK = 740944;
const INITIAL_SCHEMA_DDL = [
  EVENTS_DDL,
  PRESENTATION_DDL,
  DRAFT_DDL,
  CAPABILITY_RUN_DDL,
  AGENT_DEFINITION_DDL,
  AGENT_RUN_DDL,
] as const;

interface ConnectableDb extends DbExecutor {
  connect?: () => Promise<PoolClient>;
}

async function acquire(db: ConnectableDb): Promise<{ client: DbExecutor; release(): void }> {
  if ('release' in db && typeof db.release === 'function') {
    return { client: db, release() {} };
  }
  if (db.connect === undefined) return { client: db, release() {} };
  const client = await db.connect();
  return { client, release: () => client.release() };
}

async function historyExists(db: DbExecutor): Promise<boolean> {
  const result = await db.query<{ relation: string | null }>(
    `SELECT to_regclass(format('%I.%I', current_schema(), $1::text)) AS relation`,
    [MIGRATION_HISTORY_TABLE],
  );
  return result.rows[0]?.relation !== null && result.rows[0]?.relation !== undefined;
}

async function tableExists(db: DbExecutor, table: string): Promise<boolean> {
  const result = await db.query<{ relation: string | null }>(
    `SELECT to_regclass(format('%I.%I', current_schema(), $1::text)) AS relation`,
    [table],
  );
  return result.rows[0]?.relation !== null && result.rows[0]?.relation !== undefined;
}

async function currentVersion(db: DbExecutor): Promise<number> {
  if (!(await historyExists(db))) return 0;
  const result = await db.query<{ version: string | number | null }>(
    `SELECT max(version) AS version FROM ${MIGRATION_HISTORY_TABLE}`,
  );
  return Number(result.rows[0]?.version ?? 0);
}

function targetVersion(): number {
  return MIGRATION_REGISTRY.at(-1)?.version ?? 0;
}

function statusFor(current: number): MigrationStatus {
  const target = targetVersion();
  if (current > target) {
    return { state: 'incompatible', currentVersion: current, targetVersion: target, ready: false };
  }
  if (current < target) {
    return { state: 'pending', currentVersion: current, targetVersion: target, ready: false };
  }
  return { state: 'ready', currentVersion: current, targetVersion: target, ready: true };
}

/** Read-only migration state for production bootstrap and the future readiness adapter. */
export async function getMigrationStatus(db: DbExecutor): Promise<MigrationStatus> {
  return statusFor(await currentVersion(db));
}

/** Fail closed without applying DDL; production Web/Worker bootstrap uses this boundary. */
export async function assertMigrationsReady(db: DbExecutor): Promise<MigrationStatus> {
  const status = await getMigrationStatus(db);
  if (status.state === 'incompatible') {
    throw new MigrationError('MIGRATION_VERSION_INCOMPATIBLE');
  }
  if (!status.ready) throw new MigrationError('MIGRATION_REQUIRED');
  return status;
}

/** Read-only bootstrap receipt for production boot and the future readiness adapter. */
export async function getApplicationBootstrapStatus(
  db: DbExecutor,
): Promise<ApplicationBootstrapStatus> {
  const migration = await getMigrationStatus(db);
  if (!migration.ready || !(await tableExists(db, BOOTSTRAP_STATE_TABLE))) {
    return { state: 'pending', ready: false, migrationVersion: migration.currentVersion };
  }
  const result = await db.query<{
    migration_version: string | number;
    event_high_water_mark: string | number;
    replay_hash: string;
  }>(
    `SELECT migration_version, event_high_water_mark, replay_hash
     FROM ${BOOTSTRAP_STATE_TABLE} WHERE singleton=TRUE`,
  );
  const row = result.rows[0];
  if (row === undefined || Number(row.migration_version) !== migration.targetVersion) {
    return { state: 'pending', ready: false, migrationVersion: migration.currentVersion };
  }
  return {
    state: 'ready',
    ready: true,
    migrationVersion: migration.currentVersion,
    receipt: {
      schemaVersion: 1,
      migrationVersion: Number(row.migration_version),
      eventHighWaterMark: Number(row.event_high_water_mark),
      replayHash: row.replay_hash,
    },
  };
}

export async function assertApplicationBootstrapReady(
  db: DbExecutor,
): Promise<ApplicationBootstrapStatus> {
  await assertMigrationsReady(db);
  const status = await getApplicationBootstrapStatus(db);
  if (!status.ready) throw new MigrationError('BOOTSTRAP_REQUIRED');
  return status;
}

/** Persist the receipt only after seed installation and replay integrity verification succeed. */
export async function recordApplicationBootstrapReceipt(
  db: DbExecutor,
  receipt: ApplicationBootstrapReceipt,
): Promise<ApplicationBootstrapStatus> {
  const migration = await assertMigrationsReady(db);
  if (receipt.migrationVersion !== migration.targetVersion) {
    throw new MigrationError('BOOTSTRAP_REQUIRED');
  }
  await db.query(
    `INSERT INTO ${BOOTSTRAP_STATE_TABLE}
       (singleton, migration_version, event_high_water_mark, replay_hash)
     VALUES (TRUE, $1, $2, $3)
     ON CONFLICT (singleton) DO UPDATE SET
       migration_version=EXCLUDED.migration_version,
       event_high_water_mark=EXCLUDED.event_high_water_mark,
       replay_hash=EXCLUDED.replay_hash,
       verified_at=now()`,
    [receipt.migrationVersion, receipt.eventHighWaterMark, receipt.replayHash],
  );
  return { state: 'ready', ready: true, migrationVersion: migration.currentVersion, receipt };
}

/** Apply repository-owned migrations under one transaction-scoped PostgreSQL advisory lock. */
export async function runMigrations(db: ConnectableDb): Promise<MigrationStatus> {
  const acquired = await acquire(db);
  const client = acquired.client;
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
    const before = statusFor(await currentVersion(client));
    if (before.state === 'incompatible') {
      throw new MigrationError('MIGRATION_VERSION_INCOMPATIBLE');
    }
    if (before.ready) {
      await client.query('COMMIT');
      return before;
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_HISTORY_TABLE} (
        version     INTEGER PRIMARY KEY CHECK (version > 0),
        name        TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${BOOTSTRAP_STATE_TABLE} (
        singleton              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        migration_version      INTEGER NOT NULL REFERENCES ${MIGRATION_HISTORY_TABLE}(version),
        event_high_water_mark  BIGINT NOT NULL,
        replay_hash            TEXT NOT NULL CHECK (replay_hash ~ '^sha256:[0-9a-f]{64}$'),
        verified_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const migration of MIGRATION_REGISTRY) {
      if (migration.version <= before.currentVersion) continue;
      if (migration.version === 1) {
        for (const ddl of INITIAL_SCHEMA_DDL) await client.query(ddl);
      }
      await client.query(`INSERT INTO ${MIGRATION_HISTORY_TABLE} (version, name) VALUES ($1, $2)`, [
        migration.version,
        migration.name,
      ]);
    }

    await client.query('COMMIT');
    return statusFor(targetVersion());
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    acquired.release();
  }
}

/** Local demo/test convenience only; production never applies DDL from application boot. */
export async function prepareDatabaseForApplication(
  db: ConnectableDb,
  deploymentProfile = process.env.UI4A_DEPLOYMENT_PROFILE,
): Promise<MigrationStatus> {
  if (deploymentProfile === 'production') return assertMigrationsReady(db);
  const status = await getMigrationStatus(db);
  return status.ready ? status : runMigrations(db);
}
