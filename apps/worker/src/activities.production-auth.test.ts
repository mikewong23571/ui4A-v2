import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { AgentDriver, FetchLike } from '@ui4a/agent';
import type { SirenEntity } from '@ui4a/engine';
import type { ProductionDeploymentConfig } from '@ui4a/shared';

import type { DbExecutor } from '../../web/src/db/events';
import type { AgentStepArgs, AgentStepResult } from './workflows';

const PUBLIC_ORIGIN = 'https://ui4a.mothership.internal';
const ACCESS_TOKEN = 'worker-service-access-token-fixture';
const CLIENT_SECRET = 'worker-agent-client-secret-fixture';

interface AgentCredentialResult {
  authorizationHeader: string;
  expiresAtMs: number;
}

interface AgentClientCredentialProvider {
  getClientCredential(): Promise<AgentCredentialResult>;
}

interface ProductionAgentActivityDeps {
  config: ProductionDeploymentConfig;
  credentialProvider: AgentClientCredentialProvider;
  fetchImpl: FetchLike;
  db: DbExecutor;
  driver?: AgentDriver;
}

interface ProductionAgentActivityModule {
  loadSitemapWithProductionAuth(
    deps: ProductionAgentActivityDeps,
    args: { baseUrl: string },
  ): Promise<unknown>;
  agentStepWithProductionAuth(
    deps: ProductionAgentActivityDeps,
    args: AgentStepArgs,
  ): Promise<AgentStepResult>;
}

// This indirection keeps the suite executable as a bounded Red: the module exists, while the
// production credential composition exports intentionally do not exist until the Green step.
async function plannedApi(): Promise<ProductionAgentActivityModule> {
  return (await import('./activities')) as unknown as ProductionAgentActivityModule;
}

const config = {
  settings: { service: { publicOrigin: PUBLIC_ORIGIN } },
  secrets: {},
} as unknown as ProductionDeploymentConfig;

const entity: SirenEntity = {
  class: ['flow-instance', 'post-status'],
  properties: { rel: 'post:first', flow: 'post-status', node: 'draft' },
  actions: [
    {
      name: 'publish',
      title: 'Publish',
      method: 'POST',
      href: '/api/exec',
      fields: {},
    },
  ],
  links: [{ rel: ['self'], href: '/api/entity?rel=post:first' }],
  'guard-results': [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function fakeDb() {
  const queries: { sqlText: string; values: readonly unknown[] }[] = [];
  const inserts: { sqlText: string; values: readonly unknown[] }[] = [];
  const db: DbExecutor = {
    async query<R extends QueryResultRow = QueryResultRow>(
      sqlText: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ sqlText, values: values ?? [] });
      if (sqlText.startsWith('SELECT detail FROM events')) {
        return { rows: [], rowCount: 0 } as unknown as QueryResult<R>;
      }
      if (sqlText.startsWith('INSERT INTO events')) {
        inserts.push({ sqlText, values: values ?? [] });
        return {
          rows: [{ seq: '9', ts: new Date('2026-08-24T00:00:00Z') }],
          rowCount: 1,
        } as unknown as QueryResult<R>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<R>;
    },
  };
  return { db, queries, inserts };
}

function credentialProvider() {
  return {
    getClientCredential: vi.fn(async () => ({
      authorizationHeader: `Bearer ${ACCESS_TOKEN}`,
      expiresAtMs: Date.parse('2026-08-24T00:05:00Z'),
    })),
  } satisfies AgentClientCredentialProvider;
}

function stepArgs(baseUrl = PUBLIC_ORIGIN): AgentStepArgs {
  return {
    delegationId: 'delegation:worker-service-1',
    step: 1,
    goal: { verb: 'publish', targetRel: 'post:first' },
    driverKind: 'llm',
    baseUrl,
    scope: 'publishing',
    currentRel: 'post:first',
    trail: [],
    successes: [],
  };
}

function activityDeps(
  options: {
    fetchImpl?: FetchLike;
    provider?: AgentClientCredentialProvider;
    driver?: AgentDriver;
  } = {},
) {
  const database = fakeDb();
  return {
    database,
    deps: {
      config,
      credentialProvider: options.provider ?? credentialProvider(),
      fetchImpl:
        options.fetchImpl ??
        (vi.fn(async () => jsonResponse({ error: 'unexpected request' }, 500)) as FetchLike),
      db: database.db,
      ...(options.driver === undefined ? {} : { driver: options.driver }),
    },
  };
}

describe('T22 Worker production Agent service credential boundary', () => {
  it('loadSitemap obtains a client credential inside the Activity and binds it to the canonical contract request', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return jsonResponse({ version: '1', surfaces: [] });
    });
    const provider = credentialProvider();
    const { deps } = activityDeps({ fetchImpl, provider });
    const api = await plannedApi();

    const result = await api.loadSitemapWithProductionAuth(deps, { baseUrl: PUBLIC_ORIGIN });

    expect(provider.getClientCredential).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      {
        url: `${PUBLIC_ORIGIN}/.well-known/ui4a.json`,
        authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
  });

  it('agentStep obtains a fresh service credential, uses only allowlisted same-origin contract paths, and never self-reports identity', async () => {
    const requests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      body?: Record<string, unknown>;
    }> = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({
        url,
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('authorization'),
        ...(body === undefined ? {} : { body }),
      });
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ entity });
      return jsonResponse(entity);
    });
    const provider = credentialProvider();
    const driver: AgentDriver = {
      decide: () => ({ kind: 'exec', action: 'publish', params: { title: 'First' } }),
    };
    const { deps, database } = activityDeps({ fetchImpl, provider, driver });
    const args = stepArgs();
    const api = await plannedApi();

    const result = await api.agentStepWithProductionAuth(deps, args);

    expect(result.outcome).toBe('executed');
    expect(provider.getClientCredential).toHaveBeenCalledTimes(1);
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual(['/api/entity', '/api/exec']);
    expect(requests.every(({ url }) => new URL(url).origin === PUBLIC_ORIGIN)).toBe(true);
    expect(requests.every(({ authorization }) => authorization === `Bearer ${ACCESS_TOKEN}`)).toBe(
      true,
    );
    const execBody = requests.find(({ method }) => method === 'POST')?.body;
    expect(execBody).toEqual({ rel: 'post:first', action: 'publish', params: { title: 'First' } });
    expect(execBody).not.toHaveProperty('actor');
    expect(execBody).not.toHaveProperty('principal');

    const serializedArgs = JSON.stringify(args);
    const serializedResult = JSON.stringify(result);
    const serializedEvents = JSON.stringify(database.inserts);
    for (const serialized of [serializedArgs, serializedResult, serializedEvents]) {
      expect(serialized).not.toContain(ACCESS_TOKEN);
      expect(serialized).not.toContain(CLIENT_SECRET);
    }
  });

  it.each([
    [
      'loadSitemap',
      (api: ProductionAgentActivityModule, deps: ProductionAgentActivityDeps) =>
        api.loadSitemapWithProductionAuth(deps, { baseUrl: 'https://attacker.invalid' }),
    ],
    [
      'agentStep',
      (api: ProductionAgentActivityModule, deps: ProductionAgentActivityDeps) =>
        api.agentStepWithProductionAuth(deps, stepArgs('https://attacker.invalid')),
    ],
  ])('%s rejects a workflow baseUrl mismatch before token, fetch, or DB access', async (_, run) => {
    const provider = credentialProvider();
    const fetchImpl = vi.fn() as unknown as FetchLike;
    const { deps, database } = activityDeps({ fetchImpl, provider });
    const api = await plannedApi();

    await expect(run(api, deps)).rejects.toThrow(/base url|origin|canonical/i);

    expect(provider.getClientCredential).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(database.queries).toHaveLength(0);
  });

  it.each([
    [
      'loadSitemap',
      (api: ProductionAgentActivityModule, deps: ProductionAgentActivityDeps) =>
        api.loadSitemapWithProductionAuth(deps, { baseUrl: PUBLIC_ORIGIN }),
    ],
    [
      'agentStep',
      (api: ProductionAgentActivityModule, deps: ProductionAgentActivityDeps) =>
        api.agentStepWithProductionAuth(deps, stepArgs()),
    ],
  ])(
    '%s fails closed when the token endpoint fails without leaking credentials',
    async (_, run) => {
      const provider = {
        getClientCredential: vi.fn(async () => {
          throw new Error(`token endpoint unavailable: ${ACCESS_TOKEN} ${CLIENT_SECRET}`);
        }),
      } satisfies AgentClientCredentialProvider;
      const fetchImpl = vi.fn() as unknown as FetchLike;
      const { deps, database } = activityDeps({ fetchImpl, provider });
      const logged: unknown[][] = [];
      const log = vi.spyOn(console, 'error').mockImplementation((...values) => {
        logged.push(values);
      });
      const api = await plannedApi();

      let failure: unknown;
      try {
        await run(api, deps);
      } catch (error) {
        failure = error;
      } finally {
        log.mockRestore();
      }

      expect(failure).toBeInstanceOf(Error);
      const serializedFailure = JSON.stringify({
        name: (failure as Error).name,
        message: (failure as Error).message,
        stack: (failure as Error).stack,
      });
      expect(serializedFailure).not.toContain(ACCESS_TOKEN);
      expect(serializedFailure).not.toContain(CLIENT_SECRET);
      expect(provider.getClientCredential).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(database.queries).toHaveLength(0);
      expect(JSON.stringify(logged)).not.toContain(ACCESS_TOKEN);
      expect(JSON.stringify(logged)).not.toContain(CLIENT_SECRET);
    },
  );
});
