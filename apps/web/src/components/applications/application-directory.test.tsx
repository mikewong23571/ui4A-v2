// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationDirectory } from './application-directory';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

const apps = Array.from({ length: 30 }, (_, index) => ({
  name: `future-${index}`,
  title: `未来应用 ${index}`,
  intent: `用途说明 ${index}`,
}));

function respond(applications: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ applications }))));
}

describe('ApplicationDirectory', () => {
  it('shows all 30 applications and filters without changing membership or landing context', async () => {
    window.history.replaceState(
      {},
      '',
      '/applications?scope=old&thread=release-1&returnTo=%2Fthreads',
    );
    respond(apps);
    render(<ApplicationDirectory />);
    const list = await screen.findByRole('list', { name: '应用目录' });
    expect(within(list).getAllByRole('link')).toHaveLength(30);
    expect(screen.getByText('用途说明 29')).toBeTruthy();
    const input = screen.getByRole('searchbox', { name: '搜索应用' });
    fireEvent.change(input, { target: { value: 'future-29' } });
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByRole('link').getAttribute('href')).toBe(
      '/canvas?scope=future-29&focus=workspace%3Aapp%3Afuture-29&thread=release-1&returnTo=%2Fthreads',
    );
    fireEvent.change(input, { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的应用。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(
      within(screen.getByRole('list', { name: '应用目录' })).getAllByRole('link'),
    ).toHaveLength(30);
  });

  it('keeps system-fallback and malformed presentation out of the directory', async () => {
    respond([
      apps[0],
      { ...apps[1], presentation: { version: 1, traits: ['system-fallback'] } },
      { ...apps[2], presentation: { version: 1, traits: ['invented-trait'] } },
    ]);
    render(<ApplicationDirectory />);
    const list = await screen.findByRole('list', { name: '应用目录' });
    expect(within(list).getAllByRole('link')).toHaveLength(1);
  });

  it('distinguishes empty data from failed reads and supports retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applications: [] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<ApplicationDirectory />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('暂无可用应用。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无可用应用。')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
