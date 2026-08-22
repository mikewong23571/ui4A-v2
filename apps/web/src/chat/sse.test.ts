import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIdleTimeout, readChatSseStream, type ChatSseFrame } from './sse';

afterEach(() => {
  vi.useRealTimers();
});

describe('SSE 空闲超时', () => {
  it('保留同 step 的跨回合 identity 与 render 回执 turnId', async () => {
    const encoder = new TextEncoder();
    const expected: ChatSseFrame[] = [
      { type: 'thinking', turnId: 'turn-a', step: 1, text: 'A' },
      { type: 'thinking', turnId: 'turn-b', step: 1, text: 'B' },
      {
        type: 'render',
        turnId: 'turn-b',
        payload: {
          sessionId: 'session-1',
          turnId: 'turn-b',
          driver: 'llm',
          requestedDriver: 'auto',
          outcome: 'done',
          summary: 'ready',
          messages: [],
          steps: [],
          successes: [],
          render: {
            concern: 'articles',
            spec: {},
            frozenNow: true,
            canvasUrl: '/canvas?concern=articles',
          },
        },
      },
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of expected) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        }
        controller.close();
      },
    });
    const frames: ChatSseFrame[] = [];

    await readChatSseStream(body, new AbortController().signal, (frame) => frames.push(frame));

    expect(frames).toEqual(expected);
  });

  it('持续 touch 可让总时长超过阈值而不中止，真正空闲才 TimeoutError', () => {
    vi.useFakeTimers();
    const idle = createIdleTimeout(120_000);

    vi.advanceTimersByTime(100_000);
    idle.touch();
    vi.advanceTimersByTime(100_000);
    idle.touch();
    expect(idle.signal.aborted).toBe(false);

    vi.advanceTimersByTime(120_000);
    expect(idle.signal.aborted).toBe(true);
    expect((idle.signal.reason as Error).name).toBe('TimeoutError');
    idle.dispose();
  });

  it('heartbeat 是合法帧且可被读取器消费，不产生协议错误', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'));
        controller.close();
      },
    });
    const frames: ChatSseFrame[] = [];
    await readChatSseStream(body, new AbortController().signal, (frame) => frames.push(frame));
    expect(frames).toEqual([{ type: 'heartbeat' }]);
  });
});
