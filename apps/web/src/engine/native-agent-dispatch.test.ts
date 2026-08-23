import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../temporal/agent-run', () => ({
  dispatchAgentRun: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `agent-${runId}`,
  })),
  cancelAgentRun: vi.fn(async () => undefined),
}));
vi.mock('../temporal/capability', () => ({
  dispatchCodingCapability: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `coding-${runId}`,
  })),
  cancelCodingCapability: vi.fn(async () => undefined),
}));

import { ensureAgentDefinitionTables } from '../db/agent-definitions';
import { ensureAgentRunTables, listAgentRuns } from '../db/agent-runs';
import { ensureCapabilityRunTables, listCapabilityRuns } from '../db/capability-runs';
import { ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';
import { dispatchAgentRun } from '../temporal/agent-run';
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

function request() {
  return {
    rel: 'software-change:main',
    action: 'start-implementation',
    actor: 'human' as const,
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
  };
}

beforeEach(async () => {
  vi.stubEnv('UI4A_CODING_EXECUTOR_PROFILES', JSON.stringify([profile]));
  vi.mocked(dispatchAgentRun).mockClear();
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await ensureAgentRunTables(pool);
  await ensureAgentDefinitionTables(pool);
  await pool.query(
    `TRUNCATE agent_run_projection, agent_run_projection_state,
      capability_run_projection, capability_payloads,
      agent_definition_active, agent_definition_versions, agent_definition_payloads, events`,
  );
  resetEngineForTests();
});

describe('native Agent dispatch from an Application capability', () => {
  it('pins definition, typed Prompt, runtime and contracts in one native birth record', async () => {
    const engine = await getEngine(pool);
    const outcome = await engine.exec(request());

    expect(outcome.kind).toBe('accepted');
    const runs = await listAgentRuns(pool, {
      principal: 'local-user',
      policyScope: 'development',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'queued',
      birth: {
        kind: 'event-native',
        definition: { ref: 'coding-agent', version: 1 },
        runtime: { profileName: 'default', profileVersion: '1' },
      },
      task: { payload: { kind: 'coding-task', codingTask: { goal: 'add sum' } } },
    });
    expect(runs[0]?.birth.prompt.compiledHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(runs[0]?.task.payload).toMatchObject({
      compiledPrompt: {
        compiledHash: runs[0]?.birth.prompt.compiledHash,
        messages: expect.any(Array),
      },
    });
    expect(
      await listCapabilityRuns(pool, { principal: 'local-user', policyScope: 'development' }),
    ).toEqual([]);
    expect(dispatchAgentRun).toHaveBeenCalledOnce();
  });

  it('fails before the source transition when the exact Runtime profile is missing', async () => {
    vi.stubEnv('UI4A_CODING_EXECUTOR_PROFILES', '[]');
    const engine = await getEngine(pool);
    const before = await readLog(pool);

    await expect(engine.exec(request())).rejects.toThrow('profile');

    expect((await engine.getEntity('software-change:main'))?.properties.node).toBe(
      'implementation-ready',
    );
    expect(await readLog(pool)).toEqual(before);
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });

  it('fails before the source transition when the exact Agent Definition is unavailable', async () => {
    const engine = await getEngine(pool);
    await pool.query(
      `DELETE FROM agent_definition_active
       WHERE principal='local-user' AND policy_scope='development' AND definition_name='coding-agent'`,
    );
    await pool.query(
      `UPDATE agent_definition_versions SET status='registered'
       WHERE principal='local-user' AND policy_scope='development' AND definition_name='coding-agent'`,
    );
    const before = await readLog(pool);

    await expect(engine.exec(request())).rejects.toThrow('not active');

    expect((await engine.getEntity('software-change:main'))?.properties.node).toBe(
      'implementation-ready',
    );
    expect(await readLog(pool)).toEqual(before);
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });
});
