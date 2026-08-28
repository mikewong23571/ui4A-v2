// @vitest-environment jsdom
/**
 * assistant 工作台(悬浮聊天)——委托模式与流式轨迹基础(T36 A2 自
 * floating-chat.test.tsx 按 feature 分片;step 活动语言/失败分层见
 * floating-chat-steps.test.tsx,思考区见 floating-chat-thinking.test.tsx;
 * 可停止/历史/三形态壳/render capability 见 floating-chat-session.test.tsx)。
 *
 * T5 Phase B(委托模式):开关打开后发送 mode:'delegated'——发送后立即回执
 * 「已派发委托 <id>,进度见舰队页 /delegations」,委托后台执行,
 * 监控交给舰队页(不在悬浮窗内轮询长任务)。
 *
 * T9 Phase B(B1 流式轨迹):inline 响应为 SSE——step 帧逐步追加 assistant
 * 消息(每步一条),final 帧更新 sessionId(localStorage 持久化);
 * 一次性 JSON 兼容路径(render 短路/委托派发/参数错误)仍覆盖。
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
  it('每次发送原子携带实际浏览器 route/subject 和 hook-lifetime client id', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Afirst-post');
    const fetchMock = vi.fn((...args: [string | URL | RequestInfo, RequestInit?]) => {
      void args;
      return Promise.resolve(
        jsonResponse({
          sessionId: 'sess-client-view',
          driver: 'llm',
          outcome: 'answered',
          summary: 'ok',
          messages: [{ role: 'assistant', text: 'ok' }],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();
    sendGoal('当前页面是什么？');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const first = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
      clientView?: { presence: { clientInstanceId: string; focus?: string } };
    };
    expect(first.clientView).toMatchObject({
      presence: { site: 'workstation', focus: 'post:first-post' },
    });
    expect(first.clientView?.presence.clientInstanceId).toMatch(/^[0-9a-f-]+$/i);

    window.history.pushState({}, '', '/canvas?focus=articles');
    sendGoal('再看一次');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as {
      clientView?: { presence: { clientInstanceId: string; focus?: string } };
    };
    expect(second.clientView).toMatchObject({
      presence: { site: 'workstation', focus: 'articles' },
    });
    expect(second.clientView?.presence.clientInstanceId).toBe(
      first.clientView?.presence.clientInstanceId,
    );
  });

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
    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      sessionId?: string;
      turnId?: string;
    };
    expect(requestBody.sessionId).toMatch(/^[0-9a-f-]+$/i);
    expect(requestBody.turnId).toMatch(/^[0-9a-f-]+$/i);
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe(requestBody.sessionId);
    expect(window.localStorage.getItem('ui4a.chat.pendingSessionId')).toBe(requestBody.sessionId);
    fireEvent.click(screen.getByRole('button', { name: '新会话' }));
  });

  it('SSE:活动步帧与补充说明帧按合同呈现,final 更新会话标签并持久化', async () => {
    const frames = [
      {
        type: 'step',
        message: { role: 'assistant', text: '导航到 articles' },
        rel: 'articles',
        activity: { op: 'navigate', title: '文章列表' },
        eventSeq: 41,
      },
      {
        type: 'step',
        message: { role: 'assistant', text: '执行 next(article-drafting:main) {"title":"x"}' },
        rel: 'article-drafting:main',
        activity: { op: 'exec', title: '完成编辑' },
        eventSeq: 42,
      },
      {
        type: 'step',
        message: { role: 'assistant', text: '完成: 目标完成' },
        rel: 'flow:ad',
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

    // 活动步帧各成一条活动条目(独立链接),轨迹外补充说明帧按原文直出。
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '正在读取 文章列表' })).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: '正在执行 完成编辑' })).toBeTruthy();
    expect(screen.getByText('完成: 目标完成')).toBeTruthy();
    // 活动条目的机器日志原文不进主呈现(message.text 保留在帧内作机器层)。
    expect(screen.queryByText(/导航到 articles/)).toBeNull();
    expect(screen.queryByText(/执行 next\(article-drafting:main\)/)).toBeNull();
    // final:sessionId 进会话标签(前 8 位)+ localStorage(B1/B3 投影键);
    // 补充说明帧已含终局内容,final.summary 不再补一条。
    expect(screen.getByText('会话 sess-sse')).toBeTruthy();
    expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBe('sess-sse-1');
    expect(screen.queryByText('目标完成')).toBeNull();
    // flow rel 徽章(T32 Q4):仅结构化 `flow:` 前缀驱动;文本含「执行 next(」
    // 而 rel 无前缀的诱饵帧不出徽章,唯一徽章来自 rel 前缀的补充帧。
    expect(screen.getAllByTestId('flow-rel-badge').map((b) => b.textContent)).toEqual(['flow:ad']);
  });

  it('error 帧(服务端兜底)必附结构化 reason:中性结构化展示,不走机器叙句直出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            {
              type: 'error',
              error: '聊天循环异常: 爆炸',
              reason: { code: 'loop_exception', evidence: ['聊天循环异常: 爆炸'] },
            },
          ]),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('失败 · code=loop_exception')).toBeTruthy();
    });
    // 结构化本体可达(evidence 在失败数据区),机器叙句不作主呈现直出。
    expect(screen.getByText('聊天循环异常: 爆炸')).toBeTruthy();
    expect(screen.queryByText('失败: 聊天循环异常: 爆炸')).toBeNull();
  });
});

