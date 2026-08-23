import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Codex, type CodexOptions, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk';

import type {
  CodingExecutorDescriptor,
  CodingExecutorProfile,
  CodingNormalizedEvent,
  CodingTask,
} from '@ui4a/shared';

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

export interface CodexExecutionInput {
  runId: string;
  task: CodingTask;
  profile: CodingExecutorProfile;
  workspace: { id: string; path: string };
  nativeSessionId?: string;
  signal?: AbortSignal;
}

export interface CodexExecutionDeps {
  createClient?: (options: CodexOptions) => CodexSdkLike;
  onRaw: (event: unknown, cursor: string) => Promise<void>;
  onNormalized: (event: CodingNormalizedEvent) => Promise<void>;
}

export class CodingExecutorCancelledError extends Error {
  constructor() {
    super('coding executor cancelled by UI4A');
    this.name = 'CodingExecutorCancelledError';
  }
}

const runFile = promisify(execFile);

/** Fast Provider/auth preflight. An unavailable selected profile never falls back. */
export async function probeCodexExecutor(
  profileName: string,
  binary = process.env.UI4A_CODEX_BIN ?? 'codex',
  execute: typeof runFile = runFile,
): Promise<CodingExecutorDescriptor> {
  try {
    const version = (await execute(binary, ['--version'], { timeout: 5_000 })).stdout.trim();
    await execute(binary, ['login', 'status'], { timeout: 5_000 });
    return {
      schemaVersion: 1,
      profileName,
      available: true,
      taskSchemaVersions: [1],
      features: ['resume', 'structured-events', 'workspace-write', 'cancel'],
      version,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      profileName,
      available: false,
      taskSchemaVersions: [1],
      features: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function controlledEnvironment(profile: CodingExecutorProfile): Record<string, string> {
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

function parseClaim(text: string): CodexTaskClaim {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Codex final response is not valid structured JSON');
  }
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

function eventId(runId: string, sequence: number): string {
  return `${runId}:normalized:${sequence}`;
}

/** Execute or resume one Codex thread and map its provider stream to UI4A normalized events. */
export async function executeCodexTask(
  input: CodexExecutionInput,
  deps: CodexExecutionDeps,
): Promise<CodexExecutionOutput> {
  if (input.profile.providerId !== 'codex') throw new Error('executor profile is not Codex');
  if (input.profile.sandbox !== 'workspace-write') {
    throw new Error('Codex coding executor requires the server-owned workspace-write sandbox');
  }
  if (input.signal?.aborted === true) throw new CodingExecutorCancelledError();
  const clientFactory = deps.createClient ?? ((options) => new Codex(options));
  const client = clientFactory({
    env: controlledEnvironment(input.profile),
    config: {
      max_turns: input.profile.maxTurns ?? input.task.budget.maxTurns,
      web_search: input.profile.networkPolicy === 'none' ? 'disabled' : 'live',
    },
  });
  const threadOptions: ThreadOptions = {
    workingDirectory: input.workspace.path,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    networkAccessEnabled: input.profile.networkPolicy !== 'none',
  };
  const thread =
    input.nativeSessionId === undefined
      ? client.startThread(threadOptions)
      : client.resumeThread(input.nativeSessionId, threadOptions);
  let sequence = 0;
  let nativeSessionId = input.nativeSessionId;
  let claim: CodexTaskClaim | undefined;
  let usage: unknown;
  const emit = async (value: CodingNormalizedPayload): Promise<void> => {
    sequence += 1;
    await deps.onNormalized({
      ...value,
      schemaVersion: 1,
      eventId: eventId(input.runId, sequence),
      runId: input.runId,
      sequence,
    } as CodingNormalizedEvent);
  };
  try {
    const streamed = await thread.runStreamed(promptFor(input.task), {
      outputSchema: CLAIM_SCHEMA,
      signal: input.signal,
    });
    let rawSequence = 0;
    for await (const unknownEvent of streamed.events) {
      rawSequence += 1;
      await deps.onRaw(unknownEvent, `${rawSequence}`);
      const event = unknownEvent as ThreadEvent;
      if (event.type === 'thread.started') {
        nativeSessionId = event.thread_id;
        await emit({ kind: 'run-started', nativeSessionId });
      } else if (event.type === 'item.started' && event.item.type === 'command_execution') {
        await emit({
          kind: 'command-started',
          commandId: event.item.id,
          summary: event.item.command.slice(0, 500),
        });
      } else if (event.type === 'item.completed' && event.item.type === 'command_execution') {
        await emit({
          kind: 'command-completed',
          commandId: event.item.id,
          exitCode: event.item.exit_code ?? (event.item.status === 'completed' ? 0 : 1),
        });
      } else if (event.type === 'item.completed' && event.item.type === 'file_change') {
        await emit({
          kind: 'files-changed',
          files: event.item.changes.map((change) => change.path),
        });
      } else if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        claim = parseClaim(event.item.text);
        await emit({ kind: 'progress-reported', message: claim.summary });
      } else if (event.type === 'turn.failed') {
        await emit({
          kind: 'run-failed',
          code: 'provider-turn-failed',
          reason: event.error.message,
        });
        throw new Error(event.error.message);
      } else if (event.type === 'error') {
        await emit({ kind: 'run-failed', code: 'provider-stream-error', reason: event.message });
        throw new Error(event.message);
      } else {
        if (event.type === 'turn.completed') usage = event.usage;
        await emit({ kind: 'provider-event', providerDetail: { type: event.type } });
      }
    }
  } catch (error) {
    if (input.signal !== undefined && input.signal.aborted) {
      throw new CodingExecutorCancelledError();
    }
    throw error;
  }
  nativeSessionId ??= thread.id ?? undefined;
  if (nativeSessionId === undefined) throw new Error('Codex stream did not provide a thread id');
  if (claim === undefined)
    throw new Error('Codex stream did not provide a validated final result claim');
  return { nativeSessionId, claim, ...(usage === undefined ? {} : { usage }) };
}
