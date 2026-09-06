// @vitest-environment jsdom
/**
 * 刷新历史重放与迟到响应护栏(T56 P3.3 正式测试;自 P0.3/S2 探针种子转正,
 * 断言随 D78 决定 5 反转)。
 *
 * 覆盖:
 * - 历史重放:各回合携带「当时」clientView/userContextKnown,面板显式呈现
 *   每回合当时上下文;未知回合显式「当时上下文未知」,且不用当前 URL
 *   presence 补造(US08;原探针「无任何标注」的缺口断言已反转);
 * - 原 S2 步骤 5 护栏保持:running 单飞门禁、停止后旧流晚到帧不渲染、
 *   引用挂「最后一条 assistant」的已知缺口钉住(citations 归属按 turnId
 *   是后续演进,单飞门禁存续前提不变)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn() }),
}));

import { FloatingChat } from '../floating-chat';
import { withCitationsOnLastAssistant } from '../chat-types';
import { jsonResponse, openChat, ResizeObserverStub, sendGoal } from '../floating-chat-test-stubs';

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

const RUN = 't56p33-replay';
const SESSION = `${RUN}-sess`;

function view(thread: string, focus: string): unknown {
  return {
    schemaVersion: 2,
    presence: {
      clientInstanceId: `${RUN}-client`,
      site: 'workstation',
      scope: 'publishing',
      thread,
      focus,
    },
  };
}

/** history 响应 shape 与路由输出同构:各回合携带当时的 clientView/userContextKnown。 */
function historyResponse(): Response {
  return jsonResponse({
    turns: [
      {
        seq: 11,
        ts: '2026-09-06T00:00:00.000Z',
        sessionId: SESSION,
        turnId: `${RUN}-turn-a`,
        goal: { verb: `在 A 线问 ${RUN}-idea-a 的进展` },
        outcome: 'done',
        status: 'final',
        summary: `${RUN}-idea-a 正在评审。`,
        messages: [{ role: 'assistant', text: `${RUN}-idea-a 正在评审。` }],
        steps: [],
        driver: 'llm',
        citations: [{ rel: `idea:${RUN}-idea-a`, pointer: '/properties/status' }],
        clientView: view(`thread:${RUN}-thread-a`, `idea:${RUN}-idea-a`),
        userContextKnown: true,
      },
      {
        seq: 14,
        ts: '2026-09-06T00:01:00.000Z',
        sessionId: SESSION,
        turnId: `${RUN}-turn-b`,
        goal: { verb: `在 B 线问 ${RUN}-idea-b 的进展` },
        outcome: 'done',
        status: 'final',
        summary: `${RUN}-idea-b 已归档。`,
        messages: [{ role: 'assistant', text: `${RUN}-idea-b 已归档。` }],
        steps: [],
        driver: 'llm',
        citations: [{ rel: `idea:${RUN}-idea-b`, pointer: '/properties/status' }],
        clientView: view(`thread:${RUN}-thread-b`, `idea:${RUN}-idea-b`),
        userContextKnown: true,
      },
      {
        seq: 17,
        ts: '2026-09-06T00:02:00.000Z',
        sessionId: SESSION,
        turnId: `${RUN}-turn-old`,
        goal: { verb: '旧版提问' },
        outcome: 'done',
        status: 'final',
        summary: '旧版回答。',
        messages: [{ role: 'assistant', text: '旧版回答。' }],
        steps: [],
        driver: 'llm',
        userContextKnown: false,
      },
    ],
  });
}

describe('刷新历史重放:各回合显式呈现当时上下文(US08 / D78 决定 5)', () => {
  it('重放 user 消息=goal.verb,各回合标注各自当时的线/对象,未知回合显式未知且不被当前 presence 补造', async () => {
    window.localStorage.setItem('ui4a.chat.sessionId', SESSION);
    // 当前 URL 在「另一条线」上:历史回合不得被改标成当前线/当前对象。
    window.history.replaceState(
      {},
      '',
      `/canvas?scope=publishing&thread=thread:${RUN}-thread-now&focus=idea:${RUN}-now`,
    );
    const fetchMock = vi.fn(async (url: string | URL | RequestInfo) => {
      const target = String(url);
      if (target.includes('/api/chat/history')) return historyResponse();
      if (target.includes('/api/entity')) {
        const rel = decodeURIComponent(target.split('rel=')[1] ?? '');
        return jsonResponse({
          class: ['entity'],
          properties: { rel, identity: `${rel}(当前名)` },
          links: [],
          actions: [],
        });
      }
      return new Response(JSON.stringify({ error: '未预期请求' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();

    // 刷新重放:user 消息逐字 = goal.verb,顺序还原。
    await waitFor(() => expect(screen.getByText(`${RUN}-idea-b 已归档。`)).toBeTruthy());
    expect(screen.getByText(`在 A 线问 ${RUN}-idea-a 的进展`)).toBeTruthy();
    expect(screen.getByText(`在 B 线问 ${RUN}-idea-b 的进展`)).toBeTruthy();
    expect(screen.getByText('旧版回答。')).toBeTruthy();

    // 当时上下文显式呈现:A/B 回合各带各自的线/对象(不都标成当前线)。
    const notice = screen.getByTestId('turn-context-notice');
    expect(notice.textContent).toContain(
      `第 1 问 · 当时:线 thread:${RUN}-thread-a · 注视 idea:${RUN}-idea-a`,
    );
    expect(notice.textContent).toContain(
      `第 2 问 · 当时:线 thread:${RUN}-thread-b · 注视 idea:${RUN}-idea-b`,
    );
    // 未知回合显式「当时上下文未知」,且不出现当前 URL 的线/对象(不补造)。
    const rows = screen.getAllByTestId('turn-context-row');
    expect(rows).toHaveLength(3);
    expect(rows[2]!.getAttribute('data-known')).toBe('false');
    expect(rows[2]!.textContent).toBe(`第 3 问 · 当时上下文未知`);
    expect(notice.textContent).not.toContain(`thread-${RUN}-thread-now`);
    expect(notice.textContent).not.toContain(`idea:${RUN}-now`);

    // 输入区当前范围提示与 URL observation 同源(当前线=thread-now),与历史
    // 回合的「当时」标注形成显式时点边界。
    const strip = screen.getByTestId('input-scope-strip');
    expect(strip.getAttribute('data-thread')).toBe(`thread:${RUN}-thread-now`);

    // 引用 chip 仍在各自回合末条 assistant 上(结构断言;标签措辞归 P3.4)。
    await waitFor(() => expect(screen.getAllByTestId('turn-context-row')).toHaveLength(3));
    const citationLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('data-nav')?.startsWith('citation:'));
    expect(citationLinks.map((link) => link.getAttribute('data-rel'))).toEqual([
      `idea:${RUN}-idea-a`,
      `idea:${RUN}-idea-b`,
    ]);
  });
});

describe('同 session 连发与迟到响应护栏(原 S2 步骤 5 钉住)', () => {
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

  it('纯函数层:引用挂「最后一条 assistant」与回合无关 —— 若并发存在将跨回合错挂(已知缺口,单飞门禁兜底)', () => {
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
