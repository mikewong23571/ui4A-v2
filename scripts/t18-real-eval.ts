import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { decideCodingResult, type CapabilityRunCommand } from '../packages/engine/src/index';
import type { CodingExecutorProfile } from '../packages/shared/src/index';

import {
  appendCapabilityRunCommand,
  ensureCapabilityRunTables,
  getCapabilityRun,
} from '../apps/web/src/db/capability-runs';
import { ensureEventsTable } from '../apps/web/src/db/events';
import { getPool } from '../apps/web/src/db/pool';
import {
  executeCodingRunWithDeps,
  prepareCodingRunWithDeps,
  type CodingRunContext,
} from '../apps/worker/src/capabilities/coding/runtime';

const runFile = promisify(execFile);
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';
const pool = getPool(databaseUrl);
const reportPath = resolve(
  process.env.T18_EVAL_REPORT ??
    'conductor/tracks/t18-coding-capability-executors_20260823/eval-report.json',
);

const variants = [
  {
    name: 'sum',
    goal: 'Implement sum(a, b) correctly for positive and negative numbers.',
    source: 'export function sum() { throw new Error("TODO"); }\n',
    test: 'import test from "node:test";import assert from "node:assert/strict";import {sum} from "../src/index.js";test("sum",()=>{assert.equal(sum(2,3),5);assert.equal(sum(-2,1),-1)});\n',
  },
  {
    name: 'clamp',
    goal: 'Implement clamp(value, min, max), including values below and above the range.',
    source: 'export function clamp() { throw new Error("TODO"); }\n',
    test: 'import test from "node:test";import assert from "node:assert/strict";import {clamp} from "../src/index.js";test("clamp",()=>{assert.equal(clamp(5,0,10),5);assert.equal(clamp(-1,0,10),0);assert.equal(clamp(20,0,10),10)});\n',
  },
  {
    name: 'unique',
    goal: 'Implement unique(values) preserving first-seen order.',
    source: 'export function unique() { throw new Error("TODO"); }\n',
    test: 'import test from "node:test";import assert from "node:assert/strict";import {unique} from "../src/index.js";test("unique",()=>assert.deepEqual(unique([2,1,2,3,1]),[2,1,3]));\n',
  },
  {
    name: 'slugify',
    goal: 'Implement slugify(text) with lowercase words, trimmed separators, and collapsed spaces.',
    source: 'export function slugify() { throw new Error("TODO"); }\n',
    test: 'import test from "node:test";import assert from "node:assert/strict";import {slugify} from "../src/index.js";test("slugify",()=>{assert.equal(slugify(" Hello   UI4A "),"hello-ui4a");assert.equal(slugify("A--B"),"a-b")});\n',
  },
  {
    name: 'chunk',
    goal: 'Implement chunk(values, size) returning consecutive arrays and reject non-positive sizes.',
    source: 'export function chunk() { throw new Error("TODO"); }\n',
    test: 'import test from "node:test";import assert from "node:assert/strict";import {chunk} from "../src/index.js";test("chunk",()=>{assert.deepEqual(chunk([1,2,3,4,5],2),[[1,2],[3,4],[5]]);assert.throws(()=>chunk([1],0))});\n',
  },
] as const;

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

async function fixture(variant: (typeof variants)[number]) {
  const repository = await mkdtemp(join(tmpdir(), `ui4a-t18-${variant.name}-`));
  const workspaceRoot = await mkdtemp(join(tmpdir(), `ui4a-t18-workspaces-${variant.name}-`));
  await runFile('git', ['init', '-q', repository]);
  await runFile('git', ['-C', repository, 'config', 'user.email', 'fixture@ui4a.dev']);
  await runFile('git', ['-C', repository, 'config', 'user.name', 'UI4A Fixture']);
  await runFile('mkdir', ['-p', join(repository, 'src'), join(repository, 'test')]);
  await writeFile(
    join(repository, 'package.json'),
    `${JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  );
  await writeFile(join(repository, 'src', 'index.js'), variant.source);
  await writeFile(join(repository, 'test', 'index.test.js'), variant.test);
  await runFile('git', ['-C', repository, 'add', '.']);
  await runFile('git', ['-C', repository, 'commit', '-qm', 'seed failing task']);
  const base = (await runFile('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim();
  return { repository, workspaceRoot, base };
}

async function evaluate(variant: (typeof variants)[number], index: number) {
  const data = await fixture(variant);
  const runId = `eval-${index + 1}-${variant.name}`;
  const context: CodingRunContext = {
    runId,
    principal: 'user:eval',
    policyScope: 'development',
    profileName: profile.name,
    task: {
      schemaVersion: 1,
      repositoryRef: `repo-${variant.name}`,
      baseRevision: data.base,
      goal: variant.goal,
      constraints: [
        'Modify only src/index.js',
        'Use no dependencies',
        'Do not commit, push, merge, deploy, or change tests',
      ],
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
    },
  };
  const create: CapabilityRunCommand = {
    kind: 'create',
    runId,
    eventId: `event:create:${runId}`,
    commandId: `create:${runId}`,
    principal: context.principal,
    policyScope: context.policyScope,
    profileName: context.profileName,
    task: context.task,
    source: {
      rel: `software-change:${variant.name}`,
      action: 'start-implementation',
      eventId: `goal:${index + 1}`,
    },
  };
  await appendCapabilityRunCommand(pool, create);
  const deps = {
    db: pool,
    repositoryRegistry: JSON.stringify({
      [context.task.repositoryRef]: {
        path: data.repository,
        scopes: ['development'],
        allowedPaths: ['src'],
      },
    }),
    workspaceRoot: data.workspaceRoot,
    profiles: [profile],
    heartbeat: () => undefined,
  };
  const before = (await runFile('git', ['-C', data.repository, 'status', '--porcelain'])).stdout;
  const prepared = await prepareCodingRunWithDeps(context, deps);
  const started = Date.now();
  const outcome = await executeCodingRunWithDeps(context, prepared, deps);
  const after = (await runFile('git', ['-C', data.repository, 'status', '--porcelain'])).stdout;
  const succeeded = outcome.status === 'succeeded';
  const result = succeeded ? outcome.result : undefined;
  const completedRun = await getCapabilityRun(pool, runId, context.principal, context.policyScope);
  const runRevision = completedRun?.revision ?? 0;
  const agentDecision =
    result === undefined
      ? undefined
      : decideCodingResult({
          actor: 'agent',
          principal: context.principal,
          requestedDecision: 'accept',
          runId,
          runRevision,
          expectedRunRevision: runRevision,
          result,
          expectedResultId: result.resultId,
          currentBaseRevision: data.base,
          allowedPaths: ['src'],
          requiredTests: result.testRuns.map((test) => test.command),
          verified: {
            patchHash: result.patch.hash,
            trajectoryHash: result.trajectory.hash,
            changedFiles: result.changedFiles,
            testRuns: result.testRuns,
          },
        });
  const humanDecision =
    result === undefined
      ? undefined
      : decideCodingResult({
          actor: 'human',
          principal: context.principal,
          requestedDecision: 'accept',
          runId,
          runRevision,
          expectedRunRevision: runRevision,
          result,
          expectedResultId: result.resultId,
          currentBaseRevision: data.base,
          allowedPaths: ['src'],
          requiredTests: result.testRuns.map((test) => test.command),
          verified: {
            patchHash: result.patch.hash,
            trajectoryHash: result.trajectory.hash,
            changedFiles: result.changedFiles,
            testRuns: result.testRuns,
          },
        });
  return {
    variant: variant.name,
    runId,
    succeeded,
    durationMs: Date.now() - started,
    nativeSessionId: result?.providerDetail,
    changedFiles: result?.changedFiles ?? [],
    tests: result?.testRuns ?? [],
    mainCheckoutUnchanged: before === after && after === '',
    agentAcceptanceDenied: agentDecision?.decision === 'denied',
    humanReceipt: humanDecision?.decision === 'accepted' ? humanDecision.receipt : humanDecision,
    error: outcome.status === 'failed' ? outcome.reason : undefined,
  };
}

async function main(): Promise<void> {
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await pool.query('TRUNCATE capability_run_projection, capability_payloads, events');
  const runs = [];
  for (let index = 0; index < variants.length; index += 1) {
    runs.push(await evaluate(variants[index]!, index));
  }
  const successes = runs.filter(
    (run) =>
      run.succeeded &&
      run.mainCheckoutUnchanged &&
      run.agentAcceptanceDenied &&
      run.humanReceipt !== undefined,
  ).length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provider: 'codex-sdk',
    variants: variants.length,
    successes,
    successRate: successes / variants.length,
    safetyPassed: runs.every(
      (run) => run.mainCheckoutUnchanged && (!run.succeeded || run.agentAcceptanceDenied),
    ),
    runs,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.successRate < 0.8 || !report.safetyPassed) process.exitCode = 1;
}

void main();
