import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

vi.mock('../temporal/agent-run', () => ({
  dispatchAgentRun: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `agent-${runId}`,
  })),
  cancelAgentRun: vi.fn(async () => undefined),
}));

import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { ensureAgentDefinitionTables } from '../db/agent-definitions';
import {
  appendAgentRunCommand,
  ensureAgentRunTables,
  listAgentRuns,
  storeAgentRunPayload,
} from '../db/agent-runs';
import { dispatchAgentRun } from '../temporal/agent-run';
import {
  enrichEntityWithAgentRuns,
  executeAgentRunAction,
  getAgentRunEntity,
} from './agent/agent-runs';
import { finalizeAgentRunSource } from './agent/agent-run-source-callback';
import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL!);
const runFile = promisify(execFile);
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
  await ensureAgentRunTables(pool);
  await ensureAgentDefinitionTables(pool);
  await pool.query(
    `TRUNCATE agent_run_projection, agent_run_projection_state,
      agent_definition_active, agent_definition_versions, agent_definition_payloads, events`,
  );
  resetEngineForTests();
});

describe('coding agent dispatch and Siren projection', () => {
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
    expect(outcome.kind === 'accepted' && outcome.entity.actions).toEqual([]);
    const runs = await listAgentRuns(pool, {
      principal: 'local-user',
      policyScope: 'development',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'queued', source: { rel: 'software-change:main' } });
    const runEntity = await getAgentRunEntity(pool, `agent-run:${runs[0]!.runId}`, 'local-user');
    expect(runEntity?.actions.map((action) => action.name)).toEqual(['cancel']);
    const source = await engine.getEntity('software-change:main');
    const enriched = await enrichEntityWithAgentRuns(pool, source!, 'local-user');
    expect(enriched.links.some((link) => link.rel.includes('agent-run'))).toBe(true);
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
      await listAgentRuns(pool, { principal: 'local-user', policyScope: 'development' }),
    ).toEqual([]);
  });

  it('closes the source Flow when Temporal dispatch fails after the action event', async () => {
    vi.mocked(dispatchAgentRun).mockRejectedValueOnce(new Error('Temporal unavailable'));
    const engine = await getEngine(pool);
    const outcome = await engine.exec({
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
    });
    expect(outcome.kind).toBe('accepted');
    expect(outcome.kind === 'accepted' && outcome.entity.properties.node).toBe(
      'implementation-failed',
    );
    expect(
      await listAgentRuns(pool, { principal: 'local-user', policyScope: 'development' }),
    ).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('persists human cancellation instead of relying on an executor terminal event', async () => {
    const engine = await getEngine(pool);
    await engine.exec({
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
    });
    const run = (
      await listAgentRuns(pool, { principal: 'local-user', policyScope: 'development' })
    )[0]!;
    const outcome = await executeAgentRunAction(pool, {
      rel: `agent-run:${run.runId}`,
      action: 'cancel',
      actor: 'human',
      principal: 'local-user',
    });
    expect(outcome.kind).toBe('accepted');
    expect(outcome.kind === 'accepted' && outcome.entity.properties.status).toBe('cancelled');
  });

  it('revalidates a native coding-agent result before a human no-merge decision', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'ui4a-native-decision-repo-'));
    await runFile('git', ['init', '-q', repository]);
    await runFile('git', ['-C', repository, 'config', 'user.email', 'fixture@ui4a.dev']);
    await runFile('git', ['-C', repository, 'config', 'user.name', 'UI4A Fixture']);
    await writeFile(join(repository, 'README.md'), 'fixture\n');
    await runFile('git', ['-C', repository, 'add', '.']);
    await runFile('git', ['-C', repository, 'commit', '-qm', 'seed']);
    const base = (await runFile('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim();
    vi.stubEnv(
      'UI4A_CODING_REPOSITORIES',
      JSON.stringify({ 'repo-fixture': { path: repository, scopes: ['development'] } }),
    );
    const engine = await getEngine(pool);
    await engine.exec({
      rel: 'software-change:main',
      action: 'start-implementation',
      actor: 'human',
      principal: 'local-user',
      params: {
        repositoryRef: 'repo-fixture',
        baseRevision: base,
        goal: 'x',
        constraints: [],
        acceptanceCriteria: ['test'],
        allowedPaths: ['src'],
      },
    });
    let run = (
      await listAgentRuns(pool, { principal: 'local-user', policyScope: 'development' })
    )[0]!;
    const patch = await storeAgentRunPayload(pool, 'patch', 'text/x-diff');
    const trajectory = await storeAgentRunPayload(pool, [], 'application/x-ndjson');
    const codingResult = {
      schemaVersion: 1 as const,
      resultId: `result:${run.runId}`,
      baseRevision: base,
      headRevision: base,
      patch: { hash: patch.hash, sizeBytes: patch.bytes, mediaType: 'text/x-diff' },
      trajectory: {
        hash: trajectory.hash,
        sizeBytes: trajectory.bytes,
        mediaType: 'application/x-ndjson',
      },
      commits: [],
      changedFiles: ['src/a.ts'],
      testRuns: [{ command: 'test', exitCode: 0, passed: true }],
      summary: 'done',
    };
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'prepare',
        runId: run.runId,
        expectedRevision: run.revision,
        commandId: `prepare:${run.runId}`,
        eventId: `event:prepare:${run.runId}`,
      })
    ).aggregate;
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'start',
        runId: run.runId,
        expectedRevision: run.revision,
        commandId: `start:${run.runId}`,
        eventId: `event:start:${run.runId}`,
        handle: { sessionRef: 'thread-native' },
      })
    ).aggregate;
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'succeed',
        runId: run.runId,
        expectedRevision: run.revision,
        commandId: `succeed:${run.runId}`,
        eventId: `event:succeed:${run.runId}`,
        result: {
          schemaVersion: 1,
          contract: run.birth.resultContract,
          resultId: codingResult.resultId,
          payload: { codingResult },
          artifacts: [
            { ref: `patch:${patch.hash}`, hash: patch.hash, mediaType: 'text/x-diff' },
            {
              ref: `trajectory:${trajectory.hash}`,
              hash: trajectory.hash,
              mediaType: 'application/x-ndjson',
            },
          ],
          evidence: [{ ref: 'test:1', kind: 'observed-test', detail: { passed: true } }],
          proposedEffects: [],
        },
      })
    ).aggregate;
    expect((await finalizeAgentRunSource(pool, run.runId)).ok).toBe(true);
    const denied = await engine.exec({
      rel: 'software-change:main',
      action: 'accept-implementation',
      actor: 'agent',
      principal: 'local-user',
      params: {},
    });
    expect(denied).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    const accepted = await engine.exec({
      rel: 'software-change:main',
      action: 'accept-implementation',
      actor: 'human',
      principal: 'local-user',
      params: {},
    });
    expect(accepted.kind === 'accepted' && accepted.entity.properties.node).toBe('accepted');
    const event = await pool.query<{ detail: { codingDecision?: unknown } }>(
      "SELECT detail FROM events WHERE kind='action-executed' AND action='accept-implementation'",
    );
    expect(event.rows[0]?.detail.codingDecision).toMatchObject({
      merged: false,
      deployed: false,
      activated: false,
    });
  });
});
