// @vitest-environment jsdom
/**
 * assistant 工作台(悬浮聊天)测试——可停止/历史/三形态壳/render capability
 * 半场(T23 Phase D 按场景自 floating-chat.test.tsx 拆出;委托/流式轨迹/
 * 思考区见 floating-chat.test.tsx)。
 *
 * T9 Phase B(工作台化):
 * - B2 可停止:running 时「停止」可点(onCancel 已接线),点击中止 fetch
 *   并追加「已停止(仅中断展示,服务端轨迹已在事件日志留痕)」;
 * - B3 历史:挂载时按 localStorage 的 sessionId 拉 /api/chat/history
 *   重放回合(goal 作为 user 消息在前);「新会话」清 localStorage + 清空消息;
 * - B4 三形态壳:FAB(收起)→ 悬浮窗(默认,float 卡片;「分栏」切
 *   sidebar 右侧分栏 aside,「悬浮」切回;形态记忆 localStorage)→
 *   「独立窗口」window.open('/chat')。三形态同一 ChatPanel 界面。
 *
 * T7 Phase C / S5(render capability):focus/render 回执 → 画布入口链接
 * (data-nav)+ 回执即达即跳(router.push 客户端导航)。
 *
 * T49 Phase 5(D68 会话双轴锚定):「新会话」= 下一轮携带全新 sessionId 且
 * 消息区不含旧会话回合(U2);清单多行 + selectSession 切换只重放所选会话、
 * 不串台(U1/U3)。客户端行为既有,此处锚定不改实现。
 * jsdom 无 ResizeObserver(assistant-ui 的 viewport/composer 尺寸观测),桩替换;
 * next/navigation 的 usePathname 桩为 '/'(非 /chat,壳正常渲染)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingChat } from './floating-chat';
import {
  hangingSseResponse,
  jsonResponse,
  openChat,
  ResizeObserverStub,
  sendGoal,
  sseResponse,
} from './floating-chat-test-stubs';

// usePathname:jsdom 无 AppRouter 上下文;桩为 '/'(工作台壳生效路径)。
// useRouter:同上;push 桩经 vi.hoisted 提取(render 回执即达即跳的断言锚点)。
const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: routerPushMock }),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // jsdom 未实现 Element.scrollTo(assistant-ui viewport 自动滚动调用),桩替换。
  Element.prototype.scrollTo = () => undefined;
  routerPushMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
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
  it('刷新恢复明确只重放持久化消息，不恢复 thinking 且不把 reasoning 错挂到后续回合', async () => {
    window.localStorage.setItem('ui4a.chat.sessionId', 'sess-refresh-policy');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            turns: [
              {
                seq: 1,
                ts: '2026-08-23T00:00:00.000Z',
                sessionId: 'sess-refresh-policy',
                turnId: 'turn-one',
                goal: { verb: '问题一' },
                outcome: 'done',
                status: 'final',
                summary: '回答一',
                messages: [{ role: 'assistant', text: '回答一' }],
                steps: [],
                driver: 'llm',
              },
              {
                seq: 2,
                ts: '2026-08-23T00:01:00.000Z',
                sessionId: 'sess-refresh-policy',
                turnId: 'turn-two',
                goal: { verb: '问题二' },
                outcome: 'done',
                status: 'final',
                summary: '回答二',
                messages: [{ role: 'assistant', text: '回答二' }],
                steps: [],
                driver: 'llm',
              },
            ],
          }),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();

    await waitFor(() => expect(screen.getByText('回答二')).toBeTruthy());
    expect(screen.getByText('问题一')).toBeTruthy();
    expect(screen.getByText('回答一')).toBeTruthy();
    expect(screen.getByText('问题二')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /思考 · 步骤/ })).toBeNull();
  });

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
    // 清单与会话标注来自两次独立 fetch,须在同一 waitFor 内等待全部就绪。
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    await waitFor(() => {
      expect(screen.getByText('发布旧文章')).toBeTruthy();
      expect(screen.getByText('发布当前文章')).toBeTruthy();
      expect(screen.getByText('2 回合')).toBeTruthy();
      expect(screen.getByText('· 当前')).toBeTruthy();
    });

    // 点击进入 sess-old:持久化 + 重放该会话回合。
    fireEvent.click(screen.getByText('发布旧文章'));
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe('sess-old');
    await waitFor(() => {
      expect(screen.getByText('完成: 旧目标完成')).toBeTruthy();
      expect(screen.getByText('会话 sess-old')).toBeTruthy();
    });
  });

  it('历史会话读取失败时显示真实错误,不伪装成空历史', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | RequestInfo) => {
        if (String(url).includes('/api/chat/sessions')) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(jsonResponse({ turns: [] }));
      }),
    );

    render(<FloatingChat />);
    openChat();
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));

    await waitFor(() => {
      expect(screen.getByText('读取历史会话失败（HTTP 404）')).toBeTruthy();
    });
    expect(screen.queryByTestId('empty-sessions')).toBeNull();
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

  it('exec 后 refresh focus 即使 rel 相同也换 URL，驱动画布读取动作后状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            { type: 'focus', rel: 'post:first-post' },
            { type: 'focus', rel: 'post:first-post', refresh: true },
            {
              type: 'step',
              rel: 'post:first-post',
              message: { role: 'assistant', text: '执行 unpublish(post:first-post)' },
            },
            {
              type: 'final',
              payload: {
                sessionId: 'sess-focus-refresh',
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
    sendGoal('下线第一篇');

    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/canvas?focus=post%3Afirst-post&refresh=1'),
    );
    expect(
      screen.getByRole('link', { name: /当前查看:post:first-post/ }).getAttribute('href'),
    ).toBe('/canvas?focus=post%3Afirst-post&refresh=1');
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

describe('工作台 · 会话双轴锚定(T49 Phase 5 / D68 · FR5)', () => {
  /** POST /api/chat 的请求体形状(断言 sessionId 分组键)。 */
  interface ChatPostBody {
    sessionId: string;
    turnId: string;
    goal: { verb: string };
  }

  /** history 回合桩(goal 在前、messages 逐条重放的投影形状)。 */
  const turnFixture = (sessionId: string, seq: number, verb: string, reply: string) => ({
    seq,
    ts: '2026-09-04T09:00:00.000Z',
    sessionId,
    turnId: `turn-${sessionId}-${seq}`,
    goal: { verb },
    outcome: 'done',
    summary: null,
    messages: [{ role: 'assistant', text: reply }],
    steps: [],
    driver: 'llm',
  });

  it('U2:「新会话」后下一轮 POST 携带全新 sessionId,消息区不含旧会话回合', async () => {
    // SSE 流回显请求 sessionId(session 帧先行,final 终帧)——服务端双轴解耦
    // 后 sessionId=请求值,锚点只关心客户端铸发与持久化链路。
    const postBodies: ChatPostBody[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | RequestInfo, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body ?? '{}')) as ChatPostBody;
        postBodies.push(payload);
        return Promise.resolve(
          sseResponse([
            { type: 'session', sessionId: payload.sessionId, turnId: payload.turnId },
            {
              type: 'final',
              payload: {
                sessionId: payload.sessionId,
                turnId: payload.turnId,
                driver: 'llm',
                requestedDriver: 'auto',
                outcome: 'done',
                summary: `完成: ${payload.goal.verb}`,
                steps: [],
                successes: [],
              },
            },
          ]),
        );
      }),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('旧会话目标');
    await waitFor(() => expect(screen.getByText('完成: 旧会话目标')).toBeTruthy());
    const first = postBodies[0]!.sessionId;
    // 回显的 session 帧已持久化(客户端自愈链路既有)。
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe(first);

    fireEvent.click(screen.getByRole('button', { name: '新会话' }));
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBeNull();
    expect(screen.queryByText('旧会话目标')).toBeNull();

    sendGoal('新会话目标');
    await waitFor(() => expect(screen.getByText('完成: 新会话目标')).toBeTruthy());
    expect(postBodies.length).toBe(2);
    const second = postBodies[1]!.sessionId;
    expect(second).not.toBe(first);
    // 现行客户端铸发形状:UUID v4(sessionRef 清空后 onNew 重新铸发)。
    expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // 消息区只有新会话回合:旧会话目标与回答均不回放(U2 干净上下文)。
    expect(screen.queryByText('旧会话目标')).toBeNull();
    expect(screen.queryByText('完成: 旧会话目标')).toBeNull();
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe(second);
  });

  it('U1/U3:清单多行渲染;切换会话只拉并重放所选回合,不串台', async () => {
    window.localStorage.setItem('ui4a.chat.sessionId', 'session-a');
    const historyHrefs: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | RequestInfo) => {
        const href = String(url);
        if (href.includes('/api/chat/sessions')) {
          return Promise.resolve(
            jsonResponse({
              sessions: [
                {
                  sessionId: 'session-b',
                  turns: 1,
                  firstTs: '2026-09-04T00:00:00.000Z',
                  lastTs: '2026-09-04T09:00:00.000Z',
                  lastGoal: 'B 清单摘要',
                  lastOutcome: 'done',
                },
                {
                  sessionId: 'session-a',
                  turns: 2,
                  firstTs: '2026-09-03T00:00:00.000Z',
                  lastTs: '2026-09-03T09:00:00.000Z',
                  lastGoal: 'A 清单摘要',
                  lastOutcome: 'done',
                },
              ],
            }),
          );
        }
        if (href.includes('/api/chat/history')) {
          historyHrefs.push(href);
          if (href.includes('sessionId=session-b')) {
            return Promise.resolve(
              jsonResponse({ turns: [turnFixture('session-b', 1, 'B 回合目标', 'B 的回答')] }),
            );
          }
          return Promise.resolve(
            jsonResponse({
              turns: [
                turnFixture('session-a', 1, 'A 第一回合', 'A 的回答一'),
                turnFixture('session-a', 2, 'A 第二回合', 'A 的回答二'),
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ error: '未预期请求' }));
      }),
    );

    render(<FloatingChat />);
    openChat();
    // 挂载重放当前会话(session-a)两回合。
    await waitFor(() => expect(screen.getByText('A 的回答二')).toBeTruthy());

    // 打开清单:两行 + 各自回合数(U1 多会话并存)。
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    await waitFor(() => {
      expect(screen.getByText('B 清单摘要')).toBeTruthy();
      expect(screen.getByText('A 清单摘要')).toBeTruthy();
      expect(screen.getByText('1 回合')).toBeTruthy();
      expect(screen.getByText('2 回合')).toBeTruthy();
    });

    // 进入 session-b:history 只拉该会话,消息区只重放 B 的回合(U3 不串台)。
    fireEvent.click(screen.getByText('B 清单摘要'));
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe('session-b');
    await waitFor(() => expect(screen.getByText('B 的回答')).toBeTruthy());
    expect(historyHrefs.some((href) => href.includes('sessionId=session-b'))).toBe(true);
    expect(screen.queryByText('A 第一回合')).toBeNull();
    expect(screen.queryByText('A 的回答一')).toBeNull();

    // 切回 session-a:重新拉取并完整重放两回合,B 的回合不再在场。
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    await waitFor(() => expect(screen.getByText('A 清单摘要')).toBeTruthy());
    fireEvent.click(screen.getByText('A 清单摘要'));
    await waitFor(() => expect(screen.getByText('A 第一回合')).toBeTruthy());
    expect(screen.getByText('A 第二回合')).toBeTruthy();
    expect(screen.getByText('A 的回答一')).toBeTruthy();
    expect(screen.getByText('A 的回答二')).toBeTruthy();
    expect(screen.queryByText('B 的回答')).toBeNull();
    expect(screen.queryByText('B 回合目标')).toBeNull();
    expect(historyHrefs.filter((href) => href.includes('sessionId=session-a'))).toHaveLength(2);
  });
});
