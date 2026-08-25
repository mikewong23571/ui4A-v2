import { describe, expect, it } from 'vitest';

type ReadinessLifecycle = 'starting' | 'serving' | 'draining';
type ReadinessDependencyStatus = 'ok' | 'degraded' | 'error' | 'unknown';

interface ReadinessDependencyInput {
  required: boolean;
  status: ReadinessDependencyStatus;
  reasonCode?: string;
}

interface ReadinessInput {
  component: string;
  lifecycle: ReadinessLifecycle;
  dependencies: Record<string, ReadinessDependencyInput>;
}

interface ReadinessResult {
  schemaVersion: 1;
  component: string;
  lifecycle: ReadinessLifecycle;
  status: 'ready' | 'not-ready';
  health: 'ok' | 'degraded';
  reasonCodes: string[];
  dependencies: Record<string, ReadinessDependencyInput>;
}

interface ReadinessModule {
  aggregateReadiness(input: ReadinessInput): ReadinessResult;
}

const plannedModulePath = './readiness';

async function plannedApi(): Promise<ReadinessModule> {
  return (await import(plannedModulePath)) as ReadinessModule;
}

function dependency(
  status: ReadinessDependencyStatus,
  required: boolean,
  reasonCode?: string,
): ReadinessDependencyInput {
  return {
    required,
    status,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

describe('platform-neutral readiness aggregation', () => {
  it.each([
    ['starting', 'not-ready', ['process_starting']],
    ['serving', 'ready', []],
    ['draining', 'not-ready', ['process_draining']],
  ] as const)(
    'maps the %s lifecycle to %s without conflating process life and dependency health',
    async (lifecycle, expectedStatus, reasonCodes) => {
      const { aggregateReadiness } = await plannedApi();

      expect(
        aggregateReadiness({
          component: 'ui4a-worker',
          lifecycle,
          dependencies: {
            postgres: dependency('ok', true),
            temporal: dependency('ok', true),
          },
        }),
      ).toMatchObject({
        schemaVersion: 1,
        component: 'ui4a-worker',
        lifecycle,
        status: expectedStatus,
        health: 'ok',
        reasonCodes,
      });
    },
  );

  it.each([
    ['degraded', 'postgres_slow'],
    ['error', 'postgres_unavailable'],
    ['unknown', 'postgres_not_checked'],
  ] as const)('keeps a required %s dependency not-ready', async (status, reasonCode) => {
    const { aggregateReadiness } = await plannedApi();

    expect(
      aggregateReadiness({
        component: 'ui4a-web',
        lifecycle: 'serving',
        dependencies: {
          config: dependency('ok', true),
          postgres: dependency(status, true, reasonCode),
        },
      }),
    ).toMatchObject({
      status: 'not-ready',
      health: 'degraded',
      reasonCodes: [reasonCode],
    });
  });

  it('reports optional degradation without removing a safely serving component from readiness', async () => {
    const { aggregateReadiness } = await plannedApi();

    expect(
      aggregateReadiness({
        component: 'ui4a-web',
        lifecycle: 'serving',
        dependencies: {
          config: dependency('ok', true),
          postgres: dependency('ok', true),
          temporal: dependency('error', false, 'temporal_unavailable'),
          llm: dependency('degraded', false, 'llm_unavailable'),
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      component: 'ui4a-web',
      lifecycle: 'serving',
      status: 'ready',
      health: 'degraded',
      reasonCodes: ['llm_unavailable', 'temporal_unavailable'],
      dependencies: {
        config: { required: true, status: 'ok' },
        llm: { required: false, status: 'degraded', reasonCode: 'llm_unavailable' },
        postgres: { required: true, status: 'ok' },
        temporal: { required: false, status: 'error', reasonCode: 'temporal_unavailable' },
      },
    });
  });

  it('returns a detached, whitelisted snapshot without exceptions, diagnostics, or Secret values', async () => {
    const { aggregateReadiness } = await plannedApi();
    const secret = '__database_password_must_not_escape__';
    const postgres = {
      ...dependency('error', true, 'postgres_unavailable'),
      error: new Error(`connect failed with ${secret}`),
      detail: { connectionString: `postgres://runtime:${secret}@postgres/ui4a` },
    };
    const input = {
      component: 'ui4a-web',
      lifecycle: 'serving' as const,
      dependencies: { postgres },
    };

    const result = aggregateReadiness(input);
    postgres.status = 'ok';
    postgres.reasonCode = 'mutated_after_aggregation';
    input.dependencies.postgres.detail.connectionString = secret;

    expect(result.dependencies.postgres).toEqual({
      required: true,
      status: 'error',
      reasonCode: 'postgres_unavailable',
    });
    expect(result.reasonCodes).toEqual(['postgres_unavailable']);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('connect failed');
    expect(result.dependencies.postgres).not.toHaveProperty('error');
    expect(result.dependencies.postgres).not.toHaveProperty('detail');
  });
});
