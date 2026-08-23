import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { Codex, type CodexOptions, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk';

export interface CodexThreadLike {
  readonly id: string | null;
  runStreamed(
    input: string,
    options?: { outputSchema?: unknown; signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<unknown> }>;
}

export interface CodexSdkLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike;
}

export interface CodexTransportMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CodexTransportProfile {
  providerId: string;
  envAllowlist: string[];
  networkPolicy: string;
  maxTurns: number;
  model?: string;
  endpoint?: string;
  /** Deployment env name containing the provider key; the task never supplies it. */
  apiKeyEnv?: string;
}

export interface CodexStructuredInput {
  runId: string;
  messages: CodexTransportMessage[];
  compiledHash: string;
  outputSchema: unknown;
  workingDirectory: string;
  /** Compatibility-only byte string for definitions born before typed Prompt messages existed. */
  serializedPrompt?: string;
  profile: CodexTransportProfile;
  nativeSessionId?: string;
  signal?: AbortSignal;
}

export type CodexTransportProgress =
  | { kind: 'run-started'; nativeSessionId: string }
  | { kind: 'command-started'; commandId: string; summary: string }
  | { kind: 'command-completed'; commandId: string; exitCode: number }
  | { kind: 'files-changed'; files: string[] }
  | { kind: 'message-received'; summary: string }
  | { kind: 'run-failed'; code: string; reason: string }
  | { kind: 'provider-event'; providerDetail: { type: string } };

export interface CodexPromptDispatchReceipt {
  compiledHash: string;
  sentPromptHash: string;
  messageCount: number;
}

export interface CodexStructuredOutput {
  nativeSessionId: string;
  result: unknown;
  usage?: unknown;
}

export interface CodexStructuredDeps {
  createClient?: (options: CodexOptions) => CodexSdkLike;
  onPromptDispatched?: (receipt: CodexPromptDispatchReceipt) => Promise<void>;
  onRaw(event: unknown, cursor: string): Promise<void>;
  onProgress(event: CodexTransportProgress): Promise<void>;
}

export interface CodexTransportProbe {
  available: boolean;
  version?: string;
  reason?: string;
}

export class CodexTransportCancelledError extends Error {
  constructor() {
    super('Codex transport cancelled by UI4A');
    this.name = 'CodexTransportCancelledError';
  }
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

const runFile = promisify(execFile);

/** Fast deployment-side binary/auth check. It never selects a fallback Provider. */
export async function probeCodexTransport(
  binary = process.env.UI4A_CODEX_BIN ?? 'codex',
  execute: typeof runFile = runFile,
): Promise<CodexTransportProbe> {
  try {
    const version = (await execute(binary, ['--version'], { timeout: 5_000 })).stdout.trim();
    await execute(binary, ['login', 'status'], { timeout: 5_000 });
    return { available: true, version };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function controlledEnvironment(profile: CodexTransportProfile): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
  };
  for (const name of profile.envAllowlist) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/** Deterministic projection for SDK transports that accept one string rather than role messages. */
export function serializeCodexMessages(messages: CodexTransportMessage[]): string {
  return messages
    .flatMap((message, index) => [
      `<<<UI4A_COMPILED_MESSAGE_V1 role=${JSON.stringify(message.role)}>>>`,
      message.content,
      '<<<END_UI4A_COMPILED_MESSAGE_V1>>>',
      ...(index === messages.length - 1 ? [] : ['']),
    ])
    .join('\n');
}

function parseStructuredResult(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Codex final response is not valid structured JSON');
  }
}

/** Execute or resume a schema-constrained Codex turn without specialization-specific semantics. */
export async function executeCodexStructured(
  input: CodexStructuredInput,
  deps: CodexStructuredDeps,
): Promise<CodexStructuredOutput> {
  if (input.profile.providerId !== 'codex') throw new Error('transport profile is not Codex');
  if (input.messages.length === 0) throw new Error('Codex transport requires compiled messages');
  if (aborted(input.signal)) throw new CodexTransportCancelledError();
  const clientFactory = deps.createClient ?? ((options) => new Codex(options));
  const apiKey =
    input.profile.apiKeyEnv === undefined ? undefined : process.env[input.profile.apiKeyEnv];
  if (input.profile.apiKeyEnv !== undefined && (apiKey === undefined || apiKey === '')) {
    throw new Error(`Codex transport credential ${input.profile.apiKeyEnv} is unavailable`);
  }
  const client = clientFactory({
    env: controlledEnvironment(input.profile),
    ...(input.profile.endpoint === undefined ? {} : { baseUrl: input.profile.endpoint }),
    ...(apiKey === undefined ? {} : { apiKey }),
    config: {
      max_turns: input.profile.maxTurns,
      web_search: input.profile.networkPolicy === 'none' ? 'disabled' : 'live',
    },
  });
  const threadOptions: ThreadOptions = {
    ...(input.profile.model === undefined ? {} : { model: input.profile.model }),
    workingDirectory: input.workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    networkAccessEnabled: input.profile.networkPolicy !== 'none',
  };
  const thread =
    input.nativeSessionId === undefined
      ? client.startThread(threadOptions)
      : client.resumeThread(input.nativeSessionId, threadOptions);
  const dispatchedPrompt = input.serializedPrompt ?? serializeCodexMessages(input.messages);
  await deps.onPromptDispatched?.({
    compiledHash: input.compiledHash,
    sentPromptHash: `sha256:${createHash('sha256').update(dispatchedPrompt).digest('hex')}`,
    messageCount: input.messages.length,
  });
  let nativeSessionId = input.nativeSessionId;
  let result: unknown;
  let usage: unknown;
  try {
    const streamed = await thread.runStreamed(dispatchedPrompt, {
      outputSchema: input.outputSchema,
      signal: input.signal,
    });
    let cursor = 0;
    for await (const unknownEvent of streamed.events) {
      cursor += 1;
      await deps.onRaw(unknownEvent, `${cursor}`);
      const event = unknownEvent as ThreadEvent;
      if (event.type === 'thread.started') {
        nativeSessionId = event.thread_id;
        await deps.onProgress({ kind: 'run-started', nativeSessionId });
      } else if (event.type === 'item.started' && event.item.type === 'command_execution') {
        await deps.onProgress({
          kind: 'command-started',
          commandId: event.item.id,
          summary: event.item.command.slice(0, 500),
        });
      } else if (event.type === 'item.completed' && event.item.type === 'command_execution') {
        await deps.onProgress({
          kind: 'command-completed',
          commandId: event.item.id,
          exitCode: event.item.exit_code ?? (event.item.status === 'completed' ? 0 : 1),
        });
      } else if (event.type === 'item.completed' && event.item.type === 'file_change') {
        await deps.onProgress({
          kind: 'files-changed',
          files: event.item.changes.map((change) => change.path),
        });
      } else if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        result = parseStructuredResult(event.item.text);
        await deps.onProgress({ kind: 'message-received', summary: event.item.text.slice(0, 500) });
      } else if (event.type === 'turn.failed') {
        await deps.onProgress({
          kind: 'run-failed',
          code: 'provider-turn-failed',
          reason: event.error.message,
        });
        throw new Error(event.error.message);
      } else if (event.type === 'error') {
        await deps.onProgress({
          kind: 'run-failed',
          code: 'provider-stream-error',
          reason: event.message,
        });
        throw new Error(event.message);
      } else {
        if (event.type === 'turn.completed') usage = event.usage;
        await deps.onProgress({ kind: 'provider-event', providerDetail: { type: event.type } });
      }
    }
  } catch (error) {
    if (aborted(input.signal)) throw new CodexTransportCancelledError();
    throw error;
  }
  nativeSessionId ??= thread.id ?? undefined;
  if (nativeSessionId === undefined) throw new Error('Codex stream did not provide a thread id');
  if (result === undefined)
    throw new Error('Codex stream did not provide a structured final result');
  return { nativeSessionId, result, ...(usage === undefined ? {} : { usage }) };
}
