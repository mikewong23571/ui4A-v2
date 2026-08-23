import { describe, expect, it, vi } from 'vitest';

import type { CodingExecutorProfile, CodingNormalizedEvent, CodingTask } from '@ui4a/shared';

import { executeCodexTask, type CodexSdkLike } from './codex';

const task: CodingTask = {
  schemaVersion: 1,
  repositoryRef: 'repo:fixture',
  baseRevision: 'a'.repeat(40),
  goal: 'implement sum',
  constraints: ['small change'],
  acceptanceCriteria: ['tests pass'],
  allowedPaths: ['src', 'test'],
  budget: {
    timeoutSeconds: 300,
    maxTurns: 20,
    maxRawEvents: 2_000,
    maxRawBytes: 4 * 1024 * 1024,
    maxRawChunkBytes: 64 * 1024,
  },
  redaction: { secretNames: [], redactHostPaths: true },
};

const profile: CodingExecutorProfile = {
  name: 'default',
  executorClass: 'coding-agent',
  providerId: 'codex',
  transport: 'sdk',
  workspaceBackend: 'isolated-worktree',
  sandbox: 'workspace-write',
  timeoutSeconds: 300,
  maxTurns: 20,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};

function sdk(events: unknown[], threadId = 'thread-1'): CodexSdkLike {
  const thread = {
    id: null as string | null,
    runStreamed: vi.fn(async () => ({
      events: (async function* () {
        for (const event of events) {
          if ((event as { type?: string }).type === 'thread.started') thread.id = threadId;
          yield event;
        }
      })(),
    })),
  };
  return {
    startThread: vi.fn(() => thread),
    resumeThread: vi.fn(() => ({ ...thread, id: threadId })),
  };
}

describe('Codex reference executor adapter', () => {
  it('normalizes typed SDK events and validates the final provider claim', async () => {
    const client = sdk([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'pnpm test',
          aggregated_output: '',
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'pnpm test',
          aggregated_output: 'ok',
          exit_code: 0,
          status: 'completed',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'patch-1',
          type: 'file_change',
          changes: [{ path: 'src/sum.ts', kind: 'add' }],
          status: 'completed',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: JSON.stringify({
            status: 'completed',
            summary: 'done',
            tests: ['pnpm test'],
            changedFiles: ['src/sum.ts'],
          }),
        },
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 2,
          reasoning_output_tokens: 1,
        },
      },
    ]);
    const normalized: CodingNormalizedEvent[] = [];
    const raw: unknown[] = [];
    const output = await executeCodexTask(
      { runId: 'run-1', task, profile, workspace: { id: 'w1', path: '/tmp/worktree' } },
      {
        createClient: () => client,
        onRaw: async (event) => void raw.push(event),
        onNormalized: async (event) => void normalized.push(event),
      },
    );
    expect(output).toMatchObject({ nativeSessionId: 'thread-1', claim: { status: 'completed' } });
    expect(normalized.map((event) => event.kind)).toEqual([
      'run-started',
      'provider-event',
      'command-started',
      'command-completed',
      'files-changed',
      'progress-reported',
      'provider-event',
    ]);
    expect(raw).toHaveLength(7);
  });

  it('resumes the exact native session and fails without fallback', async () => {
    const client = sdk(
      [{ type: 'turn.failed', error: { message: '401 unauthorized' } }],
      'thread-old',
    );
    await expect(
      executeCodexTask(
        {
          runId: 'run-2',
          task,
          profile,
          workspace: { id: 'w2', path: '/tmp/worktree' },
          nativeSessionId: 'thread-old',
        },
        {
          createClient: () => client,
          onRaw: async () => undefined,
          onNormalized: async () => undefined,
        },
      ),
    ).rejects.toThrow('401 unauthorized');
    expect(client.resumeThread).toHaveBeenCalledWith('thread-old', expect.any(Object));
    expect(client.startThread).not.toHaveBeenCalled();
  });

  it('synthesizes cancellation from UI4A intent and rejects unsafe profiles', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeCodexTask(
        {
          runId: 'run-3',
          task,
          profile,
          workspace: { id: 'w3', path: '/tmp/worktree' },
          signal: controller.signal,
        },
        {
          createClient: () => sdk([]),
          onRaw: async () => undefined,
          onNormalized: async () => undefined,
        },
      ),
    ).rejects.toMatchObject({ name: 'CodingExecutorCancelledError' });
    await expect(
      executeCodexTask(
        {
          runId: 'run-4',
          task,
          profile: { ...profile, sandbox: 'danger-full-access' as never },
          workspace: { id: 'w4', path: '/tmp/worktree' },
        },
        {
          createClient: () => sdk([]),
          onRaw: async () => undefined,
          onNormalized: async () => undefined,
        },
      ),
    ).rejects.toThrow('sandbox');
  });
});
