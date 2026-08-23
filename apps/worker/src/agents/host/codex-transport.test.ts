import { describe, expect, it, vi } from 'vitest';

import {
  CodexTransportCancelledError,
  executeCodexStructured,
  serializeCodexMessages,
  type CodexSdkLike,
} from './codex-transport';

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

const messages = [
  { role: 'system' as const, content: 'Use only granted resources.' },
  { role: 'user' as const, content: 'Produce the contracted result.' },
];

describe('generic Codex structured transport', () => {
  it('owns provider streaming, structured JSON, dispatch hashes, and generic progress', async () => {
    vi.stubEnv('WRITING_TEST_KEY', 'deployment-secret');
    const observedCommand = `wc -w out/article.md # ${'x'.repeat(600)}`;
    const client = sdk([
      { type: 'thread.started', thread_id: 'thread-7' },
      {
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: observedCommand },
      },
      {
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', status: 'completed', exit_code: 0 },
      },
      {
        type: 'item.completed',
        item: { id: 'change-1', type: 'file_change', changes: [{ path: 'out/article.md' }] },
      },
      {
        type: 'item.completed',
        item: { id: 'message-1', type: 'agent_message', text: '{"status":"completed"}' },
      },
      { type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 3 } },
    ]);
    const raw = vi.fn(async () => undefined);
    const progress = vi.fn(async () => undefined);
    const dispatched = vi.fn(async () => undefined);
    const createClient = vi.fn(() => client);

    const output = await executeCodexStructured(
      {
        runId: 'agent-run:7',
        messages,
        compiledHash: `sha256:${'7'.repeat(64)}`,
        outputSchema: {
          type: 'object',
          properties: { status: { type: 'string' } },
          required: ['status'],
          additionalProperties: false,
        },
        workingDirectory: '/tmp/document-workspace',
        profile: {
          providerId: 'codex',
          envAllowlist: ['PATH'],
          networkPolicy: 'none',
          maxTurns: 10,
          model: 'deployment-model',
          endpoint: 'https://provider.invalid/v1',
          apiKeyEnv: 'WRITING_TEST_KEY',
        },
      },
      {
        createClient,
        onRaw: raw,
        onProgress: progress,
        onPromptDispatched: dispatched,
      },
    );

    expect(output).toEqual({
      nativeSessionId: 'thread-7',
      result: { status: 'completed' },
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    expect(raw).toHaveBeenCalledTimes(6);
    expect(
      (progress.mock.calls as unknown as Array<[{ kind: string }]>).map(([event]) => event.kind),
    ).toEqual([
      'run-started',
      'command-started',
      'command-completed',
      'files-changed',
      'message-received',
      'provider-event',
    ]);
    expect(progress).toHaveBeenCalledWith({
      kind: 'command-started',
      commandId: 'cmd-1',
      summary: observedCommand,
    });
    expect(dispatched).toHaveBeenCalledWith({
      compiledHash: `sha256:${'7'.repeat(64)}`,
      sentPromptHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      messageCount: 2,
    });
    expect(vi.mocked(client.startThread)).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deployment-model',
        workingDirectory: '/tmp/document-workspace',
        skipGitRepoCheck: true,
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
        networkAccessEnabled: false,
      }),
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: expect.any(String),
        baseUrl: 'https://provider.invalid/v1',
        env: expect.any(Object),
      }),
    );
  });

  it('serializes provider-neutral messages identically to the T18 compatibility adapter', () => {
    expect(serializeCodexMessages(messages)).toContain(
      '<<<UI4A_COMPILED_MESSAGE_V1 role="system">>>',
    );
  });

  it('uses a server-owned read-only sandbox for structured-only specializations', async () => {
    const client = sdk([
      { type: 'thread.started', thread_id: 'thread-read-only' },
      {
        type: 'item.completed',
        item: { id: 'message', type: 'agent_message', text: '{"status":"completed"}' },
      },
    ]);
    await executeCodexStructured(
      {
        runId: 'agent-run:read-only',
        messages,
        compiledHash: `sha256:${'6'.repeat(64)}`,
        outputSchema: { type: 'object' },
        workingDirectory: '/tmp/structured-only',
        sandboxMode: 'read-only',
        profile: {
          providerId: 'codex',
          envAllowlist: ['PATH'],
          networkPolicy: 'none',
          maxTurns: 4,
        },
      },
      {
        createClient: () => client,
        onRaw: async () => undefined,
        onProgress: async () => undefined,
      },
    );
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: 'read-only', networkAccessEnabled: false }),
    );
  });

  it('resumes only the supplied thread and fails honestly on cancellation or malformed final JSON', async () => {
    const resumed = sdk([
      { type: 'item.completed', item: { type: 'agent_message', text: '{bad' } },
    ]);
    await expect(
      executeCodexStructured(
        {
          runId: 'agent-run:resume',
          messages,
          compiledHash: `sha256:${'8'.repeat(64)}`,
          outputSchema: { type: 'object' },
          workingDirectory: '/tmp/doc',
          nativeSessionId: 'thread-existing',
          profile: {
            providerId: 'codex',
            envAllowlist: ['PATH'],
            networkPolicy: 'none',
            maxTurns: 4,
          },
        },
        {
          createClient: () => resumed,
          onRaw: async () => undefined,
          onProgress: async () => undefined,
        },
      ),
    ).rejects.toThrow(/valid structured JSON/i);
    expect(resumed.startThread).not.toHaveBeenCalled();
    expect(resumed.resumeThread).toHaveBeenCalledWith('thread-existing', expect.any(Object));

    const controller = new AbortController();
    controller.abort();
    await expect(
      executeCodexStructured(
        {
          runId: 'agent-run:cancelled',
          messages,
          compiledHash: `sha256:${'9'.repeat(64)}`,
          outputSchema: { type: 'object' },
          workingDirectory: '/tmp/doc',
          signal: controller.signal,
          profile: {
            providerId: 'codex',
            envAllowlist: [],
            networkPolicy: 'none',
            maxTurns: 4,
          },
        },
        {
          createClient: () => sdk([]),
          onRaw: async () => undefined,
          onProgress: async () => undefined,
        },
      ),
    ).rejects.toBeInstanceOf(CodexTransportCancelledError);
  });
});
