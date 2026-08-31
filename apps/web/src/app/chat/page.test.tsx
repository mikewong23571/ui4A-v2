// @vitest-environment jsdom
/**
 * /chat 独立窗口页的导航纪律(T40 S6 / F-11):
 *
 * window 态下会话即页面——assistant 的 navigate/exec focus 帧只更新底部
 * 「当前查看」入口链接,不得 router.push 把整页拽去画布(那会销毁会话
 * 上下文,S6 追问"你刚才做了什么"无从谈起);float/sidebar 态的跟随
 * 跳转由 floating-chat-session.test.tsx 既有用例钉住,不受影响。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatPage from './page';
import {
  jsonResponse,
  ResizeObserverStub,
  sseResponse,
} from '@/components/chat/floating-chat-test-stubs';

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/chat',
  useRouter: () => ({ push: routerPushMock }),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollTo = () => undefined;
  routerPushMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/chat');
  vi.restoreAllMocks();
});

describe('/chat window 态:focus 帧不夺主(T40 F-11)', () => {
  it('SSE focus 帧只留「当前查看」入口链接,不把 /chat 页面导航走', async () => {
    const canvasUrl = '/canvas?focus=flow%3Atodo-capture';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | RequestInfo, init?: RequestInit) => {
        if (String(url).includes('/api/chat/history')) {
          return Promise.resolve(jsonResponse({ turns: [] }));
        }
        if (init?.method === 'POST' || String(url).includes('/api/chat')) {
          return Promise.resolve(
            // 帧不带 turnId:客户端自行生成回合 turnId,显式异号帧会被丢弃
            // (迟到帧防护);本用例构造的是「本回合」帧,与既有 SSE 用例同口径。
            sseResponse([
              { type: 'session', sessionId: 'sess-window' },
              { type: 'focus', rel: 'flow:todo-capture' },
              {
                type: 'step',
                rel: 'flow:todo-capture',
                message: { role: 'assistant', text: '导航到 待办捕捉' },
                activity: { op: 'navigate', title: '待办捕捉' },
              },
              {
                type: 'final',
                payload: {
                  sessionId: 'sess-window',
                  driver: 'llm',
                  requestedDriver: 'auto',
                  outcome: 'answered',
                  summary: '已转到待办捕捉。',
                  steps: [],
                  successes: [],
                },
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse({ error: '未预期请求' }));
      }),
    );

    render(<ChatPage />);
    const input = await screen.findByPlaceholderText('输入目标…');
    fireEvent.change(input, { target: { value: '帮我添加一个待办' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    // 回合内容照常落地,入口链接在场……
    await waitFor(() => expect(screen.getByText('已转到待办捕捉。')).toBeTruthy());
    const link = screen.getByRole('link', { name: /当前查看:flow:todo-capture/ });
    expect(link.getAttribute('href')).toBe(canvasUrl);
    // ……但页面不被拽走:window 态零编程式导航。
    expect(routerPushMock).not.toHaveBeenCalled();
    // 会话仍可继续(输入框在场可用)。
    expect(screen.getByPlaceholderText('输入目标…')).toBeTruthy();
  });
});
