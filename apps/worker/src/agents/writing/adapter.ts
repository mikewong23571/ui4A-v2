import type { AgentResultEnvelope } from '@ui4a/engine';
import { assertWritingResult, type WritingResult } from '@ui4a/shared';

import { storeAgentRunPayload } from '../../../../web/src/db/agent-runs';
import {
  CodexTransportCancelledError,
  executeCodexStructured,
  probeCodexTransport,
  type CodexStructuredDeps,
  type CodexStructuredOutput,
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
import {
  collectDocumentWorkspace,
  prepareDocumentWorkspace,
  verifyWritingOutput,
} from './workspace';
import {
  command,
  currentRun,
  parseCompleted,
  parsePrepared,
  parseTask,
  profileFor,
} from './adapter-parse';
import { appendRaw, persistedProgress, rawStats } from './adapter-raw';
import { WRITING_RESULT_SCHEMA } from './adapter-schema';
import {
  asJson,
  record,
  type WritingAgentAdapterDeps,
  type WritingAgentCallbackInput,
} from './adapter-types';

export { parseDocumentAgentProfiles, writingPreparedWorkspaceRoot } from './adapter-parse';
export { WRITING_RESULT_SCHEMA } from './adapter-schema';
export type {
  DocumentAgentProfile,
  WritingAgentAdapterDeps,
  WritingAgentCallbackInput,
} from './adapter-types';

/** Prepare a Writing specialization without staging source bytes in its writable root. */
export async function prepareWritingAgentRunWithDeps(
  context: AgentRunWorkflowArgs,
  deps: WritingAgentAdapterDeps,
): Promise<AgentPreparedResult> {
  const payload = parseTask(context);
  profileFor(context, deps.profiles);
  const probe = await (deps.probe ?? probeCodexTransport)();
  if (!probe.available) throw new Error(probe.reason ?? 'document-agent Provider unavailable');
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
  if (run.status !== 'preparing' && run.status !== 'running')
    throw new Error(`writing-agent cannot prepare from ${run.status}`);
  const workspace = await prepareDocumentWorkspace(
    { runId: context.runId, brief: payload.writingBrief },
    { workspaceRoot: deps.workspaceRoot },
  );
  return { state: asJson({ kind: 'writing-agent-prepared', workspace }) };
}

async function executeRuntime(
  input: AgentRuntimeExecutionInput,
  deps: WritingAgentAdapterDeps,
): Promise<AgentExecutionResult> {
  const payload = parseTask(input.context);
  const profile = profileFor(input.context, deps.profiles);
  const prepared = parsePrepared(input.prepared.state);
  const before = await rawStats(deps, input.context.runId);
  let rawOrdinal = before.maxOrdinal;
  let nativeSessionId = (await currentRun(deps.db, input.context)).handle?.sessionRef;
  let promptDispatched = false;
  const execute = deps.execute ?? executeCodexStructured;
  try {
    const output: CodexStructuredOutput = await execute(
      {
        runId: input.context.runId,
        compiledHash: payload.compiledPrompt.compiledHash,
        messages: payload.compiledPrompt.messages.map(({ role, content }) => ({ role, content })),
        outputSchema: WRITING_RESULT_SCHEMA,
        workingDirectory: prepared.workspace.workingDirectory,
        profile: {
          providerId: profile.providerId,
          envAllowlist: profile.envAllowlist,
          networkPolicy: profile.networkPolicy,
          maxTurns: profile.maxTurns,
          model: profile.model,
          ...(profile.endpoint === undefined ? {} : { endpoint: profile.endpoint }),
          apiKeyEnv: profile.apiKeyEnv,
        },
        ...(nativeSessionId === undefined ? {} : { nativeSessionId }),
        signal: input.signal,
      },
      {
        onPromptDispatched: async (receipt) => {
          promptDispatched = true;
          rawOrdinal += 1;
          await appendRaw(
            deps,
            input.context,
            payload.writingBrief,
            prepared.workspace.workingDirectory,
            rawOrdinal,
            `${rawOrdinal}`,
            { kind: 'prompt-dispatched', ...receipt },
          );
        },
        onRaw: async (event, cursor) => {
          rawOrdinal += 1;
          await appendRaw(
            deps,
            input.context,
            payload.writingBrief,
            prepared.workspace.workingDirectory,
            rawOrdinal,
            cursor,
            { kind: 'provider-raw', payload: event },
          );
        },
        onProgress: async (progress: CodexTransportProgress) => {
          if (progress.kind === 'run-started') {
            nativeSessionId = progress.nativeSessionId;
            const run = await currentRun(deps.db, input.context);
            if (run.status === 'preparing') {
              await command(deps, input.context, (current) => ({
                kind: 'start',
                runId: input.context.runId,
                expectedRevision: current.revision,
                commandId: `start:${input.context.runId}`,
                eventId: `event:start:${input.context.runId}`,
                handle: {
                  sessionRef: nativeSessionId,
                  detail: { workspaceId: prepared.workspace.workspaceId },
                },
              }));
            }
          }
          rawOrdinal += 1;
          await appendRaw(
            deps,
            input.context,
            payload.writingBrief,
            prepared.workspace.workingDirectory,
            rawOrdinal,
            `${rawOrdinal}`,
            { kind: 'writing-progress', event: progress },
          );
          const run = await currentRun(deps.db, input.context);
          if (run.status === 'running') {
            const observedSequence = run.observedSequence + 1;
            await command(deps, input.context, (current) => ({
              kind: 'advance-cursor',
              runId: input.context.runId,
              expectedRevision: current.revision,
              expectedCursor: current.cursor,
              cursor: `${rawOrdinal}`,
              observedSequence,
              commandId: `cursor:${input.context.runId}:${observedSequence}`,
              eventId: `event:cursor:${input.context.runId}:${observedSequence}`,
            }));
          }
          input.reportProgress({
            cursor: `${rawOrdinal}`,
            state: asJson({
              kind: 'writing-agent-running',
              nativeSessionId: nativeSessionId ?? null,
              progress,
            }),
          });
        },
      } satisfies CodexStructuredDeps,
    );
    if (!promptDispatched) throw new Error('writing adapter did not record actual Prompt dispatch');
    const claim = assertWritingResult(output.result);
    if (claim.status !== 'completed')
      throw new Error(`Writing Agent reported failure: ${claim.summary}`);
    if ((await currentRun(deps.db, input.context)).status !== 'running')
      throw new Error('Writing Agent did not start the native Run');
    return {
      status: 'completed',
      state: asJson({
        kind: 'writing-agent-completed',
        workspace: prepared.workspace,
        nativeSessionId: output.nativeSessionId,
        claim,
      }),
      handle: {
        sessionRef: output.nativeSessionId,
        detail: { workspaceId: prepared.workspace.workspaceId },
      },
    };
  } catch (error) {
    if (error instanceof CodexTransportCancelledError || input.signal.aborted) {
      return {
        status: 'cancelled',
        reason: error instanceof Error ? error.message : 'writing-agent cancelled',
      };
    }
    return {
      status: 'failed',
      code: 'writing-executor-failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function recordRestart(
  deps: WritingAgentAdapterDeps,
  args: Parameters<AgentRuntimeStepPorts['recordRestart']>[0],
): Promise<void> {
  const run = await currentRun(deps.db, args.context);
  if (run.status !== 'running') throw new Error(`cannot restart writing-agent from ${run.status}`);
  await command(deps, args.context, (current) => ({
    kind: 'restart',
    runId: args.context.runId,
    expectedRevision: current.revision,
    expectedCursor: current.cursor,
    reason: `${args.reason}:attempt-${args.attempt}`,
    ...(current.handle === undefined ? {} : { handle: current.handle }),
    commandId: `restart:${args.context.runId}:${args.attempt}`,
    eventId: `event:restart:${args.context.runId}:${args.attempt}`,
  }));
}

export async function executeWritingAgentRunWithDeps(
  args: AgentExecuteActivityArgs,
  deps: WritingAgentAdapterDeps,
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

export async function collectWritingAgentRunWithDeps(
  input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  },
  deps: WritingAgentAdapterDeps,
): Promise<AgentCollectedResult> {
  const payload = parseTask(input.context);
  const completed = parseCompleted(input.execution.state);
  const collected = await collectDocumentWorkspace({
    handle: completed.workspace,
    brief: payload.writingBrief,
    claim: completed.claim,
  });
  const progress = await persistedProgress(deps, input.context.runId);
  const startedCommands = new Map<string, string>();
  for (const event of progress)
    if (event.kind === 'command-started') startedCommands.set(event.commandId, event.summary);
  const verification = await verifyWritingOutput({
    brief: payload.writingBrief,
    claim: completed.claim,
    collected,
    observedCommands: [...startedCommands.values()],
  });
  const artifact = await storeAgentRunPayload(deps.db, collected.artifact.content, 'text/markdown');
  const trajectory = await storeAgentRunPayload(deps.db, progress, 'application/x-ndjson');
  const candidate: AgentResultEnvelope = {
    schemaVersion: 1,
    contract: input.context.birth.resultContract,
    resultId: completed.claim.resultId,
    payload: asJson({ writingResult: completed.claim, render: verification.render }),
    artifacts: [
      {
        ref: `agent-run-payload:${artifact.hash}`,
        hash: collected.artifact.hash,
        mediaType: 'text/markdown',
        sizeBytes: collected.artifact.sizeBytes,
      },
      {
        ref: `agent-run-payload:${trajectory.hash}`,
        hash: trajectory.hash,
        mediaType: 'application/x-ndjson',
        sizeBytes: trajectory.bytes,
      },
    ],
    evidence: verification.evidence.map((item) => ({
      ref: `${item.verifier}:${input.context.runId}`,
      kind: item.verifier,
      ...(item.verifier === 'markdown-render' ? { hash: verification.render.hash } : {}),
      detail: asJson({ passed: item.passed, detail: item.detail }),
    })),
    proposedEffects: [],
  };
  return { candidate };
}

export function verifyWritingAgentRun(input: {
  context: AgentRunWorkflowArgs;
  collected: AgentCollectedResult;
}): AgentVerificationResult {
  const candidate = input.collected.candidate;
  const payload = candidate.payload;
  const writingResult = record(payload) ? payload.writingResult : undefined;
  let result: WritingResult;
  try {
    result = assertWritingResult(writingResult);
  } catch (error) {
    return {
      status: 'failed',
      code: 'writing-result-contract-invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const artifact = candidate.artifacts.find((item) => item.hash === result.artifact.hash);
  const requiredEvidence = [
    'writing-result-schema',
    'document-workspace',
    'source-integrity',
    'artifact-integrity',
    'citation-coverage',
    'markdown-render',
    'forbidden-writing-effects',
  ];
  if (
    candidate.contract.ref !== input.context.birth.resultContract.ref ||
    candidate.contract.hash !== input.context.birth.resultContract.hash ||
    candidate.resultId !== result.resultId ||
    artifact?.mediaType !== result.artifact.mediaType ||
    artifact.sizeBytes !== result.artifact.sizeBytes ||
    candidate.proposedEffects.length > 0 ||
    requiredEvidence.some(
      (kind) =>
        !candidate.evidence.some(
          (evidence) =>
            evidence.kind === kind && record(evidence.detail) && evidence.detail.passed === true,
        ),
    )
  ) {
    return {
      status: 'failed',
      code: 'writing-result-evidence-invalid',
      reason: 'Writing result lacks birth-pinned artifacts or independent verifier evidence',
    };
  }
  return { status: 'succeeded', result: candidate };
}

async function defaultCallback(input: WritingAgentCallbackInput): Promise<void> {
  const response = await fetch(`${input.baseUrl}/api/internal/agent-run-callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ui4a-capability-token': input.token },
    body: JSON.stringify({ runId: input.runId, outcome: input.outcome }),
  });
  if (!response.ok)
    throw new Error(`agent run callback failed: HTTP ${response.status} ${await response.text()}`);
}

export async function finalizeWritingAgentRunWithDeps(
  input: AgentFinalizeInput,
  deps: WritingAgentAdapterDeps,
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
      if (input.outcome.status === 'succeeded')
        return { ...base, kind: 'succeed', result: input.outcome.result };
      if (input.outcome.status === 'cancelled')
        return { ...base, kind: 'cancel', reason: input.outcome.reason };
      return { ...base, kind: 'fail', code: input.outcome.code, reason: input.outcome.reason };
    });
  }
  const callback = deps.callback ?? defaultCallback;
  const baseUrl = deps.callbackBaseUrl ?? process.env.UI4A_PUBLIC_BASE_URL;
  const token = deps.callbackToken ?? process.env.UI4A_CAPABILITY_CALLBACK_TOKEN;
  if (deps.callback === undefined && (baseUrl === undefined || token === undefined || token === ''))
    throw new Error('generic agent callback requires base URL and callback token');
  await callback({
    baseUrl: baseUrl ?? '',
    token: token ?? '',
    runId: run.runId,
    outcome: input.outcome,
  });
}
