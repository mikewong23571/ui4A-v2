// @vitest-environment jsdom
/**
 * T56 P2.1:聊天存续契约(S3 探针 §2 存续矩阵/§4 键盘、§6 唯一拥有者定案;
 * design §1 覆盖层交互/spec FR4·FR7/US05·US12)。GR3 注意:components/chat
 * 目录 3937/4000 贴限,本文件控制在剩余预算内。
 *
 * - Red:悬浮面板无 Escape 关闭、收起后无焦点恢复(S3 §4 实测缺失;P2.2 补齐)。
 * - PASS 钉住(防 P2.2 回归):收起→重开的 ChatPanel 重挂不丢未发送草稿
 *   (拥有者 = FloatingChat 内 useChatSession,S3 §6;float⇄sidebar 同机制,
 *   E2E 覆盖);FloatingChat 与
 *   /chat 独立页两实例经 localStorage 采纳同一 sessionId(D68:sessionId 只是
 *   分组键,服务端日志是真相)。mock 口径同 floating-chat-session.test。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import ChatPage from '@/app/chat/page';

import { FloatingChat } from './floating-chat';
import { jsonResponse, openChat, ResizeObserverStub, sendGoal } from './floating-chat-test-stubs';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined }),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollTo = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it('悬浮面板上按 Escape 关闭助手(Red:覆盖层 Escape 交互缺失,design §1)', () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<FloatingChat />);
  openChat();
  fireEvent.keyDown(screen.getByPlaceholderText('输入目标…'), { key: 'Escape' });
  expect(screen.queryByPlaceholderText('输入目标…')).toBeNull();
});

it('收起面板后焦点恢复到唤起元素 FAB(Red:焦点落 body 无恢复,design §1)', () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<FloatingChat />);
  openChat();
  fireEvent.click(screen.getByRole('button', { name: '收起聊天窗' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开聊天窗' }));
});

it('收起再展开(面板重挂)不丢未发送草稿(现状即绿,钉住 FR7/S3 §2)', () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<FloatingChat />);
  openChat();
  const composer = () => screen.getByPlaceholderText('输入目标…') as HTMLTextAreaElement;
  fireEvent.change(composer(), { target: { value: '未发送草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '收起聊天窗' }));
  openChat();
  expect(composer().value).toBe('未发送草稿');
});

it('FloatingChat 与 /chat 独立页实例共享 localStorage sessionId(D68;S3 §6 现状钉住)', async () => {
  // 回显请求 sessionId(真实服务端语义);history 空回合,零其他端点。
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { sessionId?: string };
      if (body.sessionId === undefined) {
        return Promise.resolve(jsonResponse({ turns: [] })); // GET history(无 body)
      }
      return Promise.resolve(jsonResponse({ sessionId: body.sessionId }));
    }),
  );
  const workstation = render(<FloatingChat />);
  openChat();
  sendGoal('第一实例提问');
  await waitFor(() => expect(window.localStorage.getItem('ui4a.chat.sessionId')).toBeTruthy());
  const shared = window.localStorage.getItem('ui4a.chat.sessionId') ?? '';
  workstation.unmount();
  render(<ChatPage />);
  // /chat 独立页 = 第二宿主:挂载即经 localStorage 采纳同一会话标识(头显同 id8)。
  await waitFor(() => expect(screen.getByText(`会话 ${shared.slice(0, 8)}`)).toBeTruthy());
});
