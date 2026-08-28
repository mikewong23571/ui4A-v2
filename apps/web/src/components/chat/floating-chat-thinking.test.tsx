// @vitest-environment jsdom
/**
 * assistant 工作台(悬浮聊天)——思考区与思考增量/渲染回执帧(T36 A2 自
 * floating-chat.test.tsx 按 feature 分片;委托/流式基础见 floating-chat.test.tsx,
 * step 活动语言/失败分层见 floating-chat-steps.test.tsx)。
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
