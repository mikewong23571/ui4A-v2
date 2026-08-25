import type { AgentRunJson } from '@ui4a/engine';

import {
  CodingExecutorCancelledError,
  executeCodexTask,
  probeCodexExecutor,
  type CodexCompiledPrompt,
} from '../../capabilities/coding/codex';
import { parseRepositoryRegistry, prepareGitWorkspace } from '../../capabilities/coding/workspace';
import type {
  AgentExecuteActivityArgs,
  AgentExecutionResult,
  AgentPreparedResult,
  AgentRunWorkflowArgs,
  AgentRuntimeExecutionInput,
  AgentRuntimePort,
} from '../host/contracts';
import {
  executeAgentRuntimeStep,
  type AgentActivityControls,
  type AgentRuntimeStepPorts,
} from '../host/runtime';
import {
  assertTaskWithinRegistry,
  command,
  currentRun,
  internalWorkspace,
  parsePrepared,
  parseTask,
  profileFor,
  sharedWorkspace,
} from './adapter-parse';
import { appendBoundedRaw, rawStats } from './adapter-raw';
import type {
  CodingAgentAdapterDeps,
  CodingCompletedState,
  CodingPreparedState,
} from './adapter-types';

export {
  collectCodingAgentRunWithDeps,
  finalizeCodingAgentRunWithDeps,
  verifyCodingAgentRun,
} from './adapter-results';
export type { CodingAgentAdapterDeps, CodingAgentCallbackInput } from './adapter-types';

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
