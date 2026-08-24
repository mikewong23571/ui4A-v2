import {
  canonicalJson,
  hashCanonicalAgentJson,
  type AgentResultEnvelope,
  type AgentRun,
  type AgentRunCommand,
  type AgentRunJson,
} from '@ui4a/engine';
import {
  assertWritingBrief,
  assertWritingResult,
  type WritingBrief,
  type WritingResult,
} from '@ui4a/shared';

import {
  appendAgentRunCommand,
  appendAgentRunRawEvent,
  getAgentRun,
  listAgentRunRawReceipts,
  readAgentRunPayload,
  storeAgentRunPayload,
  type ConnectableDb,
} from '../../../../web/src/db/agent-runs';
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
  type DocumentWorkspaceHandle,
} from './workspace';

export interface DocumentAgentProfile {
  name: string;
  runtimeClass: 'document-agent';
  providerId: string;
  transport: 'sdk';
  model: string;
  endpoint?: string;
  apiKeyEnv: string;
  artifactBackend: 'isolated-document-workspace';
  timeoutSeconds: number;
  maxTurns: number;
  envAllowlist: string[];
  networkPolicy: 'none' | 'source-only';
}

type CompiledMessage = {
  blockId: string;
  role: 'system' | 'user' | 'assistant';
  purpose: string;
  content: string;
  sealed: boolean;
};

interface WritingTaskPayload {
  kind: 'writing-task';
  writingBrief: WritingBrief;
  compiledPrompt: { compiledHash: string; messages: CompiledMessage[] };
}

interface WritingPreparedState {
  kind: 'writing-agent-prepared';
  workspace: DocumentWorkspaceHandle;
}

interface WritingCompletedState {
  kind: 'writing-agent-completed';
  workspace: DocumentWorkspaceHandle;
  nativeSessionId: string;
  claim: WritingResult;
}

export interface WritingAgentCallbackInput {
  baseUrl: string;
  token: string;
  runId: string;
  outcome: AgentFinalizeInput['outcome'];
}

export interface WritingAgentAdapterDeps {
  db: ConnectableDb;
  workspaceRoot: string;
  profiles: DocumentAgentProfile[];
  execute?: typeof executeCodexStructured;
  probe?: () => Promise<{ available: boolean; reason?: string }>;
  callback?: (input: WritingAgentCallbackInput) => Promise<unknown>;
  callbackBaseUrl?: string;
  callbackToken?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): AgentRunJson {
  return JSON.parse(JSON.stringify(value)) as AgentRunJson;
}

function parseTask(context: AgentRunWorkflowArgs): WritingTaskPayload {
  const payload = context.task.payload;
  if (!record(payload) || payload.kind !== 'writing-task') {
    throw new Error('writing-agent adapter requires task.payload.kind=writing-task');
  }
  const writingBrief = assertWritingBrief(payload.writingBrief);
  if (!record(payload.compiledPrompt) || typeof payload.compiledPrompt.compiledHash !== 'string') {
    throw new Error('writing-agent compiled Prompt is missing');
  }
  if (payload.compiledPrompt.compiledHash !== context.birth.prompt.compiledHash) {
    throw new Error('writing-agent compiled Prompt hash does not match Run birth provenance');
  }
  if (
    !Array.isArray(payload.compiledPrompt.messages) ||
    payload.compiledPrompt.messages.length === 0 ||
    payload.compiledPrompt.messages.some(
      (message) =>
        !record(message) ||
        typeof message.blockId !== 'string' ||
        !['system', 'user', 'assistant'].includes(String(message.role)) ||
        typeof message.purpose !== 'string' ||
        typeof message.content !== 'string' ||
        typeof message.sealed !== 'boolean',
    )
  ) {
    throw new Error('writing-agent compiled Prompt messages are invalid');
  }
  const messages = payload.compiledPrompt.messages as unknown as CompiledMessage[];
  if (
    hashCanonicalAgentJson(messages as unknown as AgentRunJson) !==
    payload.compiledPrompt.compiledHash
  ) {
    throw new Error('writing-agent compiled Prompt messages failed their birth-pinned hash');
  }
  return {
    kind: 'writing-task',
    writingBrief,
    compiledPrompt: { compiledHash: payload.compiledPrompt.compiledHash, messages },
  };
}

function profileFor(
  context: AgentRunWorkflowArgs,
  profiles: DocumentAgentProfile[],
): DocumentAgentProfile {
  const matches = profiles.filter((profile) => profile.name === context.birth.runtime.profileName);
  if (matches.length !== 1)
    throw new Error(
      `document-agent profile ${context.birth.runtime.profileName} must resolve exactly once`,
    );
  const profile = matches[0]!;
  if (profile.runtimeClass !== 'document-agent')
    throw new Error('document-agent runtime class mismatch');
  if (profile.providerId !== 'codex')
    throw new Error(`document-agent Provider ${profile.providerId} is unavailable`);
  if (profile.artifactBackend !== 'isolated-document-workspace')
    throw new Error('document-agent requires isolated-document-workspace');
  if (profile.networkPolicy !== 'none')
    throw new Error('writing-agent@1 requires networkPolicy=none');
  return profile;
}

/** Parse deployment configuration without a default/fallback profile. */
export function parseDocumentAgentProfiles(raw: string): DocumentAgentProfile[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error('UI4A_DOCUMENT_AGENT_PROFILES must be an array');
  return value.map((profile, index) => {
    if (!record(profile)) throw new Error(`document-agent profile ${index} must be an object`);
    const candidate = profile as unknown as DocumentAgentProfile;
    if (
      typeof candidate.name !== 'string' ||
      candidate.runtimeClass !== 'document-agent' ||
      candidate.transport !== 'sdk' ||
      typeof candidate.providerId !== 'string' ||
      typeof candidate.model !== 'string' ||
      typeof candidate.apiKeyEnv !== 'string' ||
      candidate.artifactBackend !== 'isolated-document-workspace' ||
      !Number.isSafeInteger(candidate.timeoutSeconds) ||
      candidate.timeoutSeconds <= 0 ||
      !Number.isSafeInteger(candidate.maxTurns) ||
      candidate.maxTurns <= 0 ||
      !Array.isArray(candidate.envAllowlist) ||
      candidate.envAllowlist.some((entry) => typeof entry !== 'string') ||
      (candidate.networkPolicy !== 'none' && candidate.networkPolicy !== 'source-only')
    ) {
      throw new Error(`document-agent profile ${index} is invalid`);
    }
    return candidate;
  });
}

async function currentRun(db: ConnectableDb, context: AgentRunWorkflowArgs): Promise<AgentRun> {
  const run = await getAgentRun(db, context.runId, context.principal, context.policyScope);
  if (run === undefined)
    throw new Error('native writing Agent Run does not exist or is not authorized');
  return run;
}

async function command(
  deps: WritingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  build: (run: AgentRun) => AgentRunCommand,
): Promise<AgentRun> {
  const run = await currentRun(deps.db, context);
  return (await appendAgentRunCommand(deps.db, build(run))).aggregate;
}

function parsePrepared(value: AgentRunJson): WritingPreparedState {
  if (!record(value) || value.kind !== 'writing-agent-prepared' || !record(value.workspace)) {
    throw new Error('writing-agent prepared state is invalid');
  }
  return value as unknown as WritingPreparedState;
}

/** Read the mechanically prepared per-Run workspace for sealed remote Runtime delivery. */
export function writingPreparedWorkspaceRoot(prepared: AgentPreparedResult): string {
  return parsePrepared(prepared.state).workspace.workingDirectory;
}

function parseCompleted(value: AgentRunJson): WritingCompletedState {
  if (
    !record(value) ||
    value.kind !== 'writing-agent-completed' ||
    !record(value.workspace) ||
    typeof value.nativeSessionId !== 'string' ||
    !record(value.claim)
  ) {
    throw new Error('writing-agent completed state is invalid');
  }
  return { ...value, claim: assertWritingResult(value.claim) } as unknown as WritingCompletedState;
}

export const WRITING_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    resultId: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'failed'] },
    summary: { type: 'string' },
    artifact: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        hash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
        sizeBytes: { type: 'integer', minimum: 1 },
        mediaType: { type: 'string', const: 'text/markdown' },
      },
      required: ['path', 'hash', 'sizeBytes', 'mediaType'],
      additionalProperties: false,
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
          sourceHash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
          paragraphs: { type: 'array', items: { type: 'integer', minimum: 1 } },
          claims: { type: 'array', items: { type: 'string' } },
        },
        required: ['sourceId', 'sourceHash', 'paragraphs', 'claims'],
        additionalProperties: false,
      },
    },
    safety: {
      type: 'object',
      properties: Object.fromEntries(
        [
          'sourceInputsUnchanged',
          'onlyAllowedOutputs',
          'noRepositoryEffects',
          'noNetworkEffects',
          'noPublishEffects',
        ].map((name) => [name, { type: 'boolean', const: true }]),
      ),
      required: [
        'sourceInputsUnchanged',
        'onlyAllowedOutputs',
        'noRepositoryEffects',
        'noNetworkEffects',
        'noPublishEffects',
      ],
      additionalProperties: false,
    },
  },
  required: ['schemaVersion', 'resultId', 'status', 'summary', 'artifact', 'citations', 'safety'],
  additionalProperties: false,
} as const;

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

function jsonSafe(value: unknown): AgentRunJson {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
}

function redactRaw(value: unknown, brief: WritingBrief, workspacePath: string): AgentRunJson {
  const sources = brief.sources.map((source) => [source.content, `[SOURCE:${source.id}]`] as const);
  const walk = (child: AgentRunJson): AgentRunJson => {
    if (typeof child === 'string') {
      let output = child.replaceAll(workspacePath, '[WORKSPACE]');
      for (const [content, replacement] of sources)
        if (content !== '') output = output.replaceAll(content, replacement);
      return output;
    }
    if (Array.isArray(child)) return child.map(walk);
    if (child === null || typeof child !== 'object') return child;
    return Object.fromEntries(Object.entries(child).map(([key, nested]) => [key, walk(nested)]));
  };
  return walk(jsonSafe(value));
}

async function rawStats(deps: WritingAgentAdapterDeps, runId: string) {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  return {
    count: receipts.length,
    bytes: receipts.reduce((sum, receipt) => sum + Number(receipt.byteLength ?? 0), 0),
    maxOrdinal: receipts.reduce((max, receipt) => Math.max(max, Number(receipt.ordinal ?? 0)), 0),
  };
}

async function appendRaw(
  deps: WritingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  brief: WritingBrief,
  workspacePath: string,
  ordinal: number,
  cursor: string,
  value: unknown,
): Promise<void> {
  const payload = redactRaw(value, brief, workspacePath);
  const byteLength = new TextEncoder().encode(canonicalJson(payload)).byteLength;
  const stats = await rawStats(deps, context.runId);
  if (ordinal !== stats.maxOrdinal + 1) throw new Error('writing-agent raw ordinal conflict');
  if (
    stats.count >= brief.budget.maxRawEvents ||
    byteLength > brief.budget.maxRawChunkBytes ||
    stats.bytes + byteLength > brief.budget.maxRawBytes
  ) {
    throw new Error('writing-agent raw trajectory budget exhausted');
  }
  await appendAgentRunRawEvent(deps.db, {
    runId: context.runId,
    principal: context.principal,
    policyScope: context.policyScope,
    ordinal,
    cursor,
    redactedPayload: payload,
  });
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

async function persistedProgress(
  deps: WritingAgentAdapterDeps,
  runId: string,
): Promise<CodexTransportProgress[]> {
  const progress: CodexTransportProgress[] = [];
  for (const receipt of await listAgentRunRawReceipts(deps.db, runId)) {
    const value = await readAgentRunPayload(deps.db, String(receipt.payloadRef));
    if (record(value) && value.kind === 'writing-progress' && record(value.event))
      progress.push(value.event as unknown as CodexTransportProgress);
  }
  return progress;
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
