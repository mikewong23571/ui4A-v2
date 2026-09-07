// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FloatingChat } from '../floating-chat';
import {
  openChat,
  ResizeObserverStub,
  scriptedSseResponse,
  sendGoal,
} from '../floating-chat-test-stubs';
import { THREAD_UPDATED_EVENT } from '../../canvas/desk/thread-desk-shared';

vi.mock('next/navigation', () => ({
  usePathname: () => '/canvas',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: () => undefined }),
}));
const refreshed: string[] = [];
const onRefresh = (event: Event) => refreshed.push((event as CustomEvent<string>).detail);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollTo = () => undefined;
  window.history.replaceState({}, '', '/canvas?focus=thread%3Aoriginal&thread=original');
  refreshed.length = 0;
  window.addEventListener(THREAD_UPDATED_EVENT, onRefresh);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  window.removeEventListener(THREAD_UPDATED_EVENT, onRefresh);
});

it.each(['done', 'failed'] as const)(
  'refreshes the request-owned thread at acceptance and %s completion after navigation',
  async (outcome) => {
    const stream = scriptedSseResponse([]);
    let request:
      | { sessionId: string; turnId: string; clientView: { presence: { thread: string } } }
      | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        request = JSON.parse(String(init?.body));
        return stream.response;
      }),
    );
    try {
      render(<FloatingChat />);
      openChat();
      sendGoal('核对本线材料');
      await waitFor(() => expect(request).toBeDefined());
      expect(request!.clientView.presence.thread).toBe('original');
      window.history.replaceState({}, '', '/canvas?focus=thread%3Aother&thread=other');
      await act(async () => {
        stream.push({ type: 'session', sessionId: 'foreign', turnId: 'foreign' });
        stream.push({
          type: 'final',
          payload: {
            sessionId: 'foreign',
            turnId: 'foreign',
            outcome,
            summary: 'Not this request',
            steps: [],
          },
        });
      });
      expect(refreshed).toEqual([]);
      await act(async () =>
        stream.push({ type: 'session', sessionId: request!.sessionId, turnId: request!.turnId }),
      );
      await waitFor(() => expect(refreshed).toEqual(['thread:original']));
      await act(async () =>
        stream.push({
          type: 'final',
          payload: {
            sessionId: request!.sessionId,
            turnId: request!.turnId,
            outcome,
            summary: '回合结束',
            steps: [],
          },
        }),
      );
      await waitFor(() => expect(refreshed).toEqual(['thread:original', 'thread:original']));
      await act(async () => stream.close());
      expect(refreshed).toEqual(['thread:original', 'thread:original']);
    } finally {
      stream.close();
    }
  },
);

it('failed JSON requests reread canonical membership without inventing a successful mutation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'provider unavailable' }, { status: 503 })),
  );
  render(<FloatingChat />);
  openChat();
  sendGoal('会写入原问题但模型不可用');
  await waitFor(() => expect(refreshed).toEqual(['thread:original']));
});

it('does not assign an unlocated request to a thread opened while waiting', async () => {
  window.history.replaceState({}, '', '/canvas');
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  render(<FloatingChat />);
  openChat();
  sendGoal('没有选定工作线');
  await waitFor(() => expect(finish).toBeDefined());
  window.history.replaceState({}, '', '/canvas?thread=later');
  await act(async () => finish?.(Response.json({ messages: [{ text: '已回答' }] })));
  await screen.findByText('已回答');
  expect(refreshed).toEqual([]);
});
