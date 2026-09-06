// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeEntry } from '../../stage/home-entry';
import { ResizeObserverStub } from '../floating-chat-test-stubs';
import { FloatingChat } from './floating-chat';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn() }),
}));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('fetch', vi.fn());
  Element.prototype.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});
function Fixture({ entry = true }: { entry?: boolean }) {
  return (
    <>
      {entry && <HomeEntry />}
      <FloatingChat />
    </>
  );
}

it.each(['button', 'escape'])('returns focus to the home opener after %s close', (close) => {
  render(<Fixture />);
  const opener = screen.getByRole('button', { name: '与助手讨论' });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('button', { name: '收起聊天窗' })).toBeTruthy();
  if (close === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
  else fireEvent.click(screen.getByRole('button', { name: '收起聊天窗' }));
  expect(document.activeElement).toBe(opener);
  expect(fetch).not.toHaveBeenCalled();
});
it('falls back to the floating opener when the original home entry has unmounted', () => {
  const { rerender } = render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '与助手讨论' }));
  rerender(<Fixture entry={false} />);
  fireEvent.click(screen.getByRole('button', { name: '收起聊天窗' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开聊天窗' }));
});
it('a later floating-button open does not restore the previous home opener', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '与助手讨论' }));
  fireEvent.click(screen.getByRole('button', { name: '收起聊天窗' }));
  fireEvent.click(screen.getByRole('button', { name: '展开聊天窗' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开聊天窗' }));
});
