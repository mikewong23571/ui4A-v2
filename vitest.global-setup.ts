import { closeAllPools, getPool } from './apps/web/src/db/pool';

const DEFAULT_TEST_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';

function databaseName(connectionString: string): string {
  const name = new URL(connectionString).pathname.replace(/^\//, '');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe test database name: ${name}`);
  }
  return name;
}

export default async function setup(): Promise<void> {
  const target = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const targetPool = getPool(target);
  try {
    await targetPool.query('SELECT 1');
    return;
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') throw error;
  } finally {
    await closeAllPools();
  }

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
