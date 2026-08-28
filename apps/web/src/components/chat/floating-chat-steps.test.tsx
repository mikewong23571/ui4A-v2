// @vitest-environment jsdom
/**
 * assistant 工作台(悬浮聊天)——step 活动语言与失败措辞分层(T36 A2 自
 * floating-chat.test.tsx 按 feature 分片;委托/流式基础见 floating-chat.test.tsx,
 * 思考区见 floating-chat-thinking.test.tsx)。
 *
 * T24 Phase B:step 帧的进行中活动语言(无机制词、人话动作短语)与
 * 失败措辞分层(协议失败/工具失败的差异化呈现)。
 * jsdom 无 ResizeObserver(assistant-ui 的 viewport/composer 尺寸观测),桩替换;
 * next/navigation 的 usePathname 桩为 '/'(非 /chat,壳正常渲染)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MECHANISM_WORDS } from '@/lib/mechanism-words';

import { FloatingChat } from './floating-chat';
import { openChat, ResizeObserverStub, sendGoal, sseResponse } from './floating-chat-test-stubs';

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

  it('无 activity 的轨迹外补充说明帧(如 max-steps 说明):按机器原文中性显示,终局不双份', async () => {
    const frames = [
      { type: 'step', message: { role: 'assistant', text: '导航到 articles' } },
      finalFrame({
        sessionId: 'sess-act-4',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'done',
        summary: '导航到 articles',
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

    // 补充说明帧按机器原文直出(单一实现,不产活动链接、不伪造定位)。
    await waitFor(() => {
      expect(screen.getByText('导航到 articles')).toBeTruthy();
    });
    expect(screen.queryByRole('link', { name: /正在/ })).toBeNull();
    // 帧文本已含终局内容时 final.summary 不再补一条(避免双份呈现)。
    expect(screen.getAllByText('导航到 articles')).toHaveLength(1);
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
  const failedFinal = (reason: Record<string, unknown>): unknown[] => [
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
        reason,
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
});
