import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../temporal/capability', () => ({
  dispatchCodingCapability: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `coding-${runId}`,
  })),
  cancelCodingCapability: vi.fn(async () => undefined),
}));

import { ensureCapabilityRunTables, listCapabilityRuns } from '../db/capability-runs';
import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { enrichEntityWithCapabilityRuns, getCapabilityRunEntity } from './capability-runs';
import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL!);
const profile = {
  name: 'default',
  executorClass: 'coding-agent',
  providerId: 'codex',
  transport: 'sdk',
  workspaceBackend: 'isolated-worktree',
  sandbox: 'workspace-write',
  timeoutSeconds: 300,
  maxTurns: 20,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};

beforeEach(async () => {
  vi.stubEnv('UI4A_CODING_EXECUTOR_PROFILES', JSON.stringify([profile]));
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await pool.query('TRUNCATE capability_run_projection, capability_payloads, events');
  resetEngineForTests();
});

describe('coding capability dispatch and Siren projection', () => {
  it('starts asynchronously from the Flow action and links the source entity', async () => {
    const engine = await getEngine(pool);
    const outcome = await engine.exec({
      rel: 'software-change:main',
      action: 'start-implementation',
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
      params: {
        repositoryRef: 'repo-fixture',
        baseRevision: 'a'.repeat(40),
        goal: 'add sum',
        constraints: [],
        acceptanceCriteria: ['tests pass'],
        allowedPaths: ['src', 'test'],
      },
    });
    expect(outcome.kind).toBe('accepted');
    expect(outcome.kind === 'accepted' && outcome.entity.properties.node).toBe(
      'implementation-running',
    );
    const runs = await listCapabilityRuns(pool, {
      principal: 'local-user',
      policyScope: 'development',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'queued', source: { rel: 'software-change:main' } });
    const runEntity = await getCapabilityRunEntity(
      pool,
      `capability-run:${runs[0]!.runId}`,
      'local-user',
      'development',
    );
    expect(runEntity?.actions.map((action) => action.name)).toEqual(['cancel']);
    const source = await engine.getEntity('software-change:main');
    const enriched = await enrichEntityWithCapabilityRuns(
      pool,
      source!,
      'local-user',
      'development',
    );
    expect(enriched.links.some((link) => link.rel.includes('capability-run'))).toBe(true);
  });

  it('fails before the business transition when the server profile is missing', async () => {
    vi.stubEnv('UI4A_CODING_EXECUTOR_PROFILES', '[]');
    const engine = await getEngine(pool);
    await expect(
      engine.exec({
        rel: 'software-change:main',
        action: 'start-implementation',
        actor: 'human',
        principal: 'local-user',
        params: {
          repositoryRef: 'repo-fixture',
          baseRevision: 'a'.repeat(40),
          goal: 'x',
          constraints: [],
          acceptanceCriteria: ['test'],
          allowedPaths: ['src'],
        },
      }),
    ).rejects.toThrow('profile');
    expect((await engine.getEntity('software-change:main'))?.properties.node).toBe(
      'implementation-ready',
    );
    expect(
      await listCapabilityRuns(pool, { principal: 'local-user', policyScope: 'development' }),
    ).toEqual([]);
  });
});
