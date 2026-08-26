// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FloatingChat } from './floating-chat';
import {
  openChat,
  jsonResponse,
  ResizeObserverStub,
  sendGoal,
  sseResponse,
} from './floating-chat-test-stubs';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn() }),
}));

class StorageStub implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const localStorageStub = new StorageStub();

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageStub);
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollTo = () => undefined;
});

afterEach(() => {
  cleanup();
  localStorageStub.clear();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('renders live final.sources as tail citations and never parses rel-looking answer text', async () => {
  window.history.replaceState({}, '', '/?scope=publishing&thread=release-1');
  const frames = [
    {
      type: 'step',
      message: { role: 'assistant', text: 'post:ghost 只是回答正文，不是引用。' },
      activity: { op: 'answer' },
    },
    {
      type: 'final',
      payload: {
        sessionId: 'sess-citations-live',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'answered',
        summary: 'post:ghost 只是回答正文，不是引用。',
        steps: [],
        successes: [],
        sources: [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
      },
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(sseResponse(frames))),
  );

  render(<FloatingChat />);
  openChat();
  sendGoal('总结第一篇');

  const citation = await screen.findByRole('link', { name: /post:first-post/ });
  expect(citation.getAttribute('data-nav')).toBe('citation:post:first-post');
  expect(citation.getAttribute('href')).toBe(
    '/canvas?focus=post%3Afirst-post&scope=publishing&thread=release-1',
  );
  expect(document.querySelector('[data-nav="citation:post:ghost"]')).toBeNull();
});

it('attaches final.sources to a terminal machine-text answer without duplicating its summary', async () => {
  const answer = 'machine-text answer';
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        sseResponse([
          { type: 'step', message: { role: 'assistant', text: answer } },
          {
            type: 'final',
            payload: {
              sessionId: 'e2e-citations-machine-text',
              driver: 'llm',
              requestedDriver: 'auto',
              outcome: 'answered',
              summary: answer,
              steps: [],
              successes: [],
              sources: [{ rel: 'articles', pointer: '/properties/count' }],
            },
          },
        ]),
      ),
    ),
  );

  render(<FloatingChat />);
  openChat();
  sendGoal('现在有几篇');

  expect(await screen.findByRole('link', { name: /articles/ })).toBeTruthy();
  expect(screen.getAllByText(answer)).toHaveLength(1);
});

it('restores history citations joined to the answered turn', async () => {
  localStorageStub.setItem('ui4a.chat.sessionId', 'sess-citations-history');
  window.history.replaceState({}, '', '/?scope=publishing&thread=release-1');
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          turns: [
            {
              seq: 9,
              ts: '2026-08-26T00:00:00.000Z',
              sessionId: 'sess-citations-history',
              turnId: 'turn-cited',
              goal: { verb: '总结第一篇' },
              outcome: 'answered',
              status: 'final',
              summary: '这是第一篇。',
              messages: [{ role: 'assistant', text: '这是第一篇。' }],
              steps: [],
              citations: [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
              driver: 'llm',
            },
          ],
        }),
      ),
    ),
  );

  render(<FloatingChat />);
  openChat();

  const citation = await screen.findByRole('link', { name: /post:first-post/ });
  expect(citation.getAttribute('href')).toBe(
    '/canvas?focus=post%3Afirst-post&scope=publishing&thread=release-1',
  );
});
