import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIdleTimeout, readChatSseStream, type ChatSseFrame } from './sse';

afterEach(() => {
  vi.useRealTimers();
});

describe('step 帧结构化活动数据(T24 Phase B)', () => {
  it('新形状(activity + eventSeq)与旧形状(无 activity)同流解析,前向兼容', async () => {
    const encoder = new TextEncoder();
    const expected: ChatSseFrame[] = [
      {
        type: 'step',
        turnId: 'turn-act',
        message: { role: 'assistant', text: '导航到 articles' },
        rel: 'articles',
        activity: { op: 'navigate', title: '文章列表' },
        eventSeq: 42,
      },
      {
        type: 'step',
        turnId: 'turn-act',
        message: { role: 'assistant', text: '执行 next(article-drafting:main)' },
        rel: 'article-drafting:main',
        activity: { op: 'exec', title: '下一步' },
      },
      // 旧服务端形状:无 activity/eventSeq 字段,客户端回退 message.text 中性显示。
      { type: 'step', turnId: 'turn-act', message: { role: 'assistant', text: '完成: 目标完成' } },
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
    const first = frames[0]!;
    if (first.type === 'step') {
      expect(first.activity).toEqual({ op: 'navigate', title: '文章列表' });
      expect(first.eventSeq).toBe(42);
    } else {
      throw new Error('首帧应为 step');
    }
    const oldShape = frames[2]!;
    if (oldShape.type === 'step') {
      expect(oldShape.activity).toBeUndefined();
      expect(oldShape.eventSeq).toBeUndefined();
    } else {
      throw new Error('末帧应为 step');
    }
  });
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
