import { expect, it } from 'vitest';
import type { ChatTurn } from '@/chat/history';
import { convertMessage, replayTurnsToMessages } from '../chat-types';

it('restores failure metadata from failed outcome and typed steps, preserving exact audit text', () => {
  const raw = '{"provider":"missing session header"}';
  const turn: ChatTurn = {
    seq: 1,
    ts: '2026-09-07T00:00:00Z',
    sessionId: 's',
    turnId: 't',
    goal: { verb: '核对当前工作' },
    outcome: 'failed',
    status: 'final',
    summary: raw,
    driver: 'llm',
    userContextKnown: true,
    messages: [{ role: 'assistant', text: raw }],
    steps: [{ step: 1, rel: 'thread:t', op: { kind: 'fail', reason: raw }, outcome: 'failed' }],
  };
  const messages = replayTurnsToMessages([turn]);
  expect(messages[1]).toMatchObject({
    content: raw,
    failure: { code: 'driver_fail', evidence: [raw] },
  });
  expect(convertMessage(messages[1]!).metadata?.custom?.failure).toEqual(messages[1]!.failure);
  // Identical text in a successful answer is ordinary text, never classified by substrings.
  expect(
    replayTurnsToMessages([{ ...turn, outcome: 'done', steps: [] }])[1]?.failure,
  ).toBeUndefined();
  const partial = replayTurnsToMessages([
    {
      ...turn,
      messages: [{ role: 'assistant', text: '已执行 complete(task:a)' }, ...turn.messages],
      steps: [
        { step: 1, rel: 'task:a', op: { kind: 'exec', action: 'complete' }, outcome: 'executed' },
        ...turn.steps,
      ],
    },
  ]);
  expect(partial[1]).toEqual({ role: 'assistant', content: '已执行 complete(task:a)' });
  expect(partial[2]?.failure).toMatchObject({ tried: ['已执行 complete(task:a)'] });
});
