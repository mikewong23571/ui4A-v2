import type { AgentResultEnvelope, AgentRunJson } from '@ui4a/engine';
import type { CodingResult } from '@ui4a/shared';

import { storeAgentRunPayload } from '../../../../web/src/db/agent-runs';
import { collectGitWorkspace, parseRepositoryRegistry } from '../../capabilities/coding/workspace';
import type {
  AgentCollectedResult,
  AgentExecutionCompleted,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentRunWorkflowArgs,
  AgentVerificationResult,
} from '../host/contracts';
import { command, currentRun, internalWorkspace, parseCompleted, parseTask } from './adapter-parse';
import { persistedNormalizedEvents, testRunsFromEvents } from './adapter-raw';
import {
  record,
  strings,
  type CodingAgentAdapterDeps,
  type CodingAgentCallbackInput,
} from './adapter-types';

/** Collect Git and test evidence without trusting the Provider's file/test claims. */
export async function collectCodingAgentRunWithDeps(
  input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  },
  deps: CodingAgentAdapterDeps,
): Promise<AgentCollectedResult> {
  const payload = parseTask(input.context);
  const completed = parseCompleted(input.execution.state);
  const registry = parseRepositoryRegistry(deps.repositoryRegistry);
  const workspace = internalWorkspace(
    input.context,
    completed.workspace,
    registry,
    deps.workspaceRoot,
  );
  const collected = await collectGitWorkspace(workspace, payload.codingTask.allowedPaths);
  if (collected.mainCheckoutFingerprint !== workspace.mainCheckoutFingerprint) {
    throw new Error('main checkout changed during coding-agent run');
  }
  const normalized = await persistedNormalizedEvents(deps, input.context.runId);
  const tests = testRunsFromEvents(normalized, completed.claim.tests);
  if (tests.length === 0 || tests.some((test) => !test.passed)) {
    throw new Error('coding-agent result lacks independently observed passing tests');
  }
  const patch = await storeAgentRunPayload(deps.db, collected.patch, 'text/x-diff');
  const trajectory = await storeAgentRunPayload(deps.db, normalized, 'application/x-ndjson');
  const result: CodingResult = {
    schemaVersion: 1,
    resultId: `result:${input.context.runId}`,
    baseRevision: collected.baseRevision,
    headRevision: collected.headRevision,
    patch: { hash: patch.hash, sizeBytes: patch.bytes, mediaType: 'text/x-diff' },
    trajectory: {
      hash: trajectory.hash,
      sizeBytes: trajectory.bytes,
      mediaType: 'application/x-ndjson',
    },
    commits: [],
    changedFiles: collected.changedFiles,
    testRuns: tests,
    summary: completed.claim.summary,
    providerDetail: { provider: 'codex', nativeSessionId: completed.nativeSessionId },
  };
  const candidate: AgentResultEnvelope = {
    schemaVersion: 1,
    contract: input.context.birth.resultContract,
    resultId: result.resultId,
    payload: { codingResult: result as unknown as AgentRunJson },
    artifacts: [
      {
        ref: `agent-run-payload:${patch.hash}`,
        hash: patch.hash,
        mediaType: 'text/x-diff',
        sizeBytes: patch.bytes,
      },
      {
        ref: `agent-run-payload:${trajectory.hash}`,
        hash: trajectory.hash,
        mediaType: 'application/x-ndjson',
        sizeBytes: trajectory.bytes,
      },
    ],
    evidence: [
      {
        ref: `coding-tests:${input.context.runId}`,
        kind: 'coding-tests-observed',
        hash: trajectory.hash,
        detail: {
          passed: true,
          commands: tests.map((test) => ({ command: test.command, exitCode: test.exitCode })),
        },
      },
    ],
    proposedEffects: [],
  };
  return { candidate };
}

function resultPayload(value: AgentRunJson): CodingResult | undefined {
  if (!record(value) || !record(value.codingResult)) return undefined;
  value = value.codingResult as AgentRunJson;
  if (!record(value)) return undefined;
  if (
    value.schemaVersion !== 1 ||
    typeof value.resultId !== 'string' ||
    typeof value.baseRevision !== 'string' ||
    typeof value.headRevision !== 'string' ||
    !record(value.patch) ||
    !record(value.trajectory) ||
    !strings(value.commits) ||
    !strings(value.changedFiles) ||
    !Array.isArray(value.testRuns) ||
    typeof value.summary !== 'string'
  ) {
    return undefined;
  }
  return value as unknown as CodingResult;
}

/** Verify the specialization result contract before the generic Host records success. */
export function verifyCodingAgentRun(input: {
  context: AgentRunWorkflowArgs;
  collected: AgentCollectedResult;
}): AgentVerificationResult {
  const payload = parseTask(input.context);
  const candidate = input.collected.candidate;
  const result = resultPayload(candidate.payload);
  if (
    candidate.contract.ref !== input.context.birth.resultContract.ref ||
    candidate.contract.hash !== input.context.birth.resultContract.hash ||
    result === undefined ||
    candidate.resultId !== result.resultId ||
    result.resultId !== `result:${input.context.runId}` ||
    result.baseRevision !== payload.codingTask.baseRevision
  ) {
    return {
      status: 'failed',
      code: 'coding-result-contract-invalid',
      reason: 'coding-agent result does not match its birth-pinned result contract',
    };
  }
  const patchArtifact = candidate.artifacts.find((artifact) => artifact.hash === result.patch.hash);
  const trajectoryArtifact = candidate.artifacts.find(
    (artifact) => artifact.hash === result.trajectory.hash,
  );
  if (
    !/^sha256:[0-9a-f]{64}$/.test(result.patch.hash) ||
    !/^sha256:[0-9a-f]{64}$/.test(result.trajectory.hash) ||
    patchArtifact?.mediaType !== result.patch.mediaType ||
    patchArtifact.sizeBytes !== result.patch.sizeBytes ||
    trajectoryArtifact?.mediaType !== result.trajectory.mediaType ||
    trajectoryArtifact.sizeBytes !== result.trajectory.sizeBytes
  ) {
    return {
      status: 'failed',
      code: 'coding-result-artifact-invalid',
      reason: 'coding-agent patch or trajectory artifact is not independently persisted',
    };
  }
  if (result.commits.length > 0 || candidate.proposedEffects.length > 0) {
    return {
      status: 'failed',
      code: 'coding-result-effect-invalid',
      reason: 'coding-agent result cannot commit, merge, deploy, or propose implicit effects',
    };
  }
  const outside = result.changedFiles.find(
    (path) =>
      !payload.codingTask.allowedPaths.some(
        (allowed) => path === allowed || path.startsWith(`${allowed}/`),
      ),
  );
  if (outside !== undefined) {
    return {
      status: 'failed',
      code: 'coding-result-path-invalid',
      reason: `changed file ${outside} is outside the task policy`,
    };
  }
  if (
    result.testRuns.length === 0 ||
    result.testRuns.some((test) => !test.passed || test.exitCode)
  ) {
    return {
      status: 'failed',
      code: 'coding-result-tests-invalid',
      reason: 'coding-agent result does not contain independently observed passing tests',
    };
  }
  const evidence = candidate.evidence.find(
    (item) => item.kind === 'coding-tests-observed' && record(item.detail),
  );
  if (
    evidence === undefined ||
    evidence.hash !== result.trajectory.hash ||
    (evidence.detail as Record<string, unknown>).passed !== true
  ) {
    return {
      status: 'failed',
      code: 'coding-result-evidence-invalid',
      reason: 'coding-agent test evidence is missing',
    };
  }
  return { status: 'succeeded', result: candidate };
}

async function defaultCallback(input: CodingAgentCallbackInput): Promise<void> {
  const response = await fetch(`${input.baseUrl}/api/internal/agent-run-callback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ui4a-capability-token': input.token,
    },
    body: JSON.stringify({ runId: input.runId, outcome: input.outcome }),
  });
  if (!response.ok) {
    throw new Error(`agent run callback failed: HTTP ${response.status} ${await response.text()}`);
  }
}

/** Record a native terminal event and invoke the generic source callback idempotently. */
export async function finalizeCodingAgentRunWithDeps(
  input: AgentFinalizeInput,
  deps: CodingAgentAdapterDeps,
): Promise<void> {
  let run = await currentRun(deps.db, input.context);
  if (!['succeeded', 'failed', 'cancelled', 'stale'].includes(run.status)) {
    run = await command(deps, input.context, (current) => {
      const base = {
        runId: input.context.runId,
        expectedRevision: current.revision,
        commandId: input.idempotencyKey,
        eventId: `event:${input.idempotencyKey}`,
      };
      if (input.outcome.status === 'succeeded') {
        return { ...base, kind: 'succeed', result: input.outcome.result };
      }
      if (input.outcome.status === 'cancelled') {
        return { ...base, kind: 'cancel', reason: input.outcome.reason };
      }
      return {
        ...base,
        kind: 'fail',
        code: input.outcome.code,
        reason: input.outcome.reason,
      };
    });
  }
  const callback = deps.callback ?? defaultCallback;
  const baseUrl = deps.callbackBaseUrl ?? process.env.UI4A_PUBLIC_BASE_URL;
  const token = deps.callbackToken ?? process.env.UI4A_CAPABILITY_CALLBACK_TOKEN;
  if (
    deps.callback === undefined &&
    (baseUrl === undefined || token === undefined || token === '')
  ) {
    throw new Error('generic agent callback requires base URL and callback token');
  }
  await callback({
    baseUrl: baseUrl ?? '',
    token: token ?? '',
    runId: run.runId,
    outcome: input.outcome,
  });
}
