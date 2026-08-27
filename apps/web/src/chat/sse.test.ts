import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIdleTimeout, readChatSseStream, type ChatSseFrame } from './sse';

afterEach(() => {
  vi.useRealTimers();
});

describe('step 帧结构化活动数据(T24 Phase B)', () => {
  it('轨迹步帧(activity + eventSeq)与轨迹外补充说明帧字段保形解析', async () => {
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
      // 轨迹外的补充说明帧(如 max-steps 上限说明):无 activity/rel,字段
      // 缺省如实透传(客户端按机器原文中性显示,单一实现)。
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
    const plain = frames[2]!;
    if (plain.type === 'step') {
      expect(plain.activity).toBeUndefined();
      expect(plain.eventSeq).toBeUndefined();
    } else {
      throw new Error('末帧应为 step');
    }
  });
});

describe('final/error 帧结构化失败 reason(T24 Phase B Task 3)', () => {
  it('failed 终局必附完整 reason{code,evidence,tried,phrasing};error 帧必附兜底 reason', async () => {
    const encoder = new TextEncoder();
    const expected: ChatSseFrame[] = [
      {
        type: 'step',
        turnId: 't-fail',
        message: { role: 'assistant', text: '导航到 articles' },
        rel: 'articles',
        activity: { op: 'navigate', title: '文章列表' },
        eventSeq: 44,
      },
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
      {
        type: 'error',
        error: '聊天循环异常: 爆炸',
        reason: { code: 'loop_exception', evidence: ['聊天循环异常: 爆炸'] },
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
    if (finalFrame.payload.outcome !== 'failed') throw new Error('应为失败终局');
    expect(finalFrame.payload.reason).toEqual({
      code: 'no_progress_loop',
      evidence: ['重复处境:articles', '可用动作:(无)', '已成功执行:0'],
      tried: ['导航到 articles'],
      phrasing: '当前页面没有提供完成这个目标所需的操作入口。',
    });
    const errorFrame = frames[2]!;
    if (errorFrame.type !== 'error') throw new Error('应为 error 帧');
    expect(errorFrame.reason).toEqual({
      code: 'loop_exception',
      evidence: ['聊天循环异常: 爆炸'],
    });
  });

  it('协议不变式由类型层强制:failed 终局与 error 帧缺 reason 不可构造', () => {
    const base = {
      sessionId: 'sess-lock',
      turnId: 'turn-lock',
      driver: 'llm' as const,
      requestedDriver: 'auto' as const,
      summary: 'x',
      steps: [] as never[],
      successes: [] as never[],
    };

    // GR2 单一实现锁:曾经冻结的「旧帧形状回退」必须永久处于类型层不可构造
    // 状态。若日后放宽合同(重新引入缺省 reason 的第二路径),下列期望错误
    // 指令将因未被使用而使 tsc 报错(TS2578),回归即红。
    const failedWithoutReason = { ...base, outcome: 'failed' };
    const badFailedFinal: ChatSseFrame = {
      type: 'final',
      turnId: 'turn-lock',
      // @ts-expect-error 协议不变式(T24 Phase B Task 3):failed 终局必附结构化 reason。
      payload: failedWithoutReason,
    };
    // @ts-expect-error 同上:error 帧必附结构化兜底 reason(D48 边界)。
    const badErrorFrame: ChatSseFrame = { type: 'error', error: 'boom' };
    void badFailedFinal;
    void badErrorFrame;
    expect(badFailedFinal.type).toBe('final');
    expect(badErrorFrame.type).toBe('error');
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
