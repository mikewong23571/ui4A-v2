import { describe, expect, it, vi } from 'vitest';

interface WorkerReadinessModule {
  createWorkerReadinessState(): {
    markDependency(
      name: 'config' | 'postgres' | 'migration' | 'bootstrap' | 'replay' | 'temporal',
      status: 'ok' | 'degraded' | 'error' | 'unknown',
      reasonCode?: string,
    ): void;
    markServing(): void;
    beginDraining(): void;
    snapshot(): {
      lifecycle: 'starting' | 'serving' | 'draining';
      status: 'ready' | 'not-ready';
      dependencies: Record<string, unknown>;
    };
  };
  probeWorkerDependencies(input: {
    db: { query(sqlText: string): Promise<{ rows: unknown[] }> };
    getMigrationStatus?: () => Promise<{ ready: boolean; state: string }>;
    getBootstrapStatus?: () => Promise<{ ready: boolean; state: string }>;
  }): Promise<
    Record<
      'postgres' | 'migration' | 'bootstrap' | 'replay',
      { required: true; status: string; reasonCode?: string }
    >
  >;
}

const plannedModule = './worker-readiness';

async function api(): Promise<WorkerReadinessModule> {
  return (await import(plannedModule)) as WorkerReadinessModule;
}

describe('Worker readiness lifecycle and dependency probes', () => {
  it('allows only starting -> serving -> draining and keeps repeated drain idempotent', async () => {
    const state = (await api()).createWorkerReadinessState();
    expect(state.snapshot()).toMatchObject({ lifecycle: 'starting', status: 'not-ready' });
    for (const dependency of [
      'config',
      'postgres',
      'migration',
      'bootstrap',
      'replay',
      'temporal',
    ] as const) {
      state.markDependency(dependency, 'ok');
    }
    state.markServing();
    expect(state.snapshot()).toMatchObject({ lifecycle: 'serving', status: 'ready' });
    state.beginDraining();
    state.beginDraining();
    expect(state.snapshot()).toMatchObject({ lifecycle: 'draining', status: 'not-ready' });
    expect(() => state.markServing()).toThrow(/transition|draining/i);
  });

  it('never serves before every required dependency is ok and exposes no diagnostics', async () => {
    const state = (await api()).createWorkerReadinessState();
    const secret = '__worker_database_secret__';
    state.markDependency('config', 'ok');
    state.markDependency('postgres', 'error', 'postgres_unavailable');
    state.markDependency('migration', 'unknown', 'migration_not_checked');
    state.markDependency('bootstrap', 'unknown', 'bootstrap_not_checked');
    state.markDependency('replay', 'unknown', 'replay_not_checked');
    state.markDependency('temporal', 'ok');

    expect(() => state.markServing()).toThrow(/dependencies|ready/i);
    const snapshot = state.snapshot();
    expect(snapshot).toMatchObject({ lifecycle: 'starting', status: 'not-ready' });
    expect(JSON.stringify({ snapshot })).not.toContain(secret);
  });

  it('uses read-only PostgreSQL and migration/bootstrap facts', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) };
    const getMigrationStatus = vi.fn(async () => ({
      ready: true,
      state: 'ready',
      currentVersion: 1,
      targetVersion: 1,
    }));
    const getBootstrapStatus = vi.fn(async () => ({
      ready: true,
      state: 'ready',
      receipt: {
        schemaVersion: 1,
        migrationVersion: 1,
        eventHighWaterMark: 42,
        replayHash: `sha256:${'a'.repeat(64)}`,
      },
    }));

    await expect(
      (await api()).probeWorkerDependencies({ db, getMigrationStatus, getBootstrapStatus }),
    ).resolves.toEqual({
      postgres: { required: true, status: 'ok' },
      migration: { required: true, status: 'ok' },
      bootstrap: { required: true, status: 'ok' },
      replay: { required: true, status: 'ok' },
    });
    expect(db.query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
    expect(getMigrationStatus).toHaveBeenCalledOnce();
    expect(getBootstrapStatus).toHaveBeenCalledOnce();
  });

  it.each([
    ['postgres', new Error('db secret'), false, 'postgres_unavailable'],
    ['migration', undefined, false, 'migration_required'],
    ['bootstrap', undefined, false, 'bootstrap_required'],
  ] as const)(
    'normalizes %s failure without leaking an exception',
    async (kind, dbError, ready, code) => {
      const db = {
        query: vi.fn(async () => {
          if (dbError !== undefined) throw dbError;
          return { rows: [{ '?column?': 1 }] };
        }),
      };
      const result = await (
        await api()
      ).probeWorkerDependencies({
        db,
        getMigrationStatus: vi.fn(async () => ({
          ready: kind === 'migration' ? ready : true,
          state: kind === 'migration' ? 'pending' : 'ready',
          currentVersion: kind === 'migration' ? 0 : 1,
          targetVersion: 1,
        })),
        getBootstrapStatus: vi.fn(async () => ({
          ready: kind === 'bootstrap' ? ready : true,
          state: kind === 'bootstrap' ? 'pending' : 'ready',
          ...(kind === 'bootstrap'
            ? {}
            : {
                receipt: {
                  schemaVersion: 1 as const,
                  migrationVersion: 1,
                  eventHighWaterMark: 42,
                  replayHash: `sha256:${'a'.repeat(64)}`,
                },
              }),
        })),
      });

      const dependency =
        kind === 'postgres' ? 'postgres' : kind === 'migration' ? 'migration' : 'bootstrap';
      expect(result[dependency]).toMatchObject({
        status: kind === 'postgres' ? 'error' : 'degraded',
        reasonCode: code,
      });
      expect(JSON.stringify(result)).not.toContain('db secret');
    },
  );

  it.each([
    ['missing receipt', undefined],
    [
      'wrong schema',
      {
        schemaVersion: 2,
        migrationVersion: 1,
        eventHighWaterMark: 42,
        replayHash: `sha256:${'a'.repeat(64)}`,
      },
    ],
    [
      'wrong migration',
      {
        schemaVersion: 1,
        migrationVersion: 2,
        eventHighWaterMark: 42,
        replayHash: `sha256:${'a'.repeat(64)}`,
      },
    ],
    [
      'invalid high-water mark',
      {
        schemaVersion: 1,
        migrationVersion: 1,
        eventHighWaterMark: -1,
        replayHash: `sha256:${'a'.repeat(64)}`,
      },
    ],
    [
      'invalid replay hash',
      {
        schemaVersion: 1,
        migrationVersion: 1,
        eventHighWaterMark: 42,
        replayHash: 'not-a-sha256',
      },
    ],
  ])('keeps an otherwise ready bootstrap not-ready for %s', async (_name, receipt) => {
    const result = await (
      await api()
    ).probeWorkerDependencies({
      db: { query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) },
      getMigrationStatus: vi.fn(async () => ({
        ready: true,
        state: 'ready',
        currentVersion: 1,
        targetVersion: 1,
      })),
      getBootstrapStatus: vi.fn(async () => ({
        ready: true,
        state: 'ready',
        ...(receipt === undefined ? {} : { receipt }),
      })),
    });

    expect(result).toMatchObject({
      bootstrap: { status: 'ok' },
      replay: { status: 'error', reasonCode: 'replay_receipt_invalid' },
    });
  });
});
