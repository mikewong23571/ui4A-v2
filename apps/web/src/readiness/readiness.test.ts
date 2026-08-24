import type { ReadinessResult } from '@ui4a/shared';
import { describe, expect, it, vi } from 'vitest';

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

interface WebReadinessDependencies<Db> {
  preflight(): unknown;
  database(): Db;
  postgres(db: Db): Promise<void>;
  migration(db: Db): Promise<MigrationStatus>;
  bootstrap(db: Db): Promise<BootstrapStatus>;
  temporal?: () => Promise<void>;
  keycloak?: () => Promise<void>;
  llm?: () => Promise<void>;
  runtime?: () => Promise<void>;
}

interface ReadinessModule {
  probeWebReadiness<Db>(dependencies: WebReadinessDependencies<Db>): Promise<ReadinessResult>;
}

const plannedModulePath = './readiness';

async function plannedApi(): Promise<ReadinessModule> {
  return (await import(plannedModulePath)) as ReadinessModule;
}

function readyMigration(): MigrationStatus {
  return { state: 'ready', currentVersion: 1, targetVersion: 1, ready: true };
}

function readyBootstrap(replayHash = `sha256:${'a'.repeat(64)}`): BootstrapStatus {
  return {
    state: 'ready',
    ready: true,
    migrationVersion: 1,
    receipt: {
      schemaVersion: 1,
      migrationVersion: 1,
      eventHighWaterMark: 12,
      replayHash,
    },
  };
}

function dependencies(
  overrides: Partial<WebReadinessDependencies<{ kind: 'db' }>> = {},
): WebReadinessDependencies<{ kind: 'db' }> {
  return {
    preflight: vi.fn(() => ({ profile: 'production' })),
    database: vi.fn(() => ({ kind: 'db' as const })),
    postgres: vi.fn(async () => undefined),
    migration: vi.fn(async () => readyMigration()),
    bootstrap: vi.fn(async () => readyBootstrap()),
    temporal: vi.fn(async () => undefined),
    keycloak: vi.fn(async () => undefined),
    llm: vi.fn(async () => undefined),
    runtime: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('Web read-only readiness probes', () => {
  it('is ready only after config, PostgreSQL, migration, bootstrap, and replay all pass', async () => {
    const { probeWebReadiness } = await plannedApi();

    await expect(probeWebReadiness(dependencies())).resolves.toMatchObject({
      component: 'ui4a-web',
      lifecycle: 'serving',
      status: 'ready',
      health: 'ok',
      reasonCodes: [],
      dependencies: {
        config: { required: true, status: 'ok' },
        postgres: { required: true, status: 'ok' },
        migration: { required: true, status: 'ok' },
        bootstrap: { required: true, status: 'ok' },
        replay: { required: true, status: 'ok' },
      },
    });
  });

  it('fails closed on invalid config without opening a database boundary', async () => {
    const { probeWebReadiness } = await plannedApi();
    const database = vi.fn(() => ({ kind: 'db' as const }));
    const input = dependencies({
      preflight: () => {
        throw new Error('invalid config with __secret__');
      },
      database,
    });

    const result = await probeWebReadiness(input);

    expect(result).toMatchObject({
      status: 'not-ready',
      health: 'degraded',
      dependencies: {
        config: { required: true, status: 'error', reasonCode: 'deployment_config_invalid' },
        postgres: { required: true, status: 'unknown', reasonCode: 'postgres_not_checked' },
      },
    });
    expect(database).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('__secret__');
  });

  it('fails closed on PostgreSQL errors without reading migration or bootstrap state', async () => {
    const { probeWebReadiness } = await plannedApi();
    const migration = vi.fn(async () => readyMigration());
    const bootstrap = vi.fn(async () => readyBootstrap());

    const result = await probeWebReadiness(
      dependencies({
        postgres: async () => {
          throw new Error('postgres://runtime:__password__@postgres/ui4a');
        },
        migration,
        bootstrap,
      }),
    );

    expect(result.dependencies).toMatchObject({
      postgres: { required: true, status: 'error', reasonCode: 'postgres_unavailable' },
      migration: { required: true, status: 'unknown', reasonCode: 'migration_not_checked' },
      bootstrap: { required: true, status: 'unknown', reasonCode: 'bootstrap_not_checked' },
      replay: { required: true, status: 'unknown', reasonCode: 'replay_not_checked' },
    });
    expect(result.status).toBe('not-ready');
    expect(migration).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('__password__');
  });

  it.each([
    [
      'pending',
      { state: 'pending', currentVersion: 0, targetVersion: 1, ready: false },
      'migration_required',
    ],
    [
      'incompatible',
      { state: 'incompatible', currentVersion: 2, targetVersion: 1, ready: false },
      'migration_incompatible',
    ],
  ] as const)('maps %s migration state without invoking bootstrap', async (_case, state, code) => {
    const { probeWebReadiness } = await plannedApi();
    const bootstrap = vi.fn(async () => readyBootstrap());

    const result = await probeWebReadiness(
      dependencies({ migration: async () => state, bootstrap }),
    );

    expect(result.status).toBe('not-ready');
    expect(result.dependencies.migration).toEqual({
      required: true,
      status: 'error',
      reasonCode: code,
    });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('keeps bootstrap and replay as separate required checks', async () => {
    const { probeWebReadiness } = await plannedApi();

    const pending = await probeWebReadiness(
      dependencies({
        bootstrap: async () => ({ state: 'pending', ready: false, migrationVersion: 1 }),
      }),
    );
    const invalidReplay = await probeWebReadiness(
      dependencies({ bootstrap: async () => readyBootstrap('not-a-replay-hash') }),
    );

    expect(pending.dependencies).toMatchObject({
      bootstrap: { required: true, status: 'error', reasonCode: 'bootstrap_incomplete' },
      replay: { required: true, status: 'unknown', reasonCode: 'replay_not_checked' },
    });
    expect(invalidReplay.dependencies).toMatchObject({
      bootstrap: { required: true, status: 'ok' },
      replay: { required: true, status: 'error', reasonCode: 'replay_integrity_unverified' },
    });
    expect(pending.status).toBe('not-ready');
    expect(invalidReplay.status).toBe('not-ready');
  });

  it('keeps unimplemented optional probes explicit without blocking safe readiness', async () => {
    const { probeWebReadiness } = await plannedApi();

    const result = await probeWebReadiness(
      dependencies({
        temporal: undefined,
        keycloak: undefined,
        llm: undefined,
        runtime: undefined,
      }),
    );

    expect(result).toMatchObject({
      status: 'ready',
      health: 'degraded',
      reasonCodes: [
        'keycloak_not_checked',
        'llm_not_checked',
        'runtime_backend_not_checked',
        'temporal_not_checked',
      ],
      dependencies: {
        keycloak: { required: false, status: 'unknown', reasonCode: 'keycloak_not_checked' },
        llm: { required: false, status: 'unknown', reasonCode: 'llm_not_checked' },
        runtime: {
          required: false,
          status: 'unknown',
          reasonCode: 'runtime_backend_not_checked',
        },
        temporal: { required: false, status: 'unknown', reasonCode: 'temporal_not_checked' },
      },
    });
  });

  it('normalizes optional dependency exceptions without removing safe Web readiness', async () => {
    const { probeWebReadiness } = await plannedApi();
    const secret = '__optional_probe_secret__';

    const result = await probeWebReadiness(
      dependencies({
        temporal: async () => {
          throw new Error(`Temporal failed with ${secret}`);
        },
        keycloak: async () => {
          throw new Error(`Keycloak failed with ${secret}`);
        },
        llm: async () => {
          throw new Error(`LLM failed with ${secret}`);
        },
        runtime: async () => {
          throw new Error(`Runtime failed with ${secret}`);
        },
      }),
    );

    expect(result).toMatchObject({
      status: 'ready',
      health: 'degraded',
      reasonCodes: [
        'keycloak_unavailable',
        'llm_unavailable',
        'runtime_backend_unavailable',
        'temporal_unavailable',
      ],
      dependencies: {
        keycloak: { required: false, status: 'error', reasonCode: 'keycloak_unavailable' },
        llm: { required: false, status: 'error', reasonCode: 'llm_unavailable' },
        runtime: {
          required: false,
          status: 'error',
          reasonCode: 'runtime_backend_unavailable',
        },
        temporal: { required: false, status: 'error', reasonCode: 'temporal_unavailable' },
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
