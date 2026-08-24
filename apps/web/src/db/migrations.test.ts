import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureAgentDefinitionTables } from './agent-definitions';
import { ensureAgentRunTables } from './agent-runs';
import { ensureCapabilityRunTables } from './capability-runs';
import { ensureDraftTables } from './drafts';
import { appendEvent, ensureEventsTable, type DbExecutor } from './events';
import { getPool } from './pool';
import { ensurePresentationTables } from './presentation';
import { getEngine, resetEngineForTests } from '../engine/service';

interface MigrationDefinition {
  version: number;
  name: string;
}

interface MigrationStatus {
  state: 'pending' | 'ready' | 'incompatible';
  currentVersion: number;
  targetVersion: number;
  ready: boolean;
}

interface BootstrapStatus {
  state: 'pending' | 'ready';
  ready: boolean;
  migrationVersion: number;
  receipt?: {
    schemaVersion: 1;
    migrationVersion: number;
    eventHighWaterMark: number;
    replayHash: string;
  };
}

interface MigrationModule {
  MIGRATION_REGISTRY: readonly MigrationDefinition[];
  runMigrations(db: DbExecutor): Promise<MigrationStatus>;
  getMigrationStatus(db: DbExecutor): Promise<MigrationStatus>;
  getApplicationBootstrapStatus(db: DbExecutor): Promise<BootstrapStatus>;
}

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';
const databaseName = new URL(DATABASE_URL).pathname.slice(1);
if (databaseName !== 'ui4a_test') {
  throw new Error(`migration contract tests require ui4a_test, received ${databaseName}`);
}

const pool = getPool(DATABASE_URL);
const TEST_SCHEMA = 't22_migration_contract';
const migrationModulePath = './migrations';
const EXPECTED_TABLES = [
  'events',
  'presentation_user_sidecars',
  'draft_payloads',
  'draft_projection',
  'capability_payloads',
  'capability_run_projection',
  'agent_definition_payloads',
  'agent_definition_versions',
  'agent_definition_active',
  'agent_run_payloads',
  'agent_run_projection',
  'agent_run_projection_state',
  'ui4a_schema_migrations',
  'ui4a_bootstrap_state',
] as const;

let client: PoolClient;

async function migrations(): Promise<MigrationModule> {
  try {
    return (await import(migrationModulePath)) as MigrationModule;
  } catch (error) {
    throw new Error(
      'planned migration API missing: MIGRATION_REGISTRY, runMigrations, getMigrationStatus',
      { cause: error },
    );
  }
}

async function configureSearchPath(target: PoolClient): Promise<void> {
  await target.query(`SET search_path TO ${TEST_SCHEMA}, public`);
}

function forwardingExecutor(
  target: PoolClient,
  reject: (sqlText: string) => Error | undefined,
): DbExecutor {
  return {
    query<R extends QueryResultRow = QueryResultRow>(
      sqlText: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      const error = reject(sqlText);
      if (error !== undefined) return Promise.reject(error);
      return values === undefined
        ? target.query<R>(sqlText)
        : target.query<R>(sqlText, [...values]);
    },
  };
}

async function historyCount(): Promise<number> {
  const result = await client.query<{ count: string }>(
    'SELECT count(*) AS count FROM ui4a_schema_migrations',
  );
  return Number(result.rows[0]?.count ?? -1);
}

beforeEach(async () => {
  client = await pool.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
  await configureSearchPath(client);
  resetEngineForTests();
});

afterEach(() => {
  resetEngineForTests();
  client.release();
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
});

describe('T22 explicit versioned migration contract', () => {
  it('migrates an empty database to the exact repository schema and records one version', async () => {
    const migration = await migrations();

    expect(migration.MIGRATION_REGISTRY).toEqual([{ version: 1, name: 'initial-ui4a-schema' }]);
    await expect(migration.getMigrationStatus(client)).resolves.toEqual({
      state: 'pending',
      currentVersion: 0,
      targetVersion: 1,
      ready: false,
    });

    await expect(migration.runMigrations(client)).resolves.toEqual({
      state: 'ready',
      currentVersion: 1,
      targetVersion: 1,
      ready: true,
    });
    for (const table of EXPECTED_TABLES) {
      const found = await client.query<{ name: string | null }>('SELECT to_regclass($1) AS name', [
        table,
      ]);
      expect(found.rows[0]?.name, table).not.toBeNull();
    }
    expect(await historyCount()).toBe(1);
  });

  it('adopts an existing idempotent-DDL database without replacing its event log', async () => {
    const migration = await migrations();
    await ensureEventsTable(client);
    await ensurePresentationTables(client);
    await ensureDraftTables(client);
    await ensureCapabilityRunTables(client);
    await ensureAgentDefinitionTables(client);
    await ensureAgentRunTables(client);
    const marker = await appendEvent(client, { kind: 'seed', rel: 'migration:existing-marker' });

    await migration.runMigrations(client);

    const preserved = await client.query<{ seq: string; rel: string }>(
      'SELECT seq, rel FROM events WHERE rel=$1',
      ['migration:existing-marker'],
    );
    expect(preserved.rows).toEqual([{ seq: String(marker.seq), rel: 'migration:existing-marker' }]);
    expect(await historyCount()).toBe(1);
  });

  it('is a no-op on rerun and does not reset data or duplicate history', async () => {
    const migration = await migrations();
    await migration.runMigrations(client);
    const marker = await appendEvent(client, { kind: 'seed', rel: 'migration:rerun-marker' });

    await migration.runMigrations(client);

    const preserved = await client.query<{ seq: string }>('SELECT seq FROM events WHERE rel=$1', [
      'migration:rerun-marker',
    ]);
    expect(Number(preserved.rows[0]?.seq)).toBe(marker.seq);
    expect(await historyCount()).toBe(1);
  });

  it('serializes two migration invocations and applies each version once', async () => {
    const migration = await migrations();
    const second = await pool.connect();
    await configureSearchPath(second);
    try {
      const results = await Promise.all([
        migration.runMigrations(client),
        migration.runMigrations(second),
      ]);

      expect(results).toEqual([
        { state: 'ready', currentVersion: 1, targetVersion: 1, ready: true },
        { state: 'ready', currentVersion: 1, targetVersion: 1, ready: true },
      ]);
      expect(await historyCount()).toBe(1);
    } finally {
      second.release();
    }
  });

  it('rolls back a partial failure, reports not-ready, and succeeds on retry', async () => {
    const migration = await migrations();
    let injected = false;
    const failing = forwardingExecutor(client, (sqlText) => {
      if (!injected && sqlText.includes('CREATE TABLE IF NOT EXISTS capability_payloads')) {
        injected = true;
        return new Error('injected partial migration failure');
      }
      return undefined;
    });

    await expect(migration.runMigrations(failing)).rejects.toBeDefined();
    expect(injected).toBe(true);
    await expect(migration.getMigrationStatus(client)).resolves.toEqual({
      state: 'pending',
      currentVersion: 0,
      targetVersion: 1,
      ready: false,
    });

    await expect(migration.runMigrations(client)).resolves.toMatchObject({
      state: 'ready',
      currentVersion: 1,
      ready: true,
    });
    expect(await historyCount()).toBe(1);
  });

  it('fails closed when database history is newer than this application', async () => {
    const migration = await migrations();
    await migration.runMigrations(client);
    await client.query(
      `INSERT INTO ui4a_schema_migrations (version, name)
       VALUES ($1, 'future-test-version')`,
      [migration.MIGRATION_REGISTRY.at(-1)!.version + 1],
    );

    await expect(migration.getMigrationStatus(client)).resolves.toEqual({
      state: 'incompatible',
      currentVersion: 2,
      targetVersion: 1,
      ready: false,
    });
    await expect(migration.runMigrations(client)).rejects.toMatchObject({
      code: 'MIGRATION_VERSION_INCOMPATIBLE',
    });
  });

  it('boots through a DDL-denying runtime executor only after migration is ready', async () => {
    const migration = await migrations();
    await migration.runMigrations(client);
    const runtime = forwardingExecutor(client, (sqlText) =>
      /\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(sqlText)
        ? new Error('runtime role attempted forbidden DDL')
        : undefined,
    );

    await expect(getEngine(runtime)).resolves.toBeDefined();
    await expect(migration.getMigrationStatus(runtime)).resolves.toMatchObject({
      state: 'ready',
      ready: true,
    });
  });

  it('fails production boot closed on a pending database without attempting DDL', async () => {
    const previousProfile = process.env.UI4A_DEPLOYMENT_PROFILE;
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    const runtime = forwardingExecutor(client, (sqlText) =>
      /\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(sqlText)
        ? new Error('production boot attempted forbidden DDL')
        : undefined,
    );
    try {
      await expect(getEngine(runtime)).rejects.toMatchObject({ code: 'MIGRATION_REQUIRED' });
    } finally {
      if (previousProfile === undefined) delete process.env.UI4A_DEPLOYMENT_PROFILE;
      else process.env.UI4A_DEPLOYMENT_PROFILE = previousProfile;
    }
  });

  it('requires an explicit production bootstrap receipt after migration and before getEngine', async () => {
    const migration = await migrations();
    await migration.runMigrations(client);
    const previousProfile = process.env.UI4A_DEPLOYMENT_PROFILE;
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    const readOnly = forwardingExecutor(client, (sqlText) =>
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(sqlText)
        ? new Error('production getEngine attempted a mutation')
        : undefined,
    );
    try {
      await expect(migration.getApplicationBootstrapStatus(readOnly)).resolves.toEqual({
        state: 'pending',
        ready: false,
        migrationVersion: 1,
      });
      await expect(getEngine(readOnly)).rejects.toMatchObject({ code: 'BOOTSTRAP_REQUIRED' });
    } finally {
      if (previousProfile === undefined) delete process.env.UI4A_DEPLOYMENT_PROFILE;
      else process.env.UI4A_DEPLOYMENT_PROFILE = previousProfile;
    }
  });

  it('uses a stable explicit bootstrap receipt for mutation-free production getEngine', async () => {
    const migration = await migrations();
    const service = await import('../engine/service');
    await migration.runMigrations(client);
    const bootstrapDb = forwardingExecutor(client, () => undefined);
    const receipt = await service.bootstrapAndVerifyApplication(bootstrapDb);
    expect(receipt).toMatchObject({
      state: 'ready',
      ready: true,
      migrationVersion: 1,
      receipt: {
        schemaVersion: 1,
        migrationVersion: 1,
        eventHighWaterMark: expect.any(Number),
        replayHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });

    const previousProfile = process.env.UI4A_DEPLOYMENT_PROFILE;
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    const readOnly = forwardingExecutor(client, (sqlText) =>
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(sqlText)
        ? new Error('production getEngine attempted a mutation')
        : undefined,
    );
    resetEngineForTests();
    try {
      await expect(getEngine(readOnly)).resolves.toBeDefined();
      await expect(migration.getApplicationBootstrapStatus(readOnly)).resolves.toEqual(receipt);
    } finally {
      if (previousProfile === undefined) delete process.env.UI4A_DEPLOYMENT_PROFILE;
      else process.env.UI4A_DEPLOYMENT_PROFILE = previousProfile;
    }
  });
});
