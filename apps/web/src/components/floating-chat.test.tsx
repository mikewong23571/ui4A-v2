// @vitest-environment jsdom
/**
 * assistant 工作台(悬浮聊天)测试。
 *
 * T5 Phase B(委托模式):开关打开后发送 mode:'delegated'——发送后立即回执
 * 「已派发委托 <id>,进度见舰队页 /delegations」,委托后台执行,
 * 监控交给舰队页(不在悬浮窗内轮询长任务)。
 *
 * T9 Phase B(工作台化):
 * - B1 流式轨迹:inline 响应为 SSE——step 帧逐步追加 assistant 消息
 *   (每步一条),final 帧更新 sessionId(localStorage 持久化);
 * - B2 可停止:running 时「停止」可点(onCancel 已接线),点击中止 fetch
 *   并追加「已停止(仅中断展示,服务端轨迹已在事件日志留痕)」;
 * - B3 历史:挂载时按 localStorage 的 sessionId 拉 /api/chat/history
 *   重放回合(goal 作为 user 消息在前);「新会话」清 localStorage + 清空消息;
 * - B4 三形态壳:FAB(收起)→ 悬浮窗(默认,float 卡片;「分栏」切
 *   sidebar 右侧分栏 aside,「悬浮」切回;形态记忆 localStorage)→
 *   「独立窗口」window.open('/chat')。三形态同一 ChatPanel 界面。
 *
 * 一次性 JSON 兼容路径(render 短路/委托派发/参数错误)仍覆盖。
 *
 * T11 Phase C(思考区):thinking 帧(llm 步推理自述,先于同号 step 帧)
 * 渲染为可折叠「思考 · 步骤 N」区(默认收起,推理是次级信息);与同号
 * step 帧交错时按到达序相邻;rule 路径零 thinking 帧,渲染与现状一致。
 * jsdom 无 ResizeObserver(assistant-ui 的 viewport/composer 尺寸观测),桩替换;
 * next/navigation 的 usePathname 桩为 '/'(非 /chat,壳正常渲染)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingChat } from './floating-chat';

// usePathname:jsdom 无 AppRouter 上下文;桩为 '/'(工作台壳生效路径)。
// useRouter:同上;push 桩经 vi.hoisted 提取(render 回执即达即跳的断言锚点)。
const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: routerPushMock }),
}));

// assistant-ui 在浏览器用 ResizeObserver(jsdom 未实现;观测性桩足够渲染与交互)。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // jsdom 未实现 Element.scrollTo(assistant-ui viewport 自动滚动调用),桩替换。
  Element.prototype.scrollTo = () => undefined;
  routerPushMock.mockClear();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** SSE 响应桩:帧序列一次性入队后关闭(客户端逐帧消费)。 */
function sseResponse(frames: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 永不结束的 SSE 流(停止测试:running 态的确定性来源)。 */
function hangingSseResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({ start: () => undefined });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function openChat(): void {
  fireEvent.click(screen.getByRole('button', { name: '展开聊天窗' }));
}

/** 输入目标并点发送。 */
function sendGoal(goal: string): void {
  const input = screen.getByPlaceholderText('输入目标…') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: goal } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('悬浮聊天窗 · 委托模式(T5 Phase B)', () => {
  it('开启委托开关:请求带 mode=delegated,回执进对话(id 短前缀 + 舰队页指路)', async () => {
    const fetchMock = vi.fn((...args: [string | URL | RequestInfo, RequestInit?]) => {
      void args;
      return Promise.resolve(
        jsonResponse({
          mode: 'delegated',
          delegationId: 'abcdef12-3456-4789-bcde-f0123456789a',
          statusUrl: '/api/delegations/abcdef12-3456-4789-bcde-f0123456789a',
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();

    const toggle = screen.getByRole('button', { name: '委托模式' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1]! as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.mode).toBe('delegated');
    expect(body.goal).toEqual({ verb: '发布一篇文章' });

    await waitFor(() => {
      expect(screen.getByText(/已派发委托 abcdef12/)).toBeTruthy();
    });
    expect(screen.getByText(/委托监控页 \/delegations/)).toBeTruthy();
  });

  it('一次性 JSON 兼容路径(旧 inline 形状):消息逐条呈现,请求无 mode 字段', async () => {
    const fetchMock = vi.fn((...args: [string | URL | RequestInfo, RequestInit?]) => {
      void args;
      return Promise.resolve(
        jsonResponse({
          sessionId: 'sess-inline',
          driver: 'rule',
          outcome: 'done',
          summary: '目标完成',
          messages: [{ role: 'assistant', text: '导航到 articles' }],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('导航到 articles')).toBeTruthy();
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1]! as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect('mode' in body).toBe(false);
    expect(body.goal).toEqual({ verb: '发布一篇文章' });
  });
});

describe('工作台 · 流式轨迹(T9 Phase B / B1)', () => {
  it('请求发出前即生成并持久化 session/turn 标识，刷新可从 started 投影续接', async () => {
    const fetchMock = vi.fn((...args: [string | URL | RequestInfo, RequestInit?]) => {
      void args;
      return Promise.resolve(hangingSseResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();
    sendGoal('长时间处理');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { sessionId?: string; turnId?: string };
    expect(requestBody.sessionId).toMatch(/^[0-9a-f-]+$/i);
    expect(requestBody.turnId).toMatch(/^[0-9a-f-]+$/i);
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe(requestBody.sessionId);
    fireEvent.click(screen.getByRole('button', { name: '新会话' }));
  });

  it('SSE:step 帧逐步各成一条 assistant 消息,final 更新会话标签并持久化', async () => {
    const frames = [
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' }, rel: 'articles' },
      {
        type: 'step',
        message: { role: 'assistant', text: '执行 next(article-drafting:main) {"title":"x"}' },
        rel: 'article-drafting:main',
      },
      {
        type: 'step',
        message: { role: 'assistant', text: '完成: 目标完成' },
        rel: 'article-drafting:main',
      },
      {
        type: 'final',
        payload: {
          sessionId: 'sess-sse-1',
          driver: 'rule',
          requestedDriver: 'auto',
          outcome: 'done',
          summary: '目标完成',
          steps: [],
          successes: [],
        },
      },
    ];
    const fetchMock = vi.fn((...args: [string | URL | RequestInfo, RequestInit?]) => {
      void args;
      return Promise.resolve(sseResponse(frames));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    // 每步一条(独立气泡),不再是 join('\n') 整坨。
    await waitFor(() => {
      expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    });
    expect(screen.getByText('导航到 articles')).toBeTruthy();
    expect(screen.getByText(/执行 next\(article-drafting:main\)/)).toBeTruthy();
    // final:sessionId 进会话标签(前 8 位)+ localStorage(B1/B3 投影键)。
    expect(screen.getByText('会话 sess-sse')).toBeTruthy();
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe('sess-sse-1');
    // flow 实例步骤的 rel 徽章(弱化呈现;消息文本同含 rel,故用 getAllByText)。
    expect(screen.getAllByText('article-drafting:main').length).toBeGreaterThanOrEqual(1);
  });

  it('error 帧(服务端兜底)如实进消息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse([{ type: 'error', error: '聊天循环异常: 爆炸' }]))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText(/失败: 聊天循环异常: 爆炸/)).toBeTruthy();
    });
  });
});

describe('工作台 · 思考区(T11 Phase C)', () => {
  it('thinking 帧:渲染为默认收起的「思考」区,点击展开读全文、再点收起', async () => {
    const frames = [
      { type: 'thinking', step: 1, text: '先补标题,再推进向导' },
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' }, rel: 'articles' },
      {
        type: 'final',
        payload: {
          sessionId: 'sess-think-1',
          driver: 'llm',
          requestedDriver: 'auto',
          outcome: 'done',
          summary: '目标完成',
          steps: [],
          successes: [],
        },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('导航到 articles')).toBeTruthy();
    });
    // 默认收起(推理是次级信息):触发器在,正文未进 DOM。
    const trigger = screen.getByRole('button', { name: /思考 · 步骤 1/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('先补标题,再推进向导')).toBeNull();
    // thinking 帧不得落入未知帧 else 分支(否则会追加「失败: undefined」)。
    expect(screen.queryByText(/失败: undefined/)).toBeNull();

    // 展开读全文;再点收起。
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('先补标题,再推进向导')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByText('先补标题,再推进向导')).toBeNull();
  });

  it('thinking 与 step 帧交错:每步思考区按到达序先于同号步骤消息', async () => {
    const frames = [
      { type: 'thinking', step: 1, text: '先补标题,再推进向导' },
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' }, rel: 'articles' },
      { type: 'thinking', step: 2, text: '字段已齐,收尾收工' },
      { type: 'step', message: { role: 'assistant', text: '完成: 目标完成' } },
      {
        type: 'final',
        payload: {
          sessionId: 'sess-think-2',
          driver: 'llm',
          requestedDriver: 'auto',
          outcome: 'done',
          summary: '目标完成',
          steps: [],
          successes: [],
        },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    });
    const firstThinking = screen.getByRole('button', { name: /思考 · 步骤 1/ });
    const firstStep = screen.getByText('导航到 articles');
    const secondThinking = screen.getByRole('button', { name: /思考 · 步骤 2/ });
    const secondStep = screen.getByText('完成: 目标完成');
    // 到达序 = 渲染序:思考1 → 步骤1 → 思考2 → 步骤2。
    expect(
      firstThinking.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      firstStep.compareDocumentPosition(secondThinking) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      secondThinking.compareDocumentPosition(secondStep) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('rule 路径(零 thinking 帧):不渲染思考区,消息流与现状一致', async () => {
    const frames = [
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' }, rel: 'articles' },
      { type: 'step', message: { role: 'assistant', text: '完成: 目标完成' } },
      {
        type: 'final',
        payload: {
          sessionId: 'sess-think-rule',
          driver: 'rule',
          requestedDriver: 'auto',
          outcome: 'done',
          summary: '目标完成',
          steps: [],
          successes: [],
        },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    });
    expect(screen.getByText('导航到 articles')).toBeTruthy();
    // 思考条目零(「思考 · 步骤 N」触发器;与 composer 的「思考过程」开关区分)。
    expect(screen.queryByRole('button', { name: /思考 · 步骤/ })).toBeNull();
    expect(screen.queryByText(/失败/)).toBeNull();
  });
});

describe('工作台 · 思考增量与渲染回执帧', () => {
  const finalFrame = (sessionId: string) => ({
    type: 'final',
    payload: {
      sessionId,
      driver: 'llm' as const,
      requestedDriver: 'auto' as const,
      outcome: 'done' as const,
      summary: '目标完成',
      steps: [],
      successes: [],
    },
  });

  it('thinking-delta 同号原地累积成单条;thinking 终帧以全文替换(权威终帧)', async () => {
    const frames = [
      { type: 'thinking-delta', step: 1, text: '先补标题' },
      { type: 'thinking-delta', step: 1, text: ',再推进向导' },
      { type: 'thinking', step: 1, text: '先补标题,再推进向导(聚合全文)' },
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' }, rel: 'articles' },
      finalFrame('sess-delta-1'),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('导航到 articles')).toBeTruthy();
    });
    // 同号增量合并为单条思考条目(非每片段一条)。
    const triggers = screen.getAllByRole('button', { name: /思考 · 步骤 1/ });
    expect(triggers).toHaveLength(1);
    fireEvent.click(triggers[0]!);
    // 终帧全文替换累积(权威;兼容丢增量)。
    expect(screen.getByText('先补标题,再推进向导(聚合全文)')).toBeTruthy();
    expect(screen.queryByText(/先补标题$/)).toBeNull();
  });

  it('仅增量无终帧:条目文本 = 片段拼接(流中断时仍可读)', async () => {
    const frames = [
      { type: 'thinking-delta', step: 1, text: '片段一' },
      { type: 'thinking-delta', step: 1, text: '片段二' },
      { type: 'step', message: { role: 'assistant', text: '完成: 目标完成' } },
      finalFrame('sess-delta-2'),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    });
    const trigger = screen.getByRole('button', { name: /思考 · 步骤 1/ });
    fireEvent.click(trigger);
    expect(screen.getByText('片段一片段二')).toBeTruthy();
  });

  it('render 帧(渲染 LLM 路径 SSE 化):回执消息 + 画布入口 + 即达即跳(与 JSON 回执等价)', async () => {
    const canvasUrl = '/canvas?concern=articles-by-category';
    const frames = [
      { type: 'thinking-delta', step: 1, text: '先看词汇表' },
      {
        type: 'render',
        payload: {
          sessionId: 'sess-render-sse',
          driver: 'llm',
          requestedDriver: 'auto',
          outcome: 'done',
          summary: '渲染已生成:articles-by-category',
          messages: [
            {
              role: 'assistant',
              text: `已生成渲染「articles-by-category」(chart,首次凝固)→ 在画布打开:${canvasUrl}`,
            },
          ],
          steps: [],
          successes: [],
          render: {
            concern: 'articles-by-category',
            spec: {
              concern: 'articles-by-category',
              component: 'chart',
              bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
            },
            frozenNow: true,
            canvasUrl,
          },
        },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('可视化文章分类');

    await waitFor(() => {
      expect(screen.getByText(/已生成渲染「articles-by-category」/)).toBeTruthy();
    });
    const link = screen.getByRole('link', { name: /在画布查看/ }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(canvasUrl);
    expect(routerPushMock).toHaveBeenCalledWith(canvasUrl);
  });

  it('思考开关:默认开启;关闭 → 思考条目不渲染且持久化,重开即回', async () => {
    const frames = [
      { type: 'thinking', step: 1, text: '先补标题,再推进向导' },
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' }, rel: 'articles' },
      finalFrame('sess-toggle-1'),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    const toggle = screen.getByRole('button', { name: '思考过程' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /思考 · 步骤 1/ })).toBeTruthy();
    });

    // 关闭:条目即刻消失(state 保留),localStorage 落 '0'。
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: /思考 · 步骤/ })).toBeNull();
    expect(window.localStorage.getItem('ui4a.chat.thinking')).toBe('0');

    // 重开:条目回来(消息未丢)。
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /思考 · 步骤 1/ })).toBeTruthy();
    expect(window.localStorage.getItem('ui4a.chat.thinking')).toBe('1');
  });

  it('思考开关持久化:localStorage 置 0 起步 → 初始关闭,思考条目不进消息区', async () => {
    window.localStorage.setItem('ui4a.chat.thinking', '0');
    const frames = [
      { type: 'thinking', step: 1, text: '先补标题' },
      { type: 'step', message: { role: 'assistant', text: '完成: 目标完成' } },
      finalFrame('sess-toggle-2'),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    const toggle = screen.getByRole('button', { name: '思考过程' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => {
      expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /思考 · 步骤/ })).toBeNull();
  });
});

describe('工作台 · 可停止(T9 Phase B / B2)', () => {
  it('running 时「停止」可点;点击中止并追加「已停止」留痕说明', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(hangingSseResponse())),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    const cancel = (await screen.findByRole('button', {
      name: '停止',
    })) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);

    await waitFor(() => {
      expect(screen.getByText('已停止(仅中断展示,服务端轨迹已在事件日志留痕)')).toBeTruthy();
    });
    // isRunning 归位:发送按钮回来。
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
    });
  });
});

describe('工作台 · 聊天历史(T9 Phase B / B3)', () => {
  it('挂载按 localStorage 的 sessionId 拉历史并重放(goal 在前,messages 逐条)', async () => {
    window.localStorage.setItem('ui4a.chat.sessionId', 'sess-hist');
    const fetchMock = vi.fn((url: string | URL | RequestInfo, init?: RequestInit) => {
      void init;
      if (String(url).includes('/api/chat/history')) {
        return Promise.resolve(
          jsonResponse({
            turns: [
              {
                seq: 7,
                ts: '2026-08-21T00:00:00.000Z',
                sessionId: 'sess-hist',
                goal: { verb: '发布一篇文章' },
                outcome: 'done',
                summary: '目标完成',
                messages: [
                  { role: 'assistant', text: '导航到 articles' },
                  { role: 'assistant', text: '完成: 目标完成' },
                ],
                driver: 'rule',
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ error: '未预期请求' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();

    await waitFor(() => {
      expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    });
    // goal 作为 user 消息在前;轨迹逐条 assistant。
    expect(screen.getByText('发布一篇文章')).toBeTruthy();
    expect(screen.getByText('导航到 articles')).toBeTruthy();
    // 会话标签来自 localStorage(未发新回合;标签只显示前 8 位)。
    expect(screen.getByText('会话 sess-his')).toBeTruthy();
    // 只拉了历史,未发聊天请求。
    expect(
      fetchMock.mock.calls.every((call) => String(call[0]).includes('/api/chat/history')),
    ).toBe(true);
  });

  it('「新会话」清 localStorage + 清空消息(历史仍在日志)', async () => {
    window.localStorage.setItem('ui4a.chat.sessionId', 'sess-hist');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            turns: [
              {
                seq: 7,
                ts: '2026-08-21T00:00:00.000Z',
                sessionId: 'sess-hist',
                goal: { verb: '发布一篇文章' },
                outcome: 'done',
                summary: '目标完成',
                messages: [{ role: 'assistant', text: '完成: 目标完成' }],
                driver: 'rule',
              },
            ],
          }),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    await waitFor(() => {
      expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '新会话' }));

    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBeNull();
    expect(screen.queryByText('完成: 目标完成')).toBeNull();
    expect(screen.getByText('新会话', { selector: 'span' })).toBeTruthy();
  });

  it('「历史会话」清单:拉 /api/chat/sessions 呈现,点击进入该会话并重放', async () => {
    window.localStorage.setItem('ui4a.chat.sessionId', 'sess-cur');
    const fetchMock = vi.fn((url: string | URL | RequestInfo) => {
      const href = String(url);
      if (href.includes('/api/chat/sessions')) {
        return Promise.resolve(
          jsonResponse({
            sessions: [
              {
                sessionId: 'sess-old',
                turns: 2,
                firstTs: '2026-08-21T08:00:00.000Z',
                lastTs: '2026-08-21T09:00:00.000Z',
                lastGoal: '发布旧文章',
                lastOutcome: 'done',
              },
              {
                sessionId: 'sess-cur',
                turns: 1,
                firstTs: '2026-08-22T08:00:00.000Z',
                lastTs: '2026-08-22T09:00:00.000Z',
                lastGoal: '发布当前文章',
                lastOutcome: 'failed',
              },
            ],
          }),
        );
      }
      if (href.includes('sessionId=sess-old')) {
        return Promise.resolve(
          jsonResponse({
            turns: [
              {
                seq: 3,
                ts: '2026-08-21T09:00:00.000Z',
                sessionId: 'sess-old',
                goal: { verb: '发布旧文章' },
                outcome: 'done',
                summary: '旧目标完成',
                messages: [{ role: 'assistant', text: '完成: 旧目标完成' }],
                driver: 'rule',
              },
            ],
          }),
        );
      }
      // 当前会话的挂载历史拉取(空回合)
      return Promise.resolve(jsonResponse({ turns: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();

    // 打开清单:两行会话,当前会话标注「当前」。
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    await waitFor(() => {
      expect(screen.getByText('发布旧文章')).toBeTruthy();
    });
    expect(screen.getByText('发布当前文章')).toBeTruthy();
    expect(screen.getByText('2 回合')).toBeTruthy();
    expect(screen.getByText('· 当前')).toBeTruthy();

    // 点击进入 sess-old:持久化 + 重放该会话回合。
    fireEvent.click(screen.getByText('发布旧文章'));
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe('sess-old');
    await waitFor(() => {
      expect(screen.getByText('完成: 旧目标完成')).toBeTruthy();
    });
    expect(screen.getByText('会话 sess-old')).toBeTruthy();
  });
});

describe('工作台 · 三形态壳(T9 Phase B / B4)', () => {
  it('FAB → 悬浮窗(默认,float 卡片,锚点齐);收起回 FAB', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { container } = render(<FloatingChat />);
    // 收起态:FAB。
    openChat();
    // 悬浮窗态:fixed 卡片(非 aside 分栏)+ 头部操作(全部带 data-nav,I3)。
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.getByPlaceholderText('输入目标…')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新会话' }).getAttribute('data-nav')).toBe(
      'local:chat-new',
    );
    expect(screen.getByRole('button', { name: '分栏' }).getAttribute('data-nav')).toBe(
      'local:chat-dock',
    );
    expect(screen.getByRole('button', { name: '独立窗口' }).getAttribute('data-nav')).toBe(
      'local:chat-popout',
    );
    expect(screen.getByRole('button', { name: '收起聊天窗' }).getAttribute('data-nav')).toBe(
      'local:chat-close',
    );

    fireEvent.click(screen.getByRole('button', { name: '收起聊天窗' }));
    expect(screen.queryByPlaceholderText('输入目标…')).toBeNull();
    expect(screen.getByRole('button', { name: '展开聊天窗' })).toBeTruthy();
  });

  it('悬浮窗 ⇄ 分栏互切(同一 ChatPanel 界面,形态记忆 localStorage)', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { container } = render(<FloatingChat />);
    openChat();
    // float → sidebar:「分栏」切换,出现 aside 分栏,头部换成「悬浮」。
    fireEvent.click(screen.getByRole('button', { name: '分栏' }));
    expect(container.querySelector('aside')).not.toBeNull();
    expect(screen.getByRole('button', { name: '悬浮' }).getAttribute('data-nav')).toBe(
      'local:chat-float',
    );
    expect(window.localStorage.getItem('ui4a.chat.mode')).toBe('sidebar');
    // sidebar → float:「悬浮」切回,aside 消失。
    fireEvent.click(screen.getByRole('button', { name: '悬浮' }));
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.getByRole('button', { name: '分栏' })).toBeTruthy();
    expect(window.localStorage.getItem('ui4a.chat.mode')).toBe('float');
    // 形态记忆:sidebar 态收起后重开,直接进 sidebar。
    fireEvent.click(screen.getByRole('button', { name: '分栏' }));
    fireEvent.click(screen.getByRole('button', { name: '收起聊天窗' }));
    openChat();
    expect(container.querySelector('aside')).not.toBeNull();
  });

  it('「独立窗口」window.open(/chat) 且本窗收起为 FAB', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const openMock = vi.fn();
    window.open = openMock as unknown as typeof window.open;

    render(<FloatingChat />);
    openChat();
    fireEvent.click(screen.getByRole('button', { name: '独立窗口' }));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock.mock.calls[0]![0]).toBe('/chat');
    expect(screen.getByRole('button', { name: '展开聊天窗' })).toBeTruthy();
  });
});

describe('悬浮聊天窗 · render capability(T7 Phase C / S5)', () => {
  it('具体查看 focus 回执 → 当前对象入口 + router.push 到临时画布 focus', async () => {
    const canvasUrl = '/canvas?focus=post%3Afirst-post';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            sessionId: 'sess-focus',
            driver: 'rule',
            outcome: 'done',
            messages: [{ role: 'assistant', text: '正在查看「第一篇」' }],
            focus: { rel: 'post:first-post', canvasUrl },
          }),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('我要看看第一篇文章');

    await waitFor(() => expect(screen.getByText('正在查看「第一篇」')).toBeTruthy());
    const link = screen.getByRole('link', { name: /当前查看:post:first-post/ });
    expect(link.getAttribute('href')).toBe(canvasUrl);
    expect(link.getAttribute('data-nav')).toBe('focus:post:first-post');
    expect(routerPushMock).toHaveBeenCalledWith(canvasUrl);
  });

  it('navigate 成功的 SSE focus 帧实时更新同一个画布 focus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            { type: 'focus', rel: 'post:first-post' },
            {
              type: 'step',
              rel: 'post:first-post',
              message: { role: 'assistant', text: '导航到 post:first-post' },
            },
            {
              type: 'final',
              payload: {
                sessionId: 'sess-focus-stream',
                driver: 'llm',
                requestedDriver: 'auto',
                outcome: 'done',
                summary: '目标完成',
                steps: [],
                successes: [],
              },
            },
          ]),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('查看第一篇');
    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/canvas?focus=post%3Afirst-post'),
    );
    expect(screen.getByRole('link', { name: /当前查看:post:first-post/ })).toBeTruthy();
  });

  it('响应携带 render 载荷 → 对话呈现生成回执 + 画布入口链接(data-nav)', async () => {
    const canvasUrl = '/canvas?concern=articles-by-category';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            sessionId: 'sess-render',
            driver: 'rule',
            outcome: 'done',
            summary: '渲染已生成:articles-by-category',
            messages: [
              {
                role: 'assistant',
                text: `已生成渲染「articles-by-category」(chart,首次凝固)→ 在画布打开:${canvasUrl}`,
              },
            ],
            render: {
              concern: 'articles-by-category',
              spec: {
                concern: 'articles-by-category',
                component: 'chart',
                bind: {
                  series: { collection: 'articles', dimension: 'articles.fields.category' },
                },
              },
              frozenNow: true,
              canvasUrl,
            },
          }),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('按分类展示文章');

    // 生成回执进对话(消息文本含画布 URL)
    await waitFor(() => {
      expect(screen.getByText(/已生成渲染「articles-by-category」/)).toBeTruthy();
    });
    // 画布入口:surface 引用的可点形态(合同导航标注,I3)
    const link = screen.getByRole('link', { name: /在画布查看/ }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(canvasUrl);
    expect(link.getAttribute('data-nav')).toBe('render:articles-by-category');
  });

  it('render 回执即达即跳:router.push 到画布 URL(与点击入口等价);地址已在目标则零导航', async () => {
    const canvasUrl = '/canvas?concern=articles-by-category';
    const receipt = (text: string) =>
      jsonResponse({
        sessionId: 'sess-render-nav',
        driver: 'rule',
        outcome: 'done',
        summary: '渲染已生成',
        messages: [{ role: 'assistant', text }],
        render: {
          concern: 'articles-by-category',
          spec: {
            concern: 'articles-by-category',
            component: 'chart',
            bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
          },
          frozenNow: true,
          canvasUrl,
        },
      });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(receipt('已生成渲染「articles-by-category」(chart,首次凝固)'))
        .mockResolvedValueOnce(receipt('已生成渲染「articles-by-category」(chart,复用已凝固布局)')),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('按分类展示文章');

    await waitFor(() => {
      expect(screen.getByText(/首次凝固/)).toBeTruthy();
    });
    // 即达即跳:回执到达 → 编程式客户端导航(与点击「在画布查看」同一条路;
    // main 内容区切画布,悬浮面板在 root layout 不重挂载)。
    expect(routerPushMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith(canvasUrl);

    // 去重守卫:地址已在目标(重复请求同一渲染)→ 零导航,不重复入历史。
    window.history.pushState({}, '', canvasUrl);
    try {
      sendGoal('按分类展示文章');
      await waitFor(() => {
        expect(screen.getByText(/复用已凝固布局/)).toBeTruthy();
      });
      expect(routerPushMock).toHaveBeenCalledTimes(1);
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('普通响应(无 render 载荷)→ 不渲染画布入口链接', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            sessionId: 'sess-plain',
            driver: 'rule',
            outcome: 'done',
            messages: [{ role: 'assistant', text: '完成: 目标完成' }],
          }),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText(/完成: 目标完成/)).toBeTruthy();
    });
    expect(screen.queryByRole('link', { name: /在画布查看/ })).toBeNull();
  });
});
