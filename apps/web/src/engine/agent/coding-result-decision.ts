import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { canonicalJson, decideCodingResult, type ExecRequest } from '@ui4a/engine';
import type { ActionDefinition, CodingResult, CodingTask, EngineSnapshot } from '@ui4a/shared';

import { getAgentRunInternal, readAgentRunPayload } from '../db/agent-runs';
import type { DbExecutor } from '../db/events';

const runFile = promisify(execFile);

function payloadHash(payload: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

function repositoryPath(repositoryRef: string, policyScope: string): string {
  const raw = process.env.UI4A_CODING_REPOSITORIES;
  if (raw === undefined) throw new Error('UI4A_CODING_REPOSITORIES is not configured');
  const registry = JSON.parse(raw) as Record<string, { path?: unknown; scopes?: unknown }>;
  const entry = registry[repositoryRef];
  if (
    entry === undefined ||
    typeof entry.path !== 'string' ||
    !Array.isArray(entry.scopes) ||
    !entry.scopes.includes(policyScope)
  ) {
    throw new Error('repositoryRef is not authorized for result decision');
  }
  return entry.path;
}

function codingTaskFromPayload(payload: unknown): CodingTask | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const candidate = payload as { kind?: unknown; codingTask?: unknown };
  if (candidate.kind !== 'coding-task') return undefined;
  const task = candidate.codingTask;
  if (typeof task !== 'object' || task === null || Array.isArray(task)) return undefined;
  return task as CodingTask;
}

function codingResultFromPayload(payload: unknown): CodingResult | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const result = (payload as { codingResult?: unknown }).codingResult;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined;
  return result as CodingResult;
}

/** Revalidate an Application result decision against the native Agent Run before its transition event is appended. */
export async function preflightCodingResultDecision(
  db: DbExecutor,
  snapshot: EngineSnapshot,
  request: ExecRequest,
  action: ActionDefinition,
) {
  if (action.decision === undefined) return undefined;
  const instance = snapshot.instances[request.rel];
  const runId = instance?.fields.runId?.value;
  const resultId = instance?.fields.resultId?.value;
  if (typeof runId !== 'string' || typeof resultId !== 'string') {
    return {
      decision: 'denied' as const,
      code: 'result-stale',
      reason: 'source entity has no linked coding result',
    };
  }
  const run = await getAgentRunInternal(db, runId);
  const task = codingTaskFromPayload(run?.task.payload);
  const result = codingResultFromPayload(run?.result?.payload);
  if (run?.status !== 'succeeded' || result === undefined || task === undefined) {
    return {
      decision: 'denied' as const,
      code: 'result-stale',
      reason: 'coding result is not available',
    };
  }
  if (request.principal === undefined || request.principal !== run.principal) {
    return {
      decision: 'denied' as const,
      code: 'human-required',
      reason: 'decision principal does not own the run',
    };
  }
  const [patch, trajectory] = await Promise.all([
    readAgentRunPayload(db, result.patch.hash),
    readAgentRunPayload(db, result.trajectory.hash),
  ]);
  if (patch === undefined || trajectory === undefined) {
    return {
      decision: 'denied' as const,
      code: 'artifact-integrity-failed',
      reason: 'coding result payload is missing',
    };
  }
  const path = repositoryPath(task.repositoryRef, run.policyScope);
  const currentBaseRevision = (
    await runFile('git', ['-C', path, 'rev-parse', 'HEAD'], {
      timeout: 5_000,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        NODE_ENV: process.env.NODE_ENV ?? 'production',
      },
    })
  ).stdout.trim();
  return decideCodingResult({
    actor: request.actor ?? 'human',
    principal: request.principal,
    requestedDecision: action.decision === 'accept-capability-result' ? 'accept' : 'reject',
    ...(typeof request.params?.reason === 'string'
      ? { rejectionReason: request.params.reason }
      : {}),
    runId,
    runRevision: run.revision,
    expectedRunRevision: run.revision,
    result,
    expectedResultId: resultId,
    currentBaseRevision,
    allowedPaths: task.allowedPaths,
    requiredTests: result.testRuns.map((test) => test.command),
    verified: {
      patchHash: payloadHash(patch),
      trajectoryHash: payloadHash(trajectory),
      changedFiles: result.changedFiles,
      testRuns: result.testRuns,
    },
  });
}
