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

describe('final/error 帧结构化失败 reason(T24 Phase B Task 3)', () => {
  it('final 帧携带 reason{code,evidence,tried,phrasing}:新形状解析完整,旧形状无 reason 兼容', async () => {
    const encoder = new TextEncoder();
    const expected: ChatSseFrame[] = [
      { type: 'step', turnId: 't-fail', message: { role: 'assistant', text: '导航到 articles' } },
      {
        type: 'final',
        turnId: 't-fail',
        payload: {
          sessionId: 'sess-fail',
          turnId: 't-fail',
          driver: 'llm',
          requestedDriver: 'auto',
          outcome: 'failed',
          summary: '检测到无进展导航循环;当前合同未暴露完成目标所需的可执行能力',
          reason: {
            code: 'no_progress_loop',
            evidence: ['重复处境:articles', '可用动作:(无)', '已成功执行:0'],
            tried: ['导航到 articles'],
            phrasing: '当前页面没有提供完成这个目标所需的操作入口。',
          },
          steps: [],
          successes: [],
        },
      },
      // 旧服务端形状:final 无 reason(客户端回退 summary 中性呈现)。
      {
        type: 'final',
        turnId: 't-fail-old',
        payload: {
          sessionId: 'sess-fail-old',
          turnId: 't-fail-old',
          driver: 'llm',
          requestedDriver: 'auto',
          outcome: 'failed',
          summary: '旧机器句子',
          steps: [],
          successes: [],
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
    const finalFrame = frames[1]!;
    if (finalFrame.type !== 'final') throw new Error('应为 final 帧');
    expect(finalFrame.payload.reason).toEqual({
      code: 'no_progress_loop',
      evidence: ['重复处境:articles', '可用动作:(无)', '已成功执行:0'],
      tried: ['导航到 articles'],
      phrasing: '当前页面没有提供完成这个目标所需的操作入口。',
    });
    const oldFinal = frames[2]!;
    if (oldFinal.type !== 'final') throw new Error('应为 final 帧');
    expect(oldFinal.payload.reason).toBeUndefined();
  });

  it('error 帧可携带 reason(结构化兜底);旧形状无 reason 兼容', async () => {
    const encoder = new TextEncoder();
    const expected: ChatSseFrame[] = [
      {
        type: 'error',
        error: '聊天循环异常: 爆炸',
        reason: { code: 'loop_exception', evidence: ['聊天循环异常: 爆炸'] },
      },
      { type: 'error', error: '旧形状错误' },
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
