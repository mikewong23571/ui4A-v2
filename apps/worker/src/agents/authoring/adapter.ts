import { mkdir, readdir } from 'node:fs/promises';

import type { AgentResultEnvelope, AgentRunJson } from '@ui4a/engine';
import { assertAgentAuthoringResult, type AgentAuthoringResult } from '@ui4a/shared';

import {
  listAgentRunRawReceipts,
  readAgentRunPayload,
  storeAgentRunPayload,
} from '../../../../web/src/db/agent-runs';
import {
  CodexTransportCancelledError,
  executeCodexStructured,
  probeCodexTransport,
  type CodexStructuredDeps,
  type CodexTransportProgress,
} from '../host/codex-transport';
import type {
  AgentCollectedResult,
  AgentExecuteActivityArgs,
  AgentExecutionCompleted,
  AgentExecutionResult,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentRunWorkflowArgs,
  AgentRuntimeExecutionInput,
  AgentRuntimePort,
  AgentVerificationResult,
} from '../host/contracts';
import {
  executeAgentRuntimeStep,
  type AgentActivityControls,
  type AgentRuntimeStepPorts,
} from '../host/runtime';
import { inspectAuthoredAgentDefinition } from './validate';
import {
  appendRaw,
  command,
  currentRun,
  parseAuthoringProviderClaim,
  parseCompleted,
  parsePrepared,
  parseTask,
  profileFor,
  rawStats,
  safeRuntimeDirectory,
} from './adapter-parse';
import { AGENT_AUTHORING_OUTPUT_SCHEMA } from './adapter-schema';
import {
  asJson,
  record,
  type AgentAuthoringAdapterDeps,
  type AgentAuthoringCallbackInput,
} from './adapter-types';

export { parseAgentAuthoringProfiles, parseAuthoringProviderClaim } from './adapter-parse';
export { AGENT_AUTHORING_OUTPUT_SCHEMA } from './adapter-schema';
export type {
  AgentAuthoringAdapterDeps,
  AgentAuthoringCallbackInput,
  AgentAuthoringProfile,
} from './adapter-types';

export async function prepareAgentAuthoringRunWithDeps(
  context: AgentRunWorkflowArgs,
  deps: AgentAuthoringAdapterDeps,
): Promise<AgentPreparedResult> {
  parseTask(context);
  profileFor(context, deps.profiles);
  const probe = await (deps.probe ?? probeCodexTransport)();
  if (!probe.available) throw new Error(probe.reason ?? 'Agent authoring Provider unavailable');
  let run = await currentRun(deps.db, context);
  if (run.status === 'queued') {
    run = await command(deps, context, (current) => ({
      kind: 'prepare',
      runId: context.runId,
      expectedRevision: current.revision,
      commandId: `prepare:${context.runId}`,
      eventId: `event:prepare:${context.runId}`,
    }));
  }
  if (run.status !== 'preparing' && run.status !== 'running') {
    throw new Error(`Agent authoring cannot prepare from ${run.status}`);
  }
  const workingDirectory = safeRuntimeDirectory(deps.runtimeRoot, context.runId);
  await mkdir(workingDirectory, { recursive: true, mode: 0o700 });
  if ((await readdir(workingDirectory)).length > 0) {
    throw new Error('Agent authoring structured-only runtime directory is not empty');
  }
  return { state: asJson({ kind: 'agent-definition-authoring-prepared', workingDirectory }) };
}

async function executeRuntime(
  input: AgentRuntimeExecutionInput,
  deps: AgentAuthoringAdapterDeps,
): Promise<AgentExecutionResult> {
  const payload = parseTask(input.context);
  const profile = profileFor(input.context, deps.profiles);
  const prepared = parsePrepared(input.prepared.state);
  let ordinal = (await rawStats(deps, input.context.runId)).maxOrdinal;
  let sessionRef = (await currentRun(deps.db, input.context)).handle?.sessionRef;
  try {
    const output = await (deps.execute ?? executeCodexStructured)(
      {
        runId: input.context.runId,
        compiledHash: payload.compiledPrompt.compiledHash,
        messages: payload.compiledPrompt.messages.map(({ role, content }) => ({ role, content })),
        outputSchema: AGENT_AUTHORING_OUTPUT_SCHEMA,
        workingDirectory: prepared.workingDirectory,
        sandboxMode: 'read-only',
        profile: {
          providerId: profile.providerId,
          envAllowlist: profile.envAllowlist,
          networkPolicy: profile.networkPolicy,
          maxTurns: profile.maxTurns,
          model: profile.model,
          ...(profile.endpoint === undefined ? {} : { endpoint: profile.endpoint }),
          apiKeyEnv: profile.apiKeyEnv,
        },
        ...(sessionRef === undefined ? {} : { nativeSessionId: sessionRef }),
        signal: input.signal,
      },
      {
        onPromptDispatched: async (receipt) => {
          ordinal += 1;
          await appendRaw(deps, input.context, payload.authoringBrief, ordinal, `${ordinal}`, {
            kind: 'prompt-dispatched',
            ...receipt,
          });
        },
        onRaw: async (event, cursor) => {
          ordinal += 1;
          await appendRaw(deps, input.context, payload.authoringBrief, ordinal, cursor, {
            kind: 'provider-raw',
            payload: event,
          });
        },
        onProgress: async (progress: CodexTransportProgress) => {
          if (progress.kind === 'run-started') {
            sessionRef = progress.nativeSessionId;
            if ((await currentRun(deps.db, input.context)).status === 'preparing') {
              await command(deps, input.context, (current) => ({
                kind: 'start',
                runId: input.context.runId,
                expectedRevision: current.revision,
                commandId: `start:${input.context.runId}`,
                eventId: `event:start:${input.context.runId}`,
                handle: { sessionRef },
              }));
            }
          }
          ordinal += 1;
          await appendRaw(deps, input.context, payload.authoringBrief, ordinal, `${ordinal}`, {
            kind: 'authoring-progress',
            event: progress,
          });
          const run = await currentRun(deps.db, input.context);
          if (run.status === 'running') {
            const observedSequence = run.observedSequence + 1;
            await command(deps, input.context, (current) => ({
              kind: 'advance-cursor',
              runId: input.context.runId,
              expectedRevision: current.revision,
              expectedCursor: current.cursor,
              cursor: `${ordinal}`,
              observedSequence,
              commandId: `cursor:${input.context.runId}:${observedSequence}`,
              eventId: `event:cursor:${input.context.runId}:${observedSequence}`,
            }));
          }
          input.reportProgress({
            cursor: `${ordinal}`,
            state: asJson({ kind: 'authoring-running', sessionRef: sessionRef ?? null }),
          });
        },
      } satisfies CodexStructuredDeps,
    );
    const result = parseAuthoringProviderClaim(
      payload.authoringBrief,
      output.result,
      input.context.runId,
    );
    if (result.status !== 'completed') throw new Error(`Authoring Agent failed: ${result.summary}`);
    return {
      status: 'completed',
      state: asJson({
        kind: 'agent-definition-authoring-completed',
        workingDirectory: prepared.workingDirectory,
        nativeSessionId: output.nativeSessionId,
        result,
      }),
      handle: { sessionRef: output.nativeSessionId },
    };
  } catch (error) {
    if (error instanceof CodexTransportCancelledError || input.signal.aborted) {
      return { status: 'cancelled', reason: 'Agent authoring cancelled' };
    }
    return {
      status: 'failed',
      code: 'agent-authoring-executor-failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function recordRestart(
  deps: AgentAuthoringAdapterDeps,
  args: Parameters<AgentRuntimeStepPorts['recordRestart']>[0],
): Promise<void> {
  const run = await currentRun(deps.db, args.context);
  await command(deps, args.context, (current) => ({
    kind: 'restart',
    runId: args.context.runId,
    expectedRevision: current.revision,
    expectedCursor: current.cursor,
    reason: `${args.reason}:attempt-${args.attempt}`,
    ...(run.handle === undefined ? {} : { handle: run.handle }),
    commandId: `restart:${args.context.runId}:${args.attempt}`,
    eventId: `event:restart:${args.context.runId}:${args.attempt}`,
  }));
}

export async function executeAgentAuthoringRunWithDeps(
  args: AgentExecuteActivityArgs,
  deps: AgentAuthoringAdapterDeps,
  controls?: AgentActivityControls,
): Promise<AgentExecutionResult> {
  const runtime: AgentRuntimePort = {
    execute: (input) => executeRuntime(input, deps),
    resume: (input) => executeRuntime(input, deps),
  };
  return executeAgentRuntimeStep(
    args,
    { runtime, recordRestart: (value) => recordRestart(deps, value) },
    controls,
  );
}

async function progressEvents(deps: AgentAuthoringAdapterDeps, runId: string) {
  const values: AgentRunJson[] = [];
  for (const receipt of await listAgentRunRawReceipts(deps.db, runId)) {
    const value = await readAgentRunPayload(deps.db, String(receipt.payloadRef));
    if (record(value) && value.kind === 'authoring-progress') values.push(asJson(value));
  }
  return values;
}

export async function collectAgentAuthoringRunWithDeps(
  input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  },
  deps: AgentAuthoringAdapterDeps,
): Promise<AgentCollectedResult> {
  const payload = parseTask(input.context);
  const completed = parseCompleted(input.execution.state);
  const inspection = inspectAuthoredAgentDefinition({
    brief: payload.authoringBrief,
    candidate: completed.result.candidate,
    evalCorpus: completed.result.evalCorpus,
  });
  if ((await readdir(completed.workingDirectory)).length > 0) {
    throw new Error('Agent authoring read-only runtime produced filesystem effects');
  }
  const definitionPayload = await storeAgentRunPayload(
    deps.db,
    completed.result.candidate,
    'application/vnd.ui4a.agent-definition+json',
  );
  const evalPayload = await storeAgentRunPayload(
    deps.db,
    completed.result.evalCorpus,
    'application/vnd.ui4a.agent-eval-corpus+json',
  );
  const trajectory = await storeAgentRunPayload(
    deps.db,
    await progressEvents(deps, input.context.runId),
    'application/x-ndjson',
  );
  const candidate: AgentResultEnvelope = {
    schemaVersion: 1,
    contract: input.context.birth.resultContract,
    resultId: completed.result.resultId,
    payload: asJson({ authoringResult: completed.result }),
    artifacts: [
      {
        ref: `agent-run-payload:${definitionPayload.hash}`,
        hash: inspection.artifact?.flattenedHash ?? definitionPayload.hash,
        mediaType: 'application/vnd.ui4a.agent-definition+json',
        sizeBytes: definitionPayload.bytes,
      },
      {
        ref: `agent-run-payload:${evalPayload.hash}`,
        hash: evalPayload.hash,
        mediaType: 'application/vnd.ui4a.agent-eval-corpus+json',
        sizeBytes: evalPayload.bytes,
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
        ref: `authoring-parse:${input.context.runId}`,
        kind: 'agent-definition-source-parse',
        hash: inspection.artifact?.flattenedHash ?? definitionPayload.hash,
        detail: asJson({ passed: inspection.valid, issues: inspection.issues }),
      },
      {
        ref: `authoring-invariants:${input.context.runId}`,
        kind: 'agent-definition-non-eval-invariants',
        detail: asJson({ passed: inspection.valid, checks: inspection.checks }),
      },
      {
        ref: `authoring-eval-proposal:${input.context.runId}`,
        kind: 'agent-definition-eval-corpus-proposed',
        hash: evalPayload.hash,
        detail: { passed: true, executed: false },
      },
      {
        ref: `authoring-governance:${input.context.runId}`,
        kind: 'agent-definition-draft-only',
        detail: { passed: true, approval: false, activation: false },
      },
    ],
    proposedEffects: [],
  };
  return { candidate };
}

export function verifyAgentAuthoringRun(input: {
  context: AgentRunWorkflowArgs;
  collected: AgentCollectedResult;
}): AgentVerificationResult {
  const candidate = input.collected.candidate;
  const payload = candidate.payload;
  let result: AgentAuthoringResult;
  try {
    result = assertAgentAuthoringResult(record(payload) ? payload.authoringResult : undefined);
    const inspection = inspectAuthoredAgentDefinition({
      brief: parseTask(input.context).authoringBrief,
      candidate: result.candidate,
      evalCorpus: result.evalCorpus,
    });
    if (
      inspection.valid !== result.validation.valid ||
      JSON.stringify(inspection.issues) !== JSON.stringify(result.validation.issues)
    ) {
      throw new Error('Agent authoring validation projection drifted');
    }
  } catch (error) {
    return {
      status: 'failed',
      code: 'agent-authoring-result-invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const kinds = new Set(candidate.evidence.map((evidence) => evidence.kind));
  if (
    candidate.contract.ref !== input.context.birth.resultContract.ref ||
    candidate.contract.hash !== input.context.birth.resultContract.hash ||
    candidate.resultId !== result.resultId ||
    candidate.proposedEffects.length > 0 ||
    !kinds.has('agent-definition-source-parse') ||
    !kinds.has('agent-definition-non-eval-invariants') ||
    !kinds.has('agent-definition-eval-corpus-proposed') ||
    !kinds.has('agent-definition-draft-only')
  ) {
    return {
      status: 'failed',
      code: 'agent-authoring-governance-invalid',
      reason: 'Agent-authored result lacks mechanical Draft-only evidence',
    };
  }
  return { status: 'succeeded', result: candidate };
}

async function defaultCallback(input: AgentAuthoringCallbackInput): Promise<void> {
  const response = await fetch(`${input.baseUrl}/api/internal/agent-run-callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ui4a-capability-token': input.token },
    body: JSON.stringify({ runId: input.runId, outcome: input.outcome }),
  });
  if (!response.ok) throw new Error(`Agent authoring callback failed: HTTP ${response.status}`);
}

export async function finalizeAgentAuthoringRunWithDeps(
  input: AgentFinalizeInput,
  deps: AgentAuthoringAdapterDeps,
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
      return { ...base, kind: 'fail', code: input.outcome.code, reason: input.outcome.reason };
    });
  }
  const callback = deps.callback ?? defaultCallback;
  const baseUrl = deps.callbackBaseUrl ?? process.env.UI4A_PUBLIC_BASE_URL;
  const token = deps.callbackToken ?? process.env.UI4A_CAPABILITY_CALLBACK_TOKEN;
  if (
    deps.callback === undefined &&
    (baseUrl === undefined || token === undefined || token === '')
  ) {
    throw new Error('Agent authoring callback configuration is missing');
  }
  await callback({
    baseUrl: baseUrl ?? '',
    token: token ?? '',
    runId: run.runId,
    outcome: input.outcome,
  });
}
