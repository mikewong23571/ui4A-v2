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
