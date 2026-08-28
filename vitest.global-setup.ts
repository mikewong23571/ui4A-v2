import { closeAllPools, getPool } from './packages/db/src/pool';

const DEFAULT_TEST_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';

function databaseName(connectionString: string): string {
  const name = new URL(connectionString).pathname.replace(/^\//, '');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe test database name: ${name}`);
  }
  return name;
}

/**
 * Vitest 文件在单个进程内已串行，但两个独立 `pnpm test` 进程仍会共享同一
 * test database，并互相 TRUNCATE events。持有数据库名派生的 session advisory
 * lock 覆盖整个 run：同库测试进程排队，不同 TEST_DATABASE_URL 仍可并行。
 */
export default async function setup(): Promise<() => Promise<void>> {
  const target = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const targetPool = getPool(target);
  let exists = false;
  try {
    await targetPool.query('SELECT 1');
    exists = true;
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') throw error;
  } finally {
    await closeAllPools();
  }

  if (!exists) {
    const adminUrl = new URL(target);
    const name = databaseName(target);
    adminUrl.pathname = '/postgres';
    const adminPool = getPool(adminUrl.toString());
    try {
      await adminPool.query(`CREATE DATABASE "${name}"`);
    } catch (error) {
      // Two concurrent test processes may both observe a missing database.
      if ((error as { code?: string }).code !== '42P04') throw error;
    } finally {
      await closeAllPools();
    }
  }

  const lockPool = getPool(target);
  const lockClient = await lockPool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock(hashtext(current_database()))');
  } catch (error) {
    lockClient.release();
    await closeAllPools();
    throw error;
  }

  return async () => {
    try {
      await lockClient.query('SELECT pg_advisory_unlock(hashtext(current_database()))');
    } finally {
      lockClient.release();
      await closeAllPools();
    }
  };
}
