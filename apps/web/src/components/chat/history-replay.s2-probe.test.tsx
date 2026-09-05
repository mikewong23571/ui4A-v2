// @vitest-environment jsdom
/**
 * T56 P0.3 / S2 探针(临时):刷新重放与迟到响应 —— 组件层实证。
 *
 * 覆盖探针步骤 1(UI 腿)/5:
 * - 预置 sessionId + 与路由输出同构(ChatTurn 无 clientView)的 history 响应 →
 *   FloatingChat 重放,记录 ChatTurn → ChatUiMessage → 可见消息的映射与丢失;
 * - 同 session 连发两问的现状行为:running 时 UI 单飞门禁(发送禁用)、
 *   停止后旧流晚到帧是否渲染、引用挂「最后一条 assistant」的回合无感知性。
 * 结论回填 probes/s2-history-citations.md;P3 定案后删除或改写为正式测试。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn() }),
}));

import { FloatingChat } from './floating-chat';
import { withCitationsOnLastAssistant } from './chat-types';
import { jsonResponse, openChat, ResizeObserverStub, sendGoal } from './floating-chat-test-stubs';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollTo = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

const RUN = 't56s2-probe3';

/** history 响应 shape 与路由输出逐字段同构(clientView 字段在 ChatTurn 上不存在)。 */
function historyResponse(): Response {
  return jsonResponse({
    turns: [
      {
        seq: 11,
        ts: '2026-09-06T00:00:00.000Z',
        sessionId: `${RUN}-sess`,
        turnId: `${RUN}-turn-a`,
        goal: { verb: `在 A 线问 ${RUN}-idea-a 的进展` },
        outcome: 'done',
        status: 'final',
        summary: `${RUN}-idea-a 正在评审。`,
        messages: [{ role: 'assistant', text: `${RUN}-idea-a 正在评审。` }],
        steps: [],
        driver: 'llm',
        citations: [{ rel: `idea:${RUN}-idea-a`, pointer: '/properties/status' }],
        // 真实路由输出不含 clientView —— 此处刻意省略以同构。
      },
      {
        seq: 14,
        ts: '2026-09-06T00:01:00.000Z',
        sessionId: `${RUN}-sess`,
        turnId: `${RUN}-turn-b`,
        goal: { verb: `在 B 线问 ${RUN}-idea-b 的进展` },
        outcome: 'done',
        status: 'final',
        summary: `${RUN}-idea-b 已归档。`,
        messages: [{ role: 'assistant', text: `${RUN}-idea-b 已归档。` }],
        steps: [],
        driver: 'llm',
        citations: [{ rel: `idea:${RUN}-idea-b`, pointer: '/properties/status' }],
      },
    ],
  });
}

describe('S2 步骤1(UI 腿):刷新后历史重放的可见信息', () => {
  it('重放 user 消息=goal.verb,回合无当时 thread/focus 标注,引用 chip 落当前对象', async () => {
    window.localStorage.setItem('ui4a.chat.sessionId', `${RUN}-sess`);
    const fetchMock = vi.fn(async (url: string | URL | RequestInfo) => {
      const target = String(url);
      if (target.includes('/api/chat/history')) return historyResponse();
      if (target.includes('/api/entity')) {
        const isIdeaB = target.includes(encodeURIComponent(`idea:${RUN}-idea-b`));
        return jsonResponse({
          class: ['entity'],
          properties: {
            rel: isIdeaB ? `idea:${RUN}-idea-b` : `idea:${RUN}-idea-a`,
            identity: isIdeaB ? '想法 B(当前名)' : '想法 A(当前名)',
          },
          links: [],
          actions: [],
        });
      }
      return new Response(JSON.stringify({ error: '未预期请求' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();

    // 刷新重放:user 消息逐字 = goal.verb;两回合顺序还原;答案逐条 assistant。
    await waitFor(() => expect(screen.getByText(`${RUN}-idea-b 已归档。`)).toBeTruthy());
    expect(screen.getByText(`在 A 线问 ${RUN}-idea-a 的进展`)).toBeTruthy();
    expect(screen.getByText(`在 B 线问 ${RUN}-idea-b 的进展`)).toBeTruthy();
    // 没有任何「本回合发生于 A 线/B 线」的处境标注(FR7 缺口的用户可见面)。
    expect(screen.queryByText(/本回合工作线/)).toBeNull();
    expect(screen.queryByText(/当时:/)).toBeNull();
    // 引用 chip 存在且按当前名渲染(经 /api/entity 懒取)。
    await waitFor(() => expect(screen.getByText('想法 A(当前名)')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('想法 B(当前名)')).toBeTruthy());
    const citationLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('data-nav')?.startsWith('citation:'));
    expect(citationLinks).toHaveLength(2);
    expect(citationLinks[0]!.getAttribute('data-rel')).toBe(`idea:${RUN}-idea-a`);
    // 两条引用 chip 外观一致,无法区分「A 线回合的引用」与「B 线回合的引用」。
    expect(citationLinks[1]!.getAttribute('data-rel')).toBe(`idea:${RUN}-idea-b`);
  });
});

describe('S2 步骤5:同 session 连发两问与迟到响应的现状行为', () => {
  it('running 时发送被禁用(UI 单飞);停止后旧流晚到帧不渲染;新回合照常', async () => {
    window.localStorage.removeItem('ui4a.chat.sessionId');
    const encoder = new TextEncoder();
    let controllerA: ReadableStreamDefaultController<Uint8Array> | undefined;
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        callCount += 1;
        // 协议口径:帧必须携带客户端当回合的 turnId(POST body 携带,否则被丢弃)。
        const body = JSON.parse(String(init?.body ?? '{}')) as { turnId?: string };
        const turnId = body.turnId ?? 'unknown-turn';
        if (callCount === 1) {
          const streamA = new ReadableStream<Uint8Array>({
            start(c) {
              controllerA = c;
              c.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'step',
                    turnId,
                    message: { role: 'assistant', text: '第一问进行中…' },
                  })}\n\n`,
                ),
              );
            },
          });
          return new Response(streamA, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }
        const streamB = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'step',
                  turnId,
                  message: { role: 'assistant', text: '第二问的回答。' },
                })}\n\n`,
              ),
            );
            c.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'final',
                  turnId,
                  payload: {
                    sessionId: `${RUN}-sess-live`,
                    driver: 'llm',
                    requestedDriver: 'llm',
                    outcome: 'done',
                    summary: '第二问完成',
                    steps: [],
                    successes: [],
                  },
                })}\n\n`,
              ),
            );
            c.close();
          },
        });
        return new Response(streamB, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('第一问');

    await waitFor(() => expect(screen.getByText('第一问进行中…')).toBeTruthy());

    // running 中尝试连发第二问:UI 门禁 = 现状的单飞保证——发送按钮被取消按钮
    // 取代(assistant-ui composer running 态),第二问无法提交;composer 仍可输入
    // (草稿保留,提交口不存在)。
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('输入目标…'), {
      target: { value: '第二问(草稿暂存)' },
    });
    expect(screen.getByDisplayValue('第二问(草稿暂存)')).toBeTruthy();

    // 停止第一问(B2 口径:仅中断展示)。
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    await waitFor(() => {
      expect(screen.getByText('已停止(仅中断展示,服务端轨迹已在事件日志留痕)')).toBeTruthy();
    });

    // 旧流晚到帧:第一问的流已 abort,晚到 final 不渲染(流被取消,帧物理不可达;
    // 若未取消,turnId 防线也只对"不同回合"的帧兜底)。
    try {
      controllerA?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'final',
            turnId: 'late-frame-stream-already-cancelled',
            payload: {
              sessionId: `${RUN}-sess-live`,
              driver: 'llm',
              requestedDriver: 'llm',
              outcome: 'done',
              summary: '第一问的迟到结论不应出现',
              steps: [],
              successes: [],
            },
          })}\n\n`,
        ),
      );
    } catch {
      // 流已取消:enqueue 抛错同样是有效证据。
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/第一问的迟到结论/)).toBeNull();

    // 第二问正常发送与完成;消息列表不被第一问晚到内容污染。
    sendGoal('第二问');
    await waitFor(() => expect(screen.getByText('第二问的回答。')).toBeTruthy());
    expect(screen.queryByText(/第一问的迟到结论/)).toBeNull();
    expect(screen.getByText('第一问进行中…')).toBeTruthy(); // 停止留痕仍在
  });

  it('纯函数层:引用挂「最后一条 assistant」与回合无关 —— 若并发存在将跨回合错挂', () => {
    const interleaved = [
      { role: 'user' as const, content: '第一问' },
      { role: 'assistant' as const, content: '第一问回答(慢)' },
      { role: 'user' as const, content: '第二问' },
      { role: 'assistant' as const, content: '第二问回答(快)' },
    ];
    const misattributed = withCitationsOnLastAssistant(interleaved, [
      { rel: `idea:${RUN}-a`, pointer: '/properties/status' },
    ]);
    // 第一问的引用会被挂到第二问的回答上(到达顺序,无 turnId 归属)。
    expect(misattributed[3]!.citations).toEqual([
      { rel: `idea:${RUN}-a`, pointer: '/properties/status' },
    ]);
    expect(misattributed[1]!.citations).toBeUndefined();
  });
});
