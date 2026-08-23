import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

vi.mock('../temporal/capability', () => ({
  dispatchCodingCapability: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `coding-${runId}`,
  })),
  cancelCodingCapability: vi.fn(async () => undefined),
}));

import {
  appendCapabilityRunCommand,
  ensureCapabilityRunTables,
  listCapabilityRuns,
  storeCapabilityPayload,
} from '../db/capability-runs';
import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { enrichEntityWithCapabilityRuns, getCapabilityRunEntity } from './capability-runs';
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
    expect(outcome.kind === 'accepted' && outcome.entity.actions).toEqual([]);
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

  it('denies Agent acceptance and records a human no-merge decision receipt', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'ui4a-decision-repo-'));
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
    const run = (
      await listCapabilityRuns(pool, { principal: 'local-user', policyScope: 'development' })
    )[0]!;
    const patch = await storeCapabilityPayload(pool, 'patch', 'text/x-diff');
    const trajectory = await storeCapabilityPayload(pool, [], 'application/x-ndjson');
    await appendCapabilityRunCommand(pool, {
      kind: 'prepare',
      runId: run.runId,
      expectedRevision: 1,
      commandId: `prepare:${run.runId}`,
      eventId: `prepare-event:${run.runId}`,
    });
    await appendCapabilityRunCommand(pool, {
      kind: 'start',
      runId: run.runId,
      expectedRevision: 2,
      commandId: `start:${run.runId}`,
      eventId: `start-event:${run.runId}`,
      workspace: {
        schemaVersion: 1,
        workspaceId: 'w1',
        repositoryRef: 'repo-fixture',
        baseRevision: base,
        branch: `ui4a/${run.runId}`,
        leaseId: 'l1',
        allowedPaths: ['src'],
        mainCheckoutFingerprint: `sha256:${'3'.repeat(64)}`,
      },
      handle: {
        schemaVersion: 1,
        runId: run.runId,
        profileName: 'default',
        workspaceId: 'w1',
      },
    });
    await appendCapabilityRunCommand(pool, {
      kind: 'succeed',
      runId: run.runId,
      expectedRevision: 3,
      commandId: `succeed:${run.runId}`,
      eventId: `succeed-event:${run.runId}`,
      result: {
        schemaVersion: 1,
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
      },
    });
    await engine.exec({
      rel: 'software-change:main',
      action: 'implementation-succeeded',
      actor: 'agent',
      principal: `system:capability:${run.runId}`,
      params: { runId: run.runId, resultId: `result:${run.runId}` },
    });
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
