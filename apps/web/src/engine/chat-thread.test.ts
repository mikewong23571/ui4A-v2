import { describe, expect, it, vi } from 'vitest';

import { executeThreadCommand, type ExecRequest } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import { attachChatMessageToThread } from './chat-thread';

function snapshot(): EngineSnapshot {
  return {
    instances: {},
    collections: {},
    threads: {
      mine: {
        id: 'mine',
        owner: 'user:mike',
        goal: { text: 'Mine', source: 'message:goal' },
        status: 'open',
        references: { context: [], active: [], approval: [], event: [] },
        recentEventSeqs: [],
      },
      theirs: {
        id: 'theirs',
        owner: 'user:other',
        goal: { text: 'Theirs', source: 'message:goal' },
        status: 'open',
        references: { context: [], active: [], approval: [], event: [] },
        recentEventSeqs: [],
      },
    },
  };
}

it.each(['mine', 'thread:mine'])(
  'normalizes %s and explicitly attaches only the user message',
  async (anchor) => {
    let state = snapshot();
    const events: unknown[] = [];
    const engine = {
      getSnapshot: () => state,
      readSnapshot: async () => state,
      exec: vi.fn(async (request: ExecRequest) => {
        const outcome = executeThreadCommand(request, state);
        if (outcome.kind === 'accepted') {
          state = outcome.snapshot;
          events.push(outcome.event);
          return { kind: 'accepted' as const, entity: {} as never, appended: [] };
        }
        return outcome;
      }),
    };

    await expect(
      attachChatMessageToThread(engine, {
        thread: anchor,
        principal: 'user:mike',
        messageId: 'turn-1',
      }),
    ).resolves.toBe('attached');
    expect(engine.exec).toHaveBeenCalledWith({
      rel: 'thread:mine',
      action: 'attach',
      actor: 'human',
      principal: 'user:mike',
      channel: 'chat-presence',
      params: { category: 'context', rel: 'message:turn-1' },
    });
    expect(state.threads?.mine?.references.context).toEqual(['message:turn-1']);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'thread-reference-attached',
        detail: expect.objectContaining({ source: 'presence' }),
      }),
    ]);
  },
);

describe('chat thread anchor fail-closed behavior', () => {
  it.each([null, 'missing', 'thread:theirs'])(
    'skips absent, stale, or other-owner anchor %s',
    async (thread) => {
      const engine = { getSnapshot: snapshot, readSnapshot: async () => snapshot(), exec: vi.fn() };
      await expect(
        attachChatMessageToThread(engine, {
          thread,
          principal: 'user:mike',
          messageId: 'turn-1',
        }),
      ).resolves.toBe('skipped');
      expect(engine.exec).not.toHaveBeenCalled();
    },
  );

  it('does not fail chat when the normal exec path rejects or throws', async () => {
    const rejected = {
      getSnapshot: snapshot,
      readSnapshot: async () => snapshot(),
      exec: vi.fn(async () => ({
        kind: 'rejected' as const,
        layer: 'guard-failed' as const,
        reason: 'stale',
      })),
    };
    await expect(
      attachChatMessageToThread(rejected, {
        thread: 'mine',
        principal: 'user:mike',
        messageId: 'turn-1',
      }),
    ).resolves.toBe('skipped');

    const failed = {
      getSnapshot: snapshot,
      readSnapshot: async () => snapshot(),
      exec: vi.fn(async () => Promise.reject(new Error('db'))),
    };
    await expect(
      attachChatMessageToThread(failed, {
        thread: 'mine',
        principal: 'user:mike',
        messageId: 'turn-1',
      }),
    ).resolves.toBe('skipped');
  });

  it('logs one structured diagnostic when readSnapshot or exec throws, and still skips', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const brokenRead = {
        getSnapshot: snapshot,
        readSnapshot: async () => {
          throw new Error('connection refused');
        },
        exec: vi.fn(),
      };
      await expect(
        attachChatMessageToThread(brokenRead, {
          thread: 'mine',
          principal: 'user:mike',
          messageId: 'turn-9',
        }),
      ).resolves.toBe('skipped');
      expect(warn).toHaveBeenCalledTimes(1);
      const readEntry = String(warn.mock.calls[0]?.[0]);
      expect(readEntry).toContain('[ui4a]');
      expect(readEntry).toContain('turn-9');
      expect(readEntry).toContain('thread=mine');
      expect(readEntry).toContain('connection refused');

      const failedExec = {
        getSnapshot: snapshot,
        readSnapshot: async () => snapshot(),
        exec: vi.fn(async () => Promise.reject(new Error('db unavailable'))),
      };
      await expect(
        attachChatMessageToThread(failedExec, {
          thread: 'mine',
          principal: 'user:mike',
          messageId: 'turn-10',
        }),
      ).resolves.toBe('skipped');
      expect(warn).toHaveBeenCalledTimes(2);
      const execEntry = String(warn.mock.calls[1]?.[0]);
      expect(execEntry).toContain('[ui4a]');
      expect(execEntry).toContain('turn-10');
      expect(execEntry).toContain('db unavailable');
    } finally {
      warn.mockRestore();
    }
  });

  it('stays silent on ordinary skip paths and rejections without a thrown error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        attachChatMessageToThread(
          { getSnapshot: snapshot, readSnapshot: async () => snapshot(), exec: vi.fn() },
          { thread: null, principal: 'user:mike', messageId: 'turn-1' },
        ),
      ).resolves.toBe('skipped');
      // 非 owner anchor 在 try 内正常返回 skipped,不是异常,不产生日志。
      await expect(
        attachChatMessageToThread(
          { getSnapshot: snapshot, readSnapshot: async () => snapshot(), exec: vi.fn() },
          { thread: 'theirs', principal: 'user:mike', messageId: 'turn-1' },
        ),
      ).resolves.toBe('skipped');
      // 裁决拒绝(kind!=='accepted')同样保持静默语义。
      const rejected = {
        getSnapshot: snapshot,
        readSnapshot: async () => snapshot(),
        exec: vi.fn(async () => ({
          kind: 'rejected' as const,
          layer: 'guard-failed' as const,
          reason: 'stale',
        })),
      };
      await expect(
        attachChatMessageToThread(rejected, {
          thread: 'mine',
          principal: 'user:mike',
          messageId: 'turn-1',
        }),
      ).resolves.toBe('skipped');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('uses refreshed state when the synchronous snapshot is stale', async () => {
    const fresh = snapshot();
    const engine = {
      getSnapshot: () => ({ instances: {}, collections: {}, threads: {} }) as EngineSnapshot,
      readSnapshot: vi.fn(async () => fresh),
      exec: vi.fn(async () => ({ kind: 'accepted' as const })),
    };
    await expect(
      attachChatMessageToThread(engine, {
        thread: 'mine',
        principal: 'user:mike',
        messageId: 'turn-late',
      }),
    ).resolves.toBe('attached');
    expect(engine.readSnapshot).toHaveBeenCalledOnce();
    expect(engine.exec).toHaveBeenCalledOnce();
  });
});
