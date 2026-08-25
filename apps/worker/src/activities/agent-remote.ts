/**
 * Compiled runtime transport 的远端执行适配:把 sealed envelope 交给 production
 * runtime transport,回放的原始事件流重新穿过结构化 transport 的 deps 回调。
 */
import { createHash } from 'node:crypto';

import type { AgentRunWorkflowArgs } from '../agents/host/contracts';
import {
  serializeCodexMessages,
  type CodexStructuredDeps,
  type CodexStructuredInput,
  type CodexStructuredOutput,
  type CodexTransportProgress,
} from '../agents/host/codex-transport';
import {
  executeCompiledRuntimeTransport,
  type CompiledRuntimeTransportRequest,
  type CompiledRuntimeTransportResult,
  type ProductionRuntimeSpecializationPort,
} from '../runtime-backends/production-wiring';

export type ProductionExecuteInput = Parameters<
  NonNullable<ProductionRuntimeSpecializationPort['executeProduction']>
>[0];

export function promptReceipt(input: {
  compiledHash: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}) {
  return {
    compiledHash: input.compiledHash,
    sentPromptHash: `sha256:${createHash('sha256')
      .update(serializeCodexMessages(input.messages))
      .digest('hex')}`,
    messageCount: input.messages.length,
  };
}

export function transportProgress(value: unknown): CodexTransportProgress | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const kind = (value as { kind?: unknown }).kind;
  return [
    'run-started',
    'command-started',
    'command-completed',
    'files-changed',
    'message-received',
    'run-failed',
    'provider-event',
  ].includes(String(kind))
    ? (value as CodexTransportProgress)
    : undefined;
}

async function replayStructuredTransportEvents(
  input: CodexStructuredInput,
  deps: CodexStructuredDeps,
  result: CompiledRuntimeTransportResult,
): Promise<void> {
  await deps.onPromptDispatched?.(promptReceipt(input));
  for (const [index, event] of result.events.entries()) {
    const cursor = String(index + 1);
    await deps.onRaw(event, cursor);
    const progress = transportProgress(event);
    if (progress !== undefined) await deps.onProgress(progress);
  }
}

export function compiledTransportControls(signal: AbortSignal) {
  return { signal, reportProgress: () => undefined };
}

export function remoteStructuredExecutor(input: {
  context: AgentRunWorkflowArgs;
  profile: ProductionExecuteInput['profile'];
  transport: ProductionExecuteInput['transport'];
  runnerArtifactImage: string;
}): (value: CodexStructuredInput, deps: CodexStructuredDeps) => Promise<CodexStructuredOutput> {
  return async (value, deps) => {
    const request: CompiledRuntimeTransportRequest = {
      schemaVersion: 1,
      compiledHash: value.compiledHash,
      messages: value.messages,
      outputSchema: value.outputSchema,
      sandboxMode: value.sandboxMode ?? 'workspace-write',
    };
    const result = await executeCompiledRuntimeTransport({
      context: input.context,
      request,
      profile: input.profile,
      transport: input.transport,
      runnerArtifactImage: input.runnerArtifactImage,
      controls: compiledTransportControls(value.signal ?? new AbortController().signal),
    });
    await replayStructuredTransportEvents(value, deps, result);
    return { nativeSessionId: result.nativeSessionId, result: result.result };
  };
}
