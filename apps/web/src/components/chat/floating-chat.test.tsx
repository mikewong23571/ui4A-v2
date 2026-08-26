// @vitest-environment jsdom
/**
 * assistant 工作台(悬浮聊天)测试——发送/流式轨迹/思考区半场
 * (T23 Phase D 按场景自 floating-chat.test.tsx 拆出;可停止/历史/三形态壳/
 * render capability 见 floating-chat-session.test.tsx)。
 *
 * T5 Phase B(委托模式):开关打开后发送 mode:'delegated'——发送后立即回执
 * 「已派发委托 <id>,进度见舰队页 /delegations」,委托后台执行,
 * 监控交给舰队页(不在悬浮窗内轮询长任务)。
 *
 * T9 Phase B(B1 流式轨迹):inline 响应为 SSE——step 帧逐步追加 assistant
 * 消息(每步一条),final 帧更新 sessionId(localStorage 持久化);
 * 一次性 JSON 兼容路径(render 短路/委托派发/参数错误)仍覆盖。
 *
 * T11 Phase C(思考区)+ T24 Phase B(默认折叠可展开):thinking 增量/终帧
 * 按 (turnId, step) 聚合成一条条目;进行中条目默认折叠为紧凑的「思考中 ·
 * 第 N 步」进行中指示(含步数、无机制词),展开即实时思考增量;同号 step 帧
 * 到达或回合结束后回落为「思考 · 步骤 N」仍可展开查看(数据不丢);全局
 * 思考开关已移除(折叠指示常在,无需整体隐藏);rule 路径零 thinking 帧。
 * jsdom 无 ResizeObserver(assistant-ui 的 viewport/composer 尺寸观测),桩替换;
 * next/navigation 的 usePathname 桩为 '/'(非 /chat,壳正常渲染)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MECHANISM_WORDS } from '@/lib/mechanism-words';

import { FloatingChat } from './floating-chat';
import {
  hangingSseResponse,
  jsonResponse,
  openChat,
  ResizeObserverStub,
  scriptedSseResponse,
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

describe('工作台 · step 活动语言(T24 Phase B)', () => {
  const finalFrame = (payload: Record<string, unknown>) => ({ type: 'final', payload });

  it('navigate 活动帧:主呈现为「正在读取 <合同标题>」,机器日志原文不露出,可点下钻事件流', async () => {
    const frames = [
      {
        type: 'step',
        message: { role: 'assistant', text: '导航到 articles' },
        rel: 'articles',
        activity: { op: 'navigate', title: '文章列表' },
        eventSeq: 42,
      },
      finalFrame({
        sessionId: 'sess-act-1',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'done',
        summary: '目标完成',
        steps: [],
        successes: [],
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('看文章列表');

    await waitFor(() => {
      expect(screen.getByText('正在读取 文章列表')).toBeTruthy();
    });
    // 机器日志原文不进主呈现(message.text 保留在帧内作机器层)。
    expect(screen.queryByText(/导航到 articles/)).toBeNull();
    // 审计下钻:活动为可点链接,目标含事件定位参数(afterSeq = eventSeq - 1,
    // 对应事件恰为返回首条)。
    const link = screen.getByRole('link', { name: '正在读取 文章列表' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/events?afterSeq=41');
    // 活动语言零机制词(呈现诚实化)。
    const label = link.textContent ?? '';
    expect(MECHANISM_WORDS.some((word) => label.includes(word))).toBe(false);
  });

  it('exec/present 活动帧:消费服务器合同标题与 subject', async () => {
    const frames = [
      {
        type: 'step',
        message: { role: 'assistant', text: '执行 next(article-drafting:main)' },
        rel: 'article-drafting:main',
        activity: { op: 'exec', title: '完成编辑' },
        eventSeq: 43,
      },
      {
        type: 'step',
        message: { role: 'assistant', text: '正在准备「文章列表」的呈现' },
        activity: { op: 'present', subject: '文章列表' },
        eventSeq: 44,
      },
      finalFrame({
        sessionId: 'sess-act-2',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'done',
        summary: '目标完成',
        steps: [],
        successes: [],
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('编辑正文并展示');

    await waitFor(() => {
      expect(screen.getByText('正在执行 完成编辑')).toBeTruthy();
    });
    expect(screen.getByText('正在准备「文章列表」的呈现')).toBeTruthy();
    expect(screen.queryByText(/执行 next\(article-drafting:main\)/)).toBeNull();
  });

  it('未知 op:中性回退并显式携带 op,不静默吞', async () => {
    const frames = [
      {
        type: 'step',
        message: { role: 'assistant', text: '机器原文' },
        activity: { op: 'frobnicate' },
        eventSeq: 7,
      },
      finalFrame({
        sessionId: 'sess-act-3',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'done',
        summary: '目标完成',
        steps: [],
        successes: [],
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('做点什么');

    await waitFor(() => {
      expect(screen.getByText('正在处理 · frobnicate')).toBeTruthy();
    });
    expect(screen.queryByText('机器原文')).toBeNull();
  });

  it('旧形状帧(无 activity):回退 message.text 中性显示,与既有口径一致', async () => {
    const frames = [
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' } },
      finalFrame({
        sessionId: 'sess-act-4',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'done',
        summary: '目标完成',
        steps: [],
        successes: [],
      }),
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
    // 旧形状不产活动链接(无定位信息,不伪造)。
    expect(screen.queryByRole('link', { name: /正在/ })).toBeNull();
  });

  it('活动帧缺 eventSeq:下钻链接仍可达(事件流页,不伪造定位)', async () => {
    const frames = [
      {
        type: 'step',
        message: { role: 'assistant', text: '导航到 articles' },
        activity: { op: 'navigate', title: '文章列表' },
      },
      finalFrame({
        sessionId: 'sess-act-5',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'done',
        summary: '目标完成',
        steps: [],
        successes: [],
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('看文章列表');

    const link = (await screen.findByRole('link', {
      name: '正在读取 文章列表',
    })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/events');
  });

  it('活动帧回合的终局内容不丢:answered 的回答经 final.summary 呈现', async () => {
    const frames = [
      {
        type: 'step',
        message: { role: 'assistant', text: '共 3 篇文章,其中 1 篇已发布' },
        activity: { op: 'answer' },
        eventSeq: 9,
      },
      finalFrame({
        sessionId: 'sess-act-6',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'answered',
        summary: '共 3 篇文章,其中 1 篇已发布',
        steps: [],
        successes: [],
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(frames))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('现在有几篇文章');

    // 活动条目为「正在整理回答」;回答本体经 final.summary 补一条(不丢内容)。
    await waitFor(() => {
      expect(screen.getByText('共 3 篇文章,其中 1 篇已发布')).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: '正在整理回答' })).toBeTruthy();
  });
});

describe('工作台 · 失败措辞分层(T24 Phase B Task 3)', () => {
  const failedFinal = (reason: Record<string, unknown> | undefined): unknown[] => [
    {
      type: 'step',
      message: { role: 'assistant', text: '导航到 articles' },
      rel: 'articles',
      activity: { op: 'navigate', title: '文章列表' },
    },
    {
      type: 'step',
      message: { role: 'assistant', text: '失败: 检测到无进展导航循环' },
      activity: { op: 'fail' },
    },
    {
      type: 'final',
      payload: {
        sessionId: 'sess-fail-layer',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'failed',
        summary: '检测到无进展导航循环;当前合同未暴露完成目标所需的可执行能力',
        ...(reason === undefined ? {} : { reason }),
        steps: [],
        successes: [],
      },
    },
  ];

  it('LLM 表述形状:phrasing 为主呈现 + 来源标注「助手表述」;机器叙句不进主呈现', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse(
            failedFinal({
              code: 'no_progress_loop',
              evidence: ['重复处境:articles', '可用动作:(无)'],
              tried: ['导航到 articles'],
              phrasing: '当前页面没有提供完成这个目标所需的操作入口。',
            }),
          ),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('当前页面没有提供完成这个目标所需的操作入口。')).toBeTruthy();
    });
    // 来源标注:助手表述(LLM 生成),零编造安慰语。
    expect(screen.getByText('助手表述')).toBeTruthy();
    // 服务器机器叙句(summary)不进主呈现(降级为机械层/审计数据)。
    expect(screen.queryByText(/检测到无进展导航循环/)).toBeNull();
  });

  it('中性降级形状:无 phrasing → 「失败 · code=… · 已尝试:…」,evidence 折叠在失败数据区', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse(
            failedFinal({
              code: 'no_progress_loop',
              evidence: ['重复处境:articles'],
              tried: ['导航到 articles'],
            }),
          ),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(
        screen.getByText('失败 · code=no_progress_loop · 已尝试:导航到 articles'),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/检测到无进展导航循环/)).toBeNull();
    // evidence 作为结构化数据可达(次级区域),不作主叙事。
    expect(screen.getByText('失败数据')).toBeTruthy();
    expect(screen.getByText('重复处境:articles')).toBeTruthy();
  });

  it('结构化数据可达形状:details 区呈现 code/已尝试/evidence 本体(审计视角)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse(
            failedFinal({
              code: 'driver_fail',
              evidence: ['LLM 调用失败: HTTP 401 令牌无效'],
              tried: ['导航到 articles'],
              phrasing: '助手模型暂时无法访问。',
            }),
          ),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('助手模型暂时无法访问。')).toBeTruthy();
    });
    // 即便有 LLM 表述,结构化本体仍可达:code/已尝试/evidence 行在失败数据区。
    expect(screen.getByText('失败数据')).toBeTruthy();
    expect(screen.getByText('code=driver_fail')).toBeTruthy();
    expect(screen.getByText('已尝试:导航到 articles')).toBeTruthy();
    expect(screen.getByText('LLM 调用失败: HTTP 401 令牌无效')).toBeTruthy();
  });

  it('旧形状前向兼容:final failed 无 reason → 现状中性回退「失败: {summary}」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse(failedFinal(undefined)))),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(
        screen.getByText('失败: 检测到无进展导航循环;当前合同未暴露完成目标所需的可执行能力'),
      ).toBeTruthy();
    });
  });

  it('error 帧携带 reason:中性结构化展示(code=loop_exception),旧形状仍回退原文', async () => {
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
    expect(screen.getByText('聊天循环异常: 爆炸')).toBeTruthy();
  });
});

describe('工作台 · 思考区(T11 Phase C / T24 Phase B)', () => {
  it('增量流入(T24):默认折叠为一条「思考中」进行中指示(含步数),展开后增量实时流入', async () => {
    // 流保持打开:thinking 增量流入时回合仍在进行,指示/实时性可逐帧断言。
    const scripted = scriptedSseResponse([{ type: 'thinking-delta', step: 1, text: '先补标题' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(scripted.response)),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    try {
      // 折叠指示:一条、紧凑、含步数;增量原文不露出(默认折叠)。
      const trigger = await screen.findByRole('button', { name: /思考中 · 第 1 步/ });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText(/先补标题/)).toBeNull();
      // 指示文案不得出现机制词(呈现诚实化:思考是人类语言,不是合同层词汇)。
      const label = trigger.textContent ?? '';
      expect(MECHANISM_WORDS.some((word) => label.includes(word))).toBe(false);

      // 展开:已累积增量可见 + aria-controls 指向真实内容节点(语义可达)。
      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      const controlsId = trigger.getAttribute('aria-controls');
      expect(controlsId).not.toBeNull();
      expect(document.getElementById(controlsId!)).not.toBeNull();
      await waitFor(() => {
        expect(screen.getByText('先补标题')).toBeTruthy();
      });

      // 展开态下新流入的增量实时呈现(不丢实时性;同号原地累积)。
      scripted.push({ type: 'thinking-delta', step: 1, text: ',再推进向导' });
      await waitFor(() => {
        expect(screen.getByText('先补标题,再推进向导')).toBeTruthy();
      });
      expect(screen.getAllByRole('button', { name: /思考中 · 第 1 步/ })).toHaveLength(1);

      // 同号 step 帧到达:该步思考完成,指示回落静止文案;展开态与文本保留。
      scripted.push({
        type: 'step',
        message: { role: 'assistant', text: '导航到 articles' },
        rel: 'articles',
      });
      await waitFor(() => {
        expect(screen.getByText('导航到 articles')).toBeTruthy();
      });
      const resting = screen.getByRole('button', { name: /思考 · 步骤 1/ });
      expect(resting.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('先补标题,再推进向导')).toBeTruthy();

      // 回合结束(final + 流关闭):思考区仍可展开查看,数据不丢。
      scripted.push({
        type: 'final',
        payload: {
          sessionId: 'sess-live-think',
          driver: 'llm',
          requestedDriver: 'auto',
          outcome: 'done',
          summary: '目标完成',
          steps: [],
          successes: [],
        },
      });
      scripted.close();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
      });
      expect(screen.getByRole('button', { name: /思考 · 步骤 1/ })).toBeTruthy();
      expect(screen.getByText('先补标题,再推进向导')).toBeTruthy();
    } finally {
      scripted.close();
    }
  });

  it('连续十回合的步骤 1 以 turnId 隔离，旧回合 reasoning 不被覆盖或迁移', async () => {
    const fetchMock = vi.fn((_url: string | URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        sessionId: string;
        turnId: string;
        goal: { verb: string };
      };
      const index = Number(body.goal.verb.replace('问题 ', ''));
      return Promise.resolve(
        sseResponse([
          { type: 'session', sessionId: body.sessionId, turnId: body.turnId },
          {
            type: 'thinking',
            turnId: body.turnId,
            step: 1,
            text: `第 ${index} 回合 reasoning`,
          },
          {
            type: 'step',
            turnId: body.turnId,
            message: { role: 'assistant', text: `第 ${index} 回合回答` },
          },
          {
            type: 'final',
            turnId: body.turnId,
            payload: {
              sessionId: body.sessionId,
              driver: 'llm',
              requestedDriver: 'auto',
              outcome: 'done',
              summary: `第 ${index} 回合回答`,
              steps: [],
              successes: [],
            },
          },
        ]),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();

    for (let index = 1; index <= 10; index += 1) {
      sendGoal(`问题 ${index}`);
      await waitFor(() => expect(screen.getByText(`第 ${index} 回合回答`)).toBeTruthy());
      await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeTruthy());
    }

    const thinking = screen.getAllByRole('button', { name: /思考 · 步骤 1/ });
    expect(thinking).toHaveLength(10);
    thinking.forEach((trigger) => fireEvent.click(trigger));
    for (let index = 1; index <= 10; index += 1) {
      expect(screen.getByText(`第 ${index} 回合 reasoning`)).toBeTruthy();
    }
  });

  it('thinking 帧:回合结束后渲染为默认收起的「思考」区,点击展开读全文、再点收起', async () => {
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
    // 回合结束(发送按钮回来 = 不再 running):进行中文案回落静止文案。
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /思考中/ })).toBeNull();
    // 默认收起(推理是次级信息):触发器在,正文未进 DOM;回合后仍可展开查看。
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

  it('丢弃显式属于其他 turnId 的迟到 render 回执，避免跨回合导航', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | RequestInfo, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { sessionId: string; turnId: string };
        return Promise.resolve(
          sseResponse([
            { type: 'session', sessionId: request.sessionId, turnId: request.turnId },
            {
              type: 'render',
              turnId: request.turnId,
              payload: {
                sessionId: request.sessionId,
                turnId: 'another-turn',
                driver: 'llm',
                requestedDriver: 'auto',
                outcome: 'done',
                summary: '错误回合的回执',
                messages: [{ role: 'assistant', text: '不应出现的回执' }],
                steps: [],
                successes: [],
                render: {
                  concern: 'wrong-turn',
                  spec: {},
                  frozenNow: true,
                  canvasUrl: '/canvas?concern=wrong-turn',
                },
              },
            },
          ]),
        );
      }),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('展示文章');

    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeTruthy());
    expect(screen.queryByText('不应出现的回执')).toBeNull();
    expect(screen.queryByRole('link', { name: /在画布查看/ })).toBeNull();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('思考区常在(T24 Phase B):无全局隐藏开关;旧 ui4a.chat.thinking 键失效不隐藏', async () => {
    // 旧开关退役后遗留的 '0'(原「关闭思考」)不再是任何读写的键:思考区
    // 默认折叠常在,不因遗留偏好被整体隐藏。
    window.localStorage.setItem('ui4a.chat.thinking', '0');
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

    // 全局思考开关已移除(折叠指示常在,无需整体隐藏);composer 只有委托开关。
    expect(screen.queryByRole('button', { name: '思考过程' })).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /思考 · 步骤 1/ })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
    });
    // 遗留 '0' 不隐藏:展开仍读得到全文。
    fireEvent.click(screen.getByRole('button', { name: /思考 · 步骤 1/ }));
    expect(screen.getByText('先补标题,再推进向导')).toBeTruthy();
  });
});
