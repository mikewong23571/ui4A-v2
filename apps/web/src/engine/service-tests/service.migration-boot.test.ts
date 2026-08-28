/**
 * T22 迁移/引导启动合同——引擎组合根侧(T36 E1 自 packages/db/migrations.test
> 拆出:getEngine 生产闭门/引导回执合同须经 web 组合根真身;纯迁移注册表/
> 版本序列合同留在 @ui4a/db/migrations.test)。
 */
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbExecutor } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { getEngine, resetEngineForTests } from '../service';
import { bootstrapAndVerifyApplication } from '../bootstrap';

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
    migrationVersion: 2;
    eventHighWaterMark: number;
    replayHash: string;
  };
}

interface MigrationModule {
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
const TEST_SCHEMA = 't22_migration_contract_boot';

let client: PoolClient;

async function migrations(): Promise<MigrationModule> {
  return (await import('@ui4a/db/migrations')) as MigrationModule;
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

beforeEach(async () => {
  client = await pool.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
  await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
  resetEngineForTests();
});

afterEach(() => {
  resetEngineForTests();
  client.release();
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
});

describe('T22 migration/boot contract through the engine composition root', () => {
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
        migrationVersion: 2,
      });
      await expect(getEngine(readOnly)).rejects.toMatchObject({ code: 'BOOTSTRAP_REQUIRED' });
    } finally {
      if (previousProfile === undefined) delete process.env.UI4A_DEPLOYMENT_PROFILE;
      else process.env.UI4A_DEPLOYMENT_PROFILE = previousProfile;
    }
  });

  it('uses a stable explicit bootstrap receipt for mutation-free production getEngine', async () => {
    const migration = await migrations();
    const service = await import('../service');
    await migration.runMigrations(client);
    const bootstrapDb = forwardingExecutor(client, () => undefined);
    const receipt = await bootstrapAndVerifyApplication(bootstrapDb);
    expect(receipt).toMatchObject({
      state: 'ready',
      ready: true,
      migrationVersion: 2,
      receipt: {
        schemaVersion: 1,
        migrationVersion: 2,
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
