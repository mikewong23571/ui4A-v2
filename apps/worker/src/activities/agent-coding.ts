/** Coding specialization 的 activity 绑定:env deps、远端执行器与组合端口。 */
import type { CodingNormalizedEvent } from '@ui4a/shared';

import {
  collectCodingAgentRunWithDeps,
  executeCodingAgentRunWithDeps,
  finalizeCodingAgentRunWithDeps,
  prepareCodingAgentRunWithDeps,
  verifyCodingAgentRun,
  type CodingAgentAdapterDeps,
} from '../agents/coding';
import type { AgentRunWorkflowArgs } from '../agents/host/contracts';
import type { CodexTransportProgress } from '../agents/host/codex-transport';
import type {
  CodexExecutionDeps,
  CodexExecutionInput,
  CodexExecutionOutput,
  CodexTaskClaim,
} from '../capabilities/coding/codex';
import {
  executeCompiledRuntimeTransport,
  type ProductionRuntimeSpecializationPort,
} from '../runtime-backends/production-wiring';
import { workerDb } from '../worker-db';
import {
  compiledTransportControls,
  promptReceipt,
  transportProgress,
  type ProductionExecuteInput,
} from './agent-remote';
import type { AgentSpecializationBinding } from './agent-shared';

export function codingAgentAdapterDeps(): CodingAgentAdapterDeps {
  const repositoryRegistry = process.env.UI4A_CODING_REPOSITORIES;
  const workspaceRoot = process.env.UI4A_CODING_WORKSPACE_ROOT;
  const profiles = process.env.UI4A_CODING_EXECUTOR_PROFILES;
  if (repositoryRegistry === undefined || workspaceRoot === undefined || profiles === undefined) {
    throw new Error(
      'coding agent requires UI4A_CODING_REPOSITORIES, UI4A_CODING_WORKSPACE_ROOT and UI4A_CODING_EXECUTOR_PROFILES',
    );
  }
  const parsed = JSON.parse(profiles) as unknown;
  if (!Array.isArray(parsed)) throw new Error('coding executor profiles must be an array');
  return {
    db: workerDb(),
    repositoryRegistry,
    workspaceRoot,
    profiles: parsed as CodingAgentAdapterDeps['profiles'],
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
}

const CODING_REMOTE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['completed', 'failed'] },
    summary: { type: 'string' },
    tests: { type: 'array', items: { type: 'string' } },
    changedFiles: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'tests', 'changedFiles'],
  additionalProperties: false,
} as const;

function normalizedCodingEvent(
  context: AgentRunWorkflowArgs,
  progress: CodexTransportProgress,
  sequence: number,
): CodingNormalizedEvent {
  const common = {
    schemaVersion: 1 as const,
    eventId: `remote:${context.runId}:${sequence}`,
    runId: context.runId,
    sequence,
  };
  switch (progress.kind) {
    case 'run-started':
      return { ...common, kind: 'run-started', nativeSessionId: progress.nativeSessionId };
    case 'command-started':
      return {
        ...common,
        kind: 'command-started',
        commandId: progress.commandId,
        summary: progress.summary,
      };
    case 'command-completed':
      return {
        ...common,
        kind: 'command-completed',
        commandId: progress.commandId,
        exitCode: progress.exitCode,
      };
    case 'files-changed':
      return { ...common, kind: 'files-changed', files: progress.files };
    case 'message-received':
      return { ...common, kind: 'progress-reported', message: progress.summary };
    case 'run-failed':
      return { ...common, kind: 'run-failed', code: progress.code, reason: progress.reason };
    case 'provider-event':
      return { ...common, kind: 'provider-event', providerDetail: progress.providerDetail };
  }
}

function remoteCodingExecutor(input: {
  context: AgentRunWorkflowArgs;
  profile: ProductionExecuteInput['profile'];
  transport: ProductionExecuteInput['transport'];
  runnerArtifactImage: string;
}): (value: CodexExecutionInput, deps: CodexExecutionDeps) => Promise<CodexExecutionOutput> {
  return async (value, deps) => {
    if (value.compiledPrompt === undefined) throw new Error('runtime_compiled_transport_invalid');
    const result = await executeCompiledRuntimeTransport({
      context: input.context,
      request: {
        schemaVersion: 1,
        compiledHash: value.compiledPrompt.compiledHash,
        messages: value.compiledPrompt.messages,
        outputSchema: CODING_REMOTE_RESULT_SCHEMA,
        sandboxMode: 'workspace-write',
      },
      profile: input.profile,
      transport: input.transport,
      runnerArtifactImage: input.runnerArtifactImage,
      controls: compiledTransportControls(value.signal ?? new AbortController().signal),
    });
    await deps.onPromptDispatched?.(promptReceipt(value.compiledPrompt));
    for (const [index, event] of result.events.entries()) {
      const cursor = String(index + 1);
      await deps.onRaw(event, cursor);
      const progress = transportProgress(event);
      if (progress !== undefined) {
        await deps.onNormalized(normalizedCodingEvent(input.context, progress, index + 1));
      }
    }
    return { nativeSessionId: result.nativeSessionId, claim: result.result as CodexTaskClaim };
  };
}

/** Composition binding: the coding specialization contributes one adapter object. */
export const codingBinding: AgentSpecializationBinding = {
  name: 'coding',
  taskKind: 'coding-task',
  prepare: (args) => prepareCodingAgentRunWithDeps(args, codingAgentAdapterDeps()),
  execute: (args) => executeCodingAgentRunWithDeps(args, codingAgentAdapterDeps()),
  collect: (args) => collectCodingAgentRunWithDeps(args, codingAgentAdapterDeps()),
  verify: verifyCodingAgentRun,
  finalize: (input) => finalizeCodingAgentRunWithDeps(input, codingAgentAdapterDeps()),
};

/** Production port: remote execution crosses the compiled runtime transport. */
export function codingProductionPort(): ProductionRuntimeSpecializationPort {
  return {
    taskKind: 'coding-task',
    prepare: (context) => prepareCodingAgentRunWithDeps(context, codingAgentAdapterDeps()),
    executeProduction: async (input) =>
      executeCodingAgentRunWithDeps(
        { context: input.context, prepared: input.prepared },
        {
          ...codingAgentAdapterDeps(),
          probe: async () => ({ available: true }),
          execute: remoteCodingExecutor(input),
        },
      ),
    collect: (input) => collectCodingAgentRunWithDeps(input, codingAgentAdapterDeps()),
    verify: verifyCodingAgentRun,
    finalize: (input) => finalizeCodingAgentRunWithDeps(input, codingAgentAdapterDeps()),
  };
}
