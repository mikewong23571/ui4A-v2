import { join } from 'node:path';

import {
  canonicalJson,
  hashCanonicalAgentJson,
  type AgentResultEnvelope,
  type AgentRun,
  type AgentRunCommand,
  type AgentRunJson,
} from '@ui4a/engine';
import type {
  CodingExecutorProfile,
  CodingNormalizedEvent,
  CodingResult,
  CodingTask,
  WorkspaceHandle,
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
  CodingExecutorCancelledError,
  executeCodexTask,
  probeCodexExecutor,
  type CodexCompiledPrompt,
  type CodexExecutionOutput,
} from '../../capabilities/coding/codex';
import {
  collectGitWorkspace,
  parseRepositoryRegistry,
  prepareGitWorkspace,
  type GitWorkspaceHandle,
  type RepositoryRegistry,
} from '../../capabilities/coding/workspace';
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

type CodingPromptMessage = CodexCompiledPrompt['messages'][number] & {
  blockId?: string;
  purpose?: string;
  sealed?: boolean;
};

interface CodingAgentTaskPayload {
  kind: 'coding-task';
  codingTask: CodingTask;
  compiledPrompt: {
    compiledHash: string;
    messages: CodingPromptMessage[];
  };
}

interface CodingPreparedState {
  kind: 'coding-agent-prepared';
  workspace: WorkspaceHandle;
}

interface CodingCompletedState {
  kind: 'coding-agent-completed';
  workspace: WorkspaceHandle;
  nativeSessionId: string;
  claim: CodexExecutionOutput['claim'];
}

export interface CodingAgentCallbackInput {
  baseUrl: string;
  token: string;
  runId: string;
  outcome: AgentFinalizeInput['outcome'];
}

export interface CodingAgentAdapterDeps {
  db: ConnectableDb;
  repositoryRegistry: string;
  workspaceRoot: string;
  profiles: CodingExecutorProfile[];
  execute?: typeof executeCodexTask;
  probe?: (profileName: string) => Promise<{ available: boolean; reason?: string }>;
  callback?: (input: CodingAgentCallbackInput) => Promise<unknown>;
  callbackBaseUrl?: string;
  callbackToken?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function codingTask(value: unknown): CodingTask {
  if (!record(value)) throw new Error('coding-agent task is missing codingTask');
  if (
    value.schemaVersion !== 1 ||
    typeof value.repositoryRef !== 'string' ||
    typeof value.baseRevision !== 'string' ||
    typeof value.goal !== 'string' ||
    !strings(value.constraints) ||
    !strings(value.acceptanceCriteria) ||
    !strings(value.allowedPaths) ||
    !record(value.budget) ||
    !record(value.redaction)
  ) {
    throw new Error('coding-agent codingTask does not match CodingTask@1');
  }
  return value as unknown as CodingTask;
}

function parseTask(context: AgentRunWorkflowArgs): CodingAgentTaskPayload {
  const payload = context.task.payload;
  if (!record(payload) || payload.kind !== 'coding-task') {
    throw new Error('coding-agent adapter requires task.payload.kind=coding-task');
  }
  if (!record(payload.compiledPrompt)) throw new Error('coding-agent compiled Prompt is missing');
  if (
    typeof payload.compiledPrompt.compiledHash !== 'string' ||
    payload.compiledPrompt.compiledHash !== context.birth.prompt.compiledHash
  ) {
    throw new Error('coding-agent compiled Prompt hash does not match Run birth provenance');
  }
  if (
    !Array.isArray(payload.compiledPrompt.messages) ||
    payload.compiledPrompt.messages.length === 0 ||
    payload.compiledPrompt.messages.some(
      (message) =>
        !record(message) ||
        !['system', 'user', 'assistant'].includes(String(message.role)) ||
        typeof message.content !== 'string' ||
        typeof message.blockId !== 'string' ||
        typeof message.purpose !== 'string' ||
        typeof message.sealed !== 'boolean',
    )
  ) {
    throw new Error('coding-agent compiled Prompt messages are invalid');
  }
  const messages = payload.compiledPrompt.messages as unknown as CodingPromptMessage[];
  if (
    hashCanonicalAgentJson(messages as unknown as AgentRunJson) !==
    context.birth.prompt.compiledHash
  ) {
    throw new Error('coding-agent compiled Prompt messages failed their birth-pinned hash');
  }
  return {
    kind: 'coding-task',
    codingTask: codingTask(payload.codingTask),
    compiledPrompt: {
      compiledHash: payload.compiledPrompt.compiledHash,
      messages,
    },
  };
}

function profileFor(context: AgentRunWorkflowArgs, profiles: CodingExecutorProfile[]) {
  const profileName = context.birth.runtime.profileName;
  const matches = profiles.filter((candidate) => candidate.name === profileName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `coding executor profile ${profileName} is missing`
        : `coding executor profile ${profileName} is ambiguous`,
    );
  }
  const profile = matches[0]!;
  if (profile.executorClass !== 'coding-agent') {
    throw new Error(`runtime profile ${profileName} is not a coding-agent profile`);
  }
  if (profile.providerId !== 'codex') {
    throw new Error(`coding executor provider ${profile.providerId} is unavailable`);
  }
  if (profile.sandbox !== 'workspace-write') {
    throw new Error('coding-agent requires the server-owned workspace-write sandbox');
  }
  return profile;
}

async function currentRun(db: ConnectableDb, context: AgentRunWorkflowArgs): Promise<AgentRun> {
  const run = await getAgentRun(db, context.runId, context.principal, context.policyScope);
  if (run === undefined) throw new Error('native agent run does not exist or is not authorized');
  return run;
}

async function command(
  deps: CodingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  build: (run: AgentRun) => AgentRunCommand,
): Promise<AgentRun> {
  const run = await currentRun(deps.db, context);
  return (await appendAgentRunCommand(deps.db, build(run))).aggregate;
}

function sharedWorkspace(handle: GitWorkspaceHandle, allowedPaths: string[]): WorkspaceHandle {
  return {
    schemaVersion: 1,
    workspaceId: handle.id,
    repositoryRef: handle.repositoryRef,
    baseRevision: handle.baseRevision,
    branch: handle.branch,
    leaseId: `lease:${handle.id}`,
    allowedPaths,
    mainCheckoutFingerprint: handle.mainCheckoutFingerprint,
  };
}

function parsePrepared(value: AgentRunJson): CodingPreparedState {
  if (!record(value) || value.kind !== 'coding-agent-prepared' || !record(value.workspace)) {
    throw new Error('coding-agent prepared state is invalid');
  }
  return value as unknown as CodingPreparedState;
}

function parseCompleted(value: AgentRunJson): CodingCompletedState {
  if (
    !record(value) ||
    value.kind !== 'coding-agent-completed' ||
    !record(value.workspace) ||
    typeof value.nativeSessionId !== 'string' ||
    !record(value.claim)
  ) {
    throw new Error('coding-agent completed state is invalid');
  }
  return value as unknown as CodingCompletedState;
}

function internalWorkspace(
  context: AgentRunWorkflowArgs,
  workspace: WorkspaceHandle,
  registry: RepositoryRegistry,
  workspaceRoot: string,
): GitWorkspaceHandle {
  const task = parseTask(context).codingTask;
  const entry = registry[task.repositoryRef];
  if (entry === undefined) throw new Error('repository disappeared from the server registry');
  return {
    id: workspace.workspaceId,
    repositoryRef: workspace.repositoryRef,
    repositoryPath: entry.path,
    path: join(workspaceRoot, context.runId),
    branch: workspace.branch,
    baseRevision: workspace.baseRevision,
    mainCheckoutFingerprint: workspace.mainCheckoutFingerprint,
  };
}

function assertTaskWithinRegistry(task: CodingTask, registry: RepositoryRegistry): void {
  const entry = registry[task.repositoryRef];
  if (entry === undefined) throw new Error('repositoryRef is not registered');
  for (const path of task.allowedPaths) {
    const allowed = entry.allowedPaths.some(
      (ceiling) => path === ceiling || path.startsWith(`${ceiling}/`),
    );
    if (!allowed) throw new Error(`task allowed path ${path} exceeds repository policy`);
  }
}

/** Prepare one coding specialization on the native Agent Run event family. */
export async function prepareCodingAgentRunWithDeps(
  context: AgentRunWorkflowArgs,
  deps: CodingAgentAdapterDeps,
): Promise<AgentPreparedResult> {
  const payload = parseTask(context);
  profileFor(context, deps.profiles);
  const descriptor = await (deps.probe ?? probeCodexExecutor)(context.birth.runtime.profileName);
  if (!descriptor.available) throw new Error(descriptor.reason ?? 'coding executor unavailable');
  const registry = parseRepositoryRegistry(deps.repositoryRegistry);
  assertTaskWithinRegistry(payload.codingTask, registry);
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
    throw new Error(`native agent run cannot prepare from ${run.status}`);
  }
  const handle = await prepareGitWorkspace(
    {
      runId: context.runId,
      repositoryRef: payload.codingTask.repositoryRef,
      baseRevision: payload.codingTask.baseRevision,
      policyScope: context.policyScope,
    },
    { registry, workspaceRoot: deps.workspaceRoot },
  );
  const state: CodingPreparedState = {
    kind: 'coding-agent-prepared',
    workspace: sharedWorkspace(handle, payload.codingTask.allowedPaths),
  };
  return { state: state as unknown as AgentRunJson };
}

function jsonSafe(value: unknown): AgentRunJson {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
}

function redactPayload(value: unknown, task: CodingTask, workspacePath: string): AgentRunJson {
  const secrets = new Set(task.redaction.secretNames);
  const secretValues = task.redaction.secretNames
    .map((name) => process.env[name])
    .filter((item): item is string => item !== undefined && item !== '');
  const walk = (child: AgentRunJson): AgentRunJson => {
    if (typeof child === 'string') {
      let output = child;
      for (const secret of secretValues) output = output.replaceAll(secret, '[REDACTED]');
      if (task.redaction.redactHostPaths) output = output.replaceAll(workspacePath, '[WORKSPACE]');
      return output;
    }
    if (Array.isArray(child)) return child.map(walk);
    if (child === null || typeof child !== 'object') return child;
    return Object.fromEntries(
      Object.entries(child).map(([key, nested]) => [
        key,
        secrets.has(key) ? '[REDACTED]' : walk(nested),
      ]),
    );
  };
  return walk(jsonSafe(value));
}

async function rawStats(deps: CodingAgentAdapterDeps, runId: string) {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  return {
    count: receipts.length,
    bytes: receipts.reduce((sum, receipt) => sum + Number(receipt.byteLength ?? 0), 0),
    maxOrdinal: receipts.reduce((max, receipt) => Math.max(max, Number(receipt.ordinal ?? 0)), 0),
  };
}

async function appendBoundedRaw(
  deps: CodingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  task: CodingTask,
  workspacePath: string,
  ordinal: number,
  cursor: string,
  payload: unknown,
): Promise<void> {
  const redactedPayload = redactPayload(payload, task, workspacePath);
  const bytes = new TextEncoder().encode(canonicalJson(redactedPayload)).byteLength;
  const stats = await rawStats(deps, context.runId);
  if (ordinal !== stats.maxOrdinal + 1) throw new Error('coding-agent raw ordinal conflict');
  if (stats.count >= task.budget.maxRawEvents)
    throw new Error('coding-agent raw event budget exhausted');
  if (bytes > task.budget.maxRawChunkBytes)
    throw new Error('coding-agent raw chunk budget exceeded');
  if (stats.bytes + bytes > task.budget.maxRawBytes) {
    throw new Error('coding-agent raw byte budget exhausted');
  }
  await appendAgentRunRawEvent(deps.db, {
    runId: context.runId,
    principal: context.principal,
    policyScope: context.policyScope,
    ordinal,
    cursor,
    redactedPayload,
  });
}

function testRunsFromEvents(events: CodingNormalizedEvent[], claimed: string[]) {
  const started = new Map<string, string>();
  const completed = new Map<string, number>();
  for (const event of events) {
    if (event.kind === 'command-started') started.set(event.commandId, event.summary);
    if (event.kind === 'command-completed') completed.set(event.commandId, event.exitCode);
  }
  return claimed.map((claimedCommand) => {
    const commandPrefix = claimedCommand
      .split(/\s+(?:—|–|-)\s+|:|\s+(?:passes|passed)\b|\s+\(/iu, 1)[0]!
      .trim();
    const match = [...started].find(
      ([, command]) =>
        command.includes(claimedCommand) ||
        (commandPrefix.length >= 3 && command.includes(commandPrefix)),
    );
    const exitCode = match === undefined ? 1 : (completed.get(match[0]) ?? 1);
    return { command: match?.[1] ?? claimedCommand, exitCode, passed: exitCode === 0 };
  });
}

async function executeRuntime(
  input: AgentRuntimeExecutionInput,
  deps: CodingAgentAdapterDeps,
): Promise<AgentExecutionResult> {
  const payload = parseTask(input.context);
  const profile = profileFor(input.context, deps.profiles);
  const prepared = parsePrepared(input.prepared.state);
  const registry = parseRepositoryRegistry(deps.repositoryRegistry);
  const workspace = internalWorkspace(
    input.context,
    prepared.workspace,
    registry,
    deps.workspaceRoot,
  );
  const execute = deps.execute ?? executeCodexTask;
  const before = await rawStats(deps, input.context.runId);
  let rawOrdinal = before.maxOrdinal;
  let promptDispatched = false;
  let nativeSessionId = (await currentRun(deps.db, input.context)).handle?.sessionRef;
  try {
    const compiledPrompt: CodexCompiledPrompt = {
      compiledHash: payload.compiledPrompt.compiledHash,
      messages: payload.compiledPrompt.messages.map(({ role, content }) => ({ role, content })),
    };
    const output = await execute(
      {
        runId: input.context.runId,
        task: payload.codingTask,
        profile,
        workspace: { id: workspace.id, path: workspace.path },
        compiledPrompt,
        ...(nativeSessionId === undefined ? {} : { nativeSessionId }),
        signal: input.signal,
      },
      {
        onPromptDispatched: async (receipt) => {
          promptDispatched = true;
          rawOrdinal += 1;
          await appendBoundedRaw(
            deps,
            input.context,
            payload.codingTask,
            workspace.path,
            rawOrdinal,
            `${rawOrdinal}`,
            { kind: 'prompt-dispatched', ...receipt },
          );
        },
        onRaw: async (event, cursor) => {
          rawOrdinal += 1;
          await appendBoundedRaw(
            deps,
            input.context,
            payload.codingTask,
            workspace.path,
            rawOrdinal,
            cursor,
            { kind: 'provider-raw', payload: event },
          );
        },
        onNormalized: async (event) => {
          if (event.kind === 'run-started') {
            nativeSessionId = event.nativeSessionId ?? nativeSessionId;
            const run = await currentRun(deps.db, input.context);
            if (run.status === 'preparing') {
              await command(deps, input.context, (current) => ({
                kind: 'start',
                runId: input.context.runId,
                expectedRevision: current.revision,
                commandId: `start:${input.context.runId}`,
                eventId: `event:start:${input.context.runId}`,
                handle: {
                  ...(nativeSessionId === undefined ? {} : { sessionRef: nativeSessionId }),
                  detail: { workspaceId: prepared.workspace.workspaceId },
                },
              }));
            }
          }
          rawOrdinal += 1;
          await appendBoundedRaw(
            deps,
            input.context,
            payload.codingTask,
            workspace.path,
            rawOrdinal,
            `${rawOrdinal}`,
            { kind: 'coding-normalized', event },
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
            state: {
              kind: 'coding-agent-running',
              nativeSessionId: nativeSessionId ?? null,
              lastNormalizedSequence: event.sequence,
            },
          });
        },
      },
    );
    if (!promptDispatched) throw new Error('coding adapter did not record actual Prompt dispatch');
    if (output.claim.status !== 'completed') {
      throw new Error(`Codex reported task failure: ${output.claim.summary}`);
    }
    const run = await currentRun(deps.db, input.context);
    if (run.status !== 'running') throw new Error('Codex did not start the native Agent Run');
    const state: CodingCompletedState = {
      kind: 'coding-agent-completed',
      workspace: prepared.workspace,
      nativeSessionId: output.nativeSessionId,
      claim: output.claim,
    };
    return { status: 'completed', state: state as unknown as AgentRunJson, handle: run.handle };
  } catch (error) {
    if (error instanceof CodingExecutorCancelledError || input.signal.aborted) {
      return {
        status: 'cancelled',
        reason: error instanceof Error ? error.message : 'coding-agent cancelled',
      };
    }
    return {
      status: 'failed',
      code: 'coding-executor-failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function recordRestart(
  deps: CodingAgentAdapterDeps,
  args: Parameters<AgentRuntimeStepPorts['recordRestart']>[0],
): Promise<void> {
  const run = await currentRun(deps.db, args.context);
  if (run.status !== 'running') throw new Error(`cannot restart coding-agent from ${run.status}`);
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

/** Execute/resume Codex behind the generic Host's heartbeat and restart protocol. */
export async function executeCodingAgentRunWithDeps(
  args: AgentExecuteActivityArgs,
  deps: CodingAgentAdapterDeps,
  controls?: AgentActivityControls,
): Promise<AgentExecutionResult> {
  const runtime: AgentRuntimePort = {
    execute: (input) => executeRuntime(input, deps),
    resume: (input) => executeRuntime(input, deps),
  };
  return executeAgentRuntimeStep(
    args,
    { runtime, recordRestart: (restartArgs) => recordRestart(deps, restartArgs) },
    controls,
  );
}

async function persistedNormalizedEvents(
  deps: CodingAgentAdapterDeps,
  runId: string,
): Promise<CodingNormalizedEvent[]> {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  const events: CodingNormalizedEvent[] = [];
  for (const receipt of receipts) {
    const payload = await readAgentRunPayload(deps.db, String(receipt.payloadRef));
    if (record(payload) && payload.kind === 'coding-normalized' && record(payload.event)) {
      events.push(payload.event as unknown as CodingNormalizedEvent);
    }
  }
  return events;
}

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
