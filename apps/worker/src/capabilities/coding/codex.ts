import type { CodexOptions } from '@openai/codex-sdk';

import type {
  CodingExecutorDescriptor,
  CodingExecutorProfile,
  CodingNormalizedEvent,
  CodingTask,
} from '@ui4a/shared';

import {
  CodexTransportCancelledError,
  executeCodexStructured,
  probeCodexTransport,
  serializeCodexMessages,
  type CodexPromptDispatchReceipt as HostCodexPromptDispatchReceipt,
  type CodexSdkLike,
  type CodexTransportProgress,
} from '../../agents/host/codex-transport';

export type { CodexSdkLike } from '../../agents/host/codex-transport';

export interface CodexTaskClaim {
  status: 'completed' | 'failed';
  summary: string;
  tests: string[];
  changedFiles: string[];
}

export interface CodexExecutionOutput {
  nativeSessionId: string;
  claim: CodexTaskClaim;
  usage?: unknown;
}

/** Server-compiled, provider-neutral Prompt supplied by a versioned Agent Definition. */
export interface CodexCompiledPrompt {
  compiledHash: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

export type CodexPromptDispatchReceipt = HostCodexPromptDispatchReceipt;

export interface CodexExecutionInput {
  runId: string;
  task: CodingTask;
  profile: CodingExecutorProfile;
  workspace: { id: string; path: string };
  /** Optional T19 specialization Prompt. Omission preserves the T18 Prompt byte-for-byte. */
  compiledPrompt?: CodexCompiledPrompt;
  nativeSessionId?: string;
  signal?: AbortSignal;
}

export interface CodexExecutionDeps {
  createClient?: (options: CodexOptions) => CodexSdkLike;
  onPromptDispatched?: (receipt: CodexPromptDispatchReceipt) => Promise<void>;
  onRaw: (event: unknown, cursor: string) => Promise<void>;
  onNormalized: (event: CodingNormalizedEvent) => Promise<void>;
}

export class CodingExecutorCancelledError extends Error {
  constructor() {
    super('coding executor cancelled by UI4A');
    this.name = 'CodingExecutorCancelledError';
  }
}

/** Provider/auth preflight backed by the shared Codex transport probe. */
export async function probeCodexExecutor(
  profileName: string,
  binary = process.env.UI4A_CODEX_BIN ?? 'codex',
  execute?: Parameters<typeof probeCodexTransport>[1],
): Promise<CodingExecutorDescriptor> {
  const probe = await probeCodexTransport(binary, execute);
  return {
    schemaVersion: 1,
    profileName,
    available: probe.available,
    taskSchemaVersions: [1],
    features: probe.available ? ['resume', 'structured-events', 'workspace-write', 'cancel'] : [],
    ...(probe.version === undefined ? {} : { version: probe.version }),
    ...(probe.reason === undefined ? {} : { reason: probe.reason }),
  };
}

function promptFor(task: CodingTask): string {
  return [
    'Complete the following authorized coding task inside the current workspace.',
    `Goal: ${task.goal}`,
    `Constraints:\n${task.constraints.map((value) => `- ${value}`).join('\n') || '- none'}`,
    `Acceptance criteria:\n${task.acceptanceCriteria.map((value) => `- ${value}`).join('\n')}`,
    `Allowed paths:\n${task.allowedPaths.map((value) => `- ${value}`).join('\n') || '- all workspace paths'}`,
    'Do not push, merge, deploy, change another checkout, or approve the result.',
    'Run the relevant tests and return the required structured result.',
  ].join('\n\n');
}

/** Stable alias retained for T18 callers and evidence. */
export function serializeCodexCompiledPrompt(prompt: CodexCompiledPrompt): string {
  return serializeCodexMessages(prompt.messages);
}

const CLAIM_SCHEMA = {
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

function parseClaim(value: unknown): CodexTaskClaim {
  const candidate = value as Partial<CodexTaskClaim> | null;
  if (
    candidate === null ||
    (candidate.status !== 'completed' && candidate.status !== 'failed') ||
    typeof candidate.summary !== 'string' ||
    !Array.isArray(candidate.tests) ||
    !candidate.tests.every((item) => typeof item === 'string') ||
    !Array.isArray(candidate.changedFiles) ||
    !candidate.changedFiles.every((item) => typeof item === 'string')
  ) {
    throw new Error('Codex final response does not match the coding result claim schema');
  }
  return value as CodexTaskClaim;
}

type CodingNormalizedPayload = CodingNormalizedEvent extends infer Event
  ? Event extends CodingNormalizedEvent
    ? Omit<Event, 'schemaVersion' | 'eventId' | 'runId' | 'sequence'>
    : never
  : never;

function normalizedPayload(event: CodexTransportProgress): CodingNormalizedPayload {
  switch (event.kind) {
    case 'run-started':
      return { kind: 'run-started', nativeSessionId: event.nativeSessionId };
    case 'command-started':
      return { kind: 'command-started', commandId: event.commandId, summary: event.summary };
    case 'command-completed':
      return { kind: 'command-completed', commandId: event.commandId, exitCode: event.exitCode };
    case 'files-changed':
      return { kind: 'files-changed', files: event.files };
    case 'message-received': {
      let summary = event.summary;
      try {
        const value = JSON.parse(event.summary) as { summary?: unknown };
        if (typeof value.summary === 'string') summary = value.summary;
      } catch {
        // Progress text is non-authoritative; the transport already parsed the final result.
      }
      return { kind: 'progress-reported', message: summary };
    }
    case 'run-failed':
      return { kind: 'run-failed', code: event.code, reason: event.reason };
    case 'provider-event':
      return { kind: 'provider-event', providerDetail: event.providerDetail };
  }
}

function eventId(runId: string, sequence: number): string {
  return `${runId}:normalized:${sequence}`;
}

/** Coding specialization wrapper over the shared streamed/structured Codex transport. */
export async function executeCodexTask(
  input: CodexExecutionInput,
  deps: CodexExecutionDeps,
): Promise<CodexExecutionOutput> {
  if (input.profile.providerId !== 'codex') throw new Error('executor profile is not Codex');
  if (input.profile.sandbox !== 'workspace-write') {
    throw new Error('Codex coding executor requires the server-owned workspace-write sandbox');
  }
  const compiledPrompt = input.compiledPrompt;
  const messages = compiledPrompt?.messages ?? [
    { role: 'user' as const, content: promptFor(input.task) },
  ];
  let sequence = 0;
  try {
    const output = await executeCodexStructured(
      {
        runId: input.runId,
        messages,
        compiledHash: compiledPrompt?.compiledHash ?? 'legacy:t18',
        outputSchema: CLAIM_SCHEMA,
        workingDirectory: input.workspace.path,
        ...(compiledPrompt === undefined ? { serializedPrompt: promptFor(input.task) } : {}),
        profile: {
          providerId: input.profile.providerId,
          envAllowlist: input.profile.envAllowlist,
          networkPolicy: input.profile.networkPolicy,
          maxTurns: input.profile.maxTurns ?? input.task.budget.maxTurns,
        },
        ...(input.nativeSessionId === undefined ? {} : { nativeSessionId: input.nativeSessionId }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      {
        ...(deps.createClient === undefined ? {} : { createClient: deps.createClient }),
        ...(compiledPrompt === undefined || deps.onPromptDispatched === undefined
          ? {}
          : { onPromptDispatched: deps.onPromptDispatched }),
        onRaw: deps.onRaw,
        onProgress: async (progress) => {
          sequence += 1;
          await deps.onNormalized({
            ...normalizedPayload(progress),
            schemaVersion: 1,
            eventId: eventId(input.runId, sequence),
            runId: input.runId,
            sequence,
          } as CodingNormalizedEvent);
        },
      },
    );
    return {
      nativeSessionId: output.nativeSessionId,
      claim: parseClaim(output.result),
      ...(output.usage === undefined ? {} : { usage: output.usage }),
    };
  } catch (error) {
    if (error instanceof CodexTransportCancelledError) throw new CodingExecutorCancelledError();
    throw error;
  }
}
