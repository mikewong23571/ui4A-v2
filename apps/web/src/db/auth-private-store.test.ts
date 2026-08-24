import { beforeAll, describe, expect, it } from 'vitest';

import type { AuthPrivateStore } from '../auth/browser-session';

import { ensureEventsTable, type DbExecutor } from './events';
import { getPool } from './pool';

interface PostgresAuthPrivateStore extends AuthPrivateStore {
  cleanupExpired(): Promise<number>;
}

interface AuthPrivateStoreModule {
  AUTH_PRIVATE_STORE_DDL: string;
  createPostgresAuthPrivateStore(
    db: DbExecutor,
    options: { clock(): number },
  ): PostgresAuthPrivateStore;
}

const NOW_MS = 1_788_739_200_000;
const connectionString =
  process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';
const pool = getPool(connectionString);
const plannedModulePath = './auth-private-store';
let api: AuthPrivateStoreModule;

async function plannedApi(): Promise<AuthPrivateStoreModule> {
  return (await import(plannedModulePath)) as AuthPrivateStoreModule;
}

beforeAll(async () => {
  api = await plannedApi();
  await ensureEventsTable(pool);
  // Schema installation is an explicit test/migration step. Store construction and request calls
  // must never execute DDL implicitly.
  await pool.query(api.AUTH_PRIVATE_STORE_DDL);
  await pool.query("DELETE FROM auth_private_records WHERE record_key LIKE 't22-browser:%'");
});

describe('PostgreSQL AuthPrivateStore production contract', () => {
  it('never performs request-time DDL while constructing or reading the store', async () => {
    const queries: string[] = [];
    const executor = {
      query: async (sqlText: string) => {
        queries.push(sqlText);
        return { rows: [] };
      },
    } as unknown as DbExecutor;

    const store = api.createPostgresAuthPrivateStore(executor, { clock: () => NOW_MS });
    await expect(store.get('t22-browser:missing')).resolves.toBeUndefined();
    expect(queries.join('\n')).not.toMatch(/\b(?:CREATE|ALTER|DROP)\b/i);
  });

  it('implements put/get/delete with TTL and deterministic expired-record cleanup', async () => {
    const store = api.createPostgresAuthPrivateStore(pool, { clock: () => NOW_MS });
    await store.put('t22-browser:live', { kind: 'session', value: 'private' }, NOW_MS + 60_000);
    await expect(store.get('t22-browser:live')).resolves.toEqual({
      kind: 'session',
      value: 'private',
    });

    await store.put('t22-browser:expired', { kind: 'session' }, NOW_MS - 1);
    await expect(store.get('t22-browser:expired')).resolves.toBeUndefined();
    await expect(store.cleanupExpired()).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      pool.query(
        "SELECT record_key FROM auth_private_records WHERE record_key LIKE 't22-browser:%'",
      ),
    ).resolves.toMatchObject({ rows: [{ record_key: 't22-browser:live' }] });

    await store.delete('t22-browser:live');
    await expect(store.get('t22-browser:live')).resolves.toBeUndefined();
  });

  it('atomically single-consumes take across independent Web replica adapters', async () => {
    const replicaA = api.createPostgresAuthPrivateStore(pool, { clock: () => NOW_MS });
    const replicaB = api.createPostgresAuthPrivateStore(pool, { clock: () => NOW_MS });
    const payload = { kind: 'browser-login', state: 'single-use' };
    await replicaA.put('t22-browser:single-consume', payload, NOW_MS + 60_000);

    const results = await Promise.all([
      replicaA.take('t22-browser:single-consume'),
      replicaB.take('t22-browser:single-consume'),
    ]);

    expect(results.filter((value) => value !== undefined)).toEqual([payload]);
    await expect(replicaA.get('t22-browser:single-consume')).resolves.toBeUndefined();
  });

  it('keeps browser credentials in the auth-private table and out of the event log', async () => {
    const store = api.createPostgresAuthPrivateStore(pool, { clock: () => NOW_MS });
    const marker = '__t22_private_refresh_token_must_not_enter_events__';
    await store.put(
      't22-browser:not-an-event',
      { kind: 'browser-session', refreshToken: marker },
      NOW_MS + 60_000,
    );

    const leaked = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM events
       WHERE coalesce(detail::text, '') LIKE $1
          OR coalesce(rel, '') = $2`,
      [`%${marker}%`, 't22-browser:not-an-event'],
    );
    expect(leaked.rows).toEqual([{ count: 0 }]);
    await store.delete('t22-browser:not-an-event');
  });
});
