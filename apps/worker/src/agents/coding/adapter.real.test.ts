import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { hashCanonicalAgentJson, type AgentRunCommand, type AgentRunJson } from '@ui4a/engine';
import type { CodingExecutorProfile, CodingTask } from '@ui4a/shared';

import {
  appendAgentRunCommand,
  ensureAgentRunTables,
  getAgentRun,
} from '../../../../web/src/db/agent-runs';
import { ensureEventsTable } from '../../../../web/src/db/events';
import { getPool } from '../../../../web/src/db/pool';
import type { AgentRunWorkflowArgs } from '../host/contracts';
import {
  collectCodingAgentRunWithDeps,
  executeCodingAgentRunWithDeps,
  finalizeCodingAgentRunWithDeps,
  prepareCodingAgentRunWithDeps,
  verifyCodingAgentRun,
} from './adapter';

const enabled = process.env.RUN_T19_CODEX === '1';
const runFile = promisify(execFile);
const pool = getPool(process.env.DATABASE_URL!);

describe.skipIf(!enabled)('real coding-agent@1 through generic Agent Host', () => {
  it('edits and tests only a disposable native Agent Run worktree', async () => {
    await ensureEventsTable(pool);
    await ensureAgentRunTables(pool);
    await pool.query(
      'TRUNCATE agent_run_projection, agent_run_projection_state, agent_run_payloads, events',
    );
    const repository = await mkdtemp(join(tmpdir(), 'ui4a-t19-real-coding-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ui4a-t19-real-workspaces-'));
    await runFile('git', ['init', '-q', repository]);
    await runFile('git', ['-C', repository, 'config', 'user.email', 'fixture@ui4a.dev']);
    await runFile('git', ['-C', repository, 'config', 'user.name', 'UI4A Fixture']);
    await mkdir(join(repository, 'src'), { recursive: true });
    await mkdir(join(repository, 'test'), { recursive: true });
    await writeFile(
      join(repository, 'package.json'),
      `${JSON.stringify({ type: 'module', scripts: { test: 'node --test' } })}\n`,
    );
    await writeFile(
      join(repository, 'src', 'index.js'),
      'export function sum(){throw new Error("TODO")}\n',
    );
    await writeFile(
      join(repository, 'test', 'sum.test.js'),
      'import test from "node:test";import assert from "node:assert/strict";import {sum} from "../src/index.js";test("sum",()=>{assert.equal(sum(2,3),5);assert.equal(sum(-2,1),-1)});\n',
    );
    await runFile('git', ['-C', repository, 'add', '.']);
    await runFile('git', ['-C', repository, 'commit', '-qm', 'seed']);
    const baseRevision = (
      await runFile('git', ['-C', repository, 'rev-parse', 'HEAD'])
    ).stdout.trim();
    const codingTask: CodingTask = {
      schemaVersion: 1,
      repositoryRef: 'fixture',
      baseRevision,
      goal: 'Implement sum(a, b) for positive and negative numbers.',
      constraints: ['Modify only src/index.js', 'Do not commit, push, merge, or change tests'],
      acceptanceCriteria: ['npm test passes'],
      allowedPaths: ['src'],
      budget: {
        timeoutSeconds: 120,
        maxTurns: 20,
        maxRawEvents: 2_000,
        maxRawBytes: 4 * 1024 * 1024,
        maxRawChunkBytes: 64 * 1024,
      },
      redaction: { secretNames: [], redactHostPaths: true },
    };
    const messages = [
      {
        blockId: 'authority',
        role: 'system' as const,
        purpose: 'authority',
        content:
          'Operate only in the supplied worktree. Never commit, push, merge, deploy, or approve.',
        sealed: true,
      },
      {
        blockId: 'task',
        role: 'user' as const,
        purpose: 'task-data',
        content: `Implement the authorized task and run npm test. Task: ${JSON.stringify(codingTask)}`,
        sealed: false,
      },
    ];
    const compiledHash = hashCanonicalAgentJson(messages as unknown as AgentRunJson);
    const args: AgentRunWorkflowArgs = {
      runId: 't19-real-coding',
      principal: 'user:real-eval',
      policyScope: 'development',
      source: {
        rel: 'software-change:real-eval',
        action: 'start-implementation',
        eventId: 'core:t19-real-eval',
      },
      birth: {
        schemaVersion: 1,
        kind: 'event-native',
        definition: {
          ref: 'coding-agent',
          version: 1,
          sourceHash: `sha256:${'1'.repeat(64)}`,
          parentHashes: [],
          flattenedHash: `sha256:${'2'.repeat(64)}`,
        },
        prompt: { templateHash: `sha256:${'3'.repeat(64)}`, compiledHash },
        runtime: {
          profileName: 'real-codex',
          profileVersion: '1',
          adapterVersion: 'codex-sdk@0.149.0',
        },
        taskContract: { ref: 'coding-agent@1:input', hash: `sha256:${'4'.repeat(64)}` },
        resultContract: { ref: 'coding-agent@1:output', hash: `sha256:${'5'.repeat(64)}` },
      },
      task: {
        schemaVersion: 1,
        contract: { ref: 'coding-agent@1:input', hash: `sha256:${'4'.repeat(64)}` },
        payload: {
          kind: 'coding-task',
          codingTask: codingTask as unknown as AgentRunJson,
          compiledPrompt: { compiledHash, messages },
        },
      },
      limits: { maxSuspensions: 0 },
    };
    const create: AgentRunCommand = {
      kind: 'create',
      runId: args.runId,
      eventId: `event:create:${args.runId}`,
      commandId: `create:${args.runId}`,
      principal: args.principal,
      policyScope: args.policyScope,
      source: args.source,
      birth: args.birth,
      task: args.task,
    };
    await appendAgentRunCommand(pool, create);
    const profile: CodingExecutorProfile = {
      name: 'real-codex',
      executorClass: 'coding-agent',
      providerId: 'codex',
      transport: 'sdk',
      workspaceBackend: 'isolated-worktree',
      sandbox: 'workspace-write',
      timeoutSeconds: 120,
      maxTurns: 20,
      envAllowlist: ['PATH', 'HOME', 'CODEX_HOME'],
      networkPolicy: 'none',
    };
    let callbackCount = 0;
    const deps = {
      db: pool,
      repositoryRegistry: JSON.stringify({
        fixture: { path: repository, scopes: ['development'], allowedPaths: ['src'] },
      }),
      workspaceRoot,
      profiles: [profile],
      callback: async () => {
        callbackCount += 1;
      },
    };
    const prepared = await prepareCodingAgentRunWithDeps(args, deps);
    const execution = await executeCodingAgentRunWithDeps({ context: args, prepared }, deps, {
      attempt: 1,
      signal: new AbortController().signal,
      heartbeat: () => undefined,
    });
    if (execution.status !== 'completed') {
      throw new Error('reason' in execution ? execution.reason : execution.status);
    }
    const collected = await collectCodingAgentRunWithDeps(
      { context: args, prepared, execution },
      deps,
    );
    const verified = verifyCodingAgentRun({ context: args, collected });
    if (verified.status !== 'succeeded') throw new Error(verified.reason);
    await finalizeCodingAgentRunWithDeps(
      { context: args, outcome: verified, idempotencyKey: `finalize:${args.runId}` },
      deps,
    );
    expect((await getAgentRun(pool, args.runId, args.principal, args.policyScope))?.status).toBe(
      'succeeded',
    );
    expect((await runFile('git', ['-C', repository, 'status', '--porcelain'])).stdout).toBe('');
    expect(callbackCount).toBe(1);
  }, 180_000);
});
