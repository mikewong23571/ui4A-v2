// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { CitationList } from './citation-list';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('CitationList', () => {
  it('renders only strict structured FactRefs as accessible tail chips', () => {
    window.history.replaceState(
      {},
      '',
      '/entity?rel=articles&scope=publishing&thread=release-1&mode=raw',
    );
    render(
      <CitationList
        citations={[
          { rel: 'post:first-post', pointer: '/properties/fields/body' },
          { rel: 'post:first-post', pointer: '/properties/fields/body' },
          { rel: 'articles', pointer: '/properties/count' },
        ]}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('href')).toBe(
      '/canvas?focus=post%3Afirst-post&scope=publishing&thread=release-1',
    );
    expect(links[0]!.getAttribute('data-nav')).toBe('citation:post:first-post');
    expect(links[0]!.getAttribute('data-pointer')).toBe('/properties/fields/body');
    // G10:JSON Pointer 留给审计(title 属性),可见标签回退 rel(读取失败不猜名称)。
    expect(links[0]!.getAttribute('title')).toContain('/properties/fields/body');
    expect(screen.queryByText('/properties/fields/body')).toBeNull();
    expect(screen.getAllByText('post:first-post').length).toBeGreaterThan(0);
  });

  it('G10:授权实体的声明名称成为可点标签,rel 退为次要对照', async () => {
    window.history.replaceState({}, '', '/entity?rel=articles&scope=publishing');
    const fetchMock = vi.fn(async () =>
      Response.json({
        class: ['flow-instance'],
        properties: { rel: 'post:first-post', identity: '第一篇文章' },
        links: [],
        actions: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(
        <CitationList citations={[{ rel: 'post:first-post', pointer: '/properties/count' }]} />,
      );
      // 等待懒取完成(声明名称出现)。
      await waitFor(() => expect(screen.getByText('第一篇文章')).toBeTruthy());
      const link = screen.getByRole('link');
      expect(link.getAttribute('title')).toContain('/properties/count');
      expect(screen.getByText('post:first-post')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('derives current styling only from URL focus and overrides thread for thread targets', () => {
    window.history.replaceState(
      {},
      '',
      '/canvas?focus=thread%3Arelease-2&scope=publishing&thread=release-1&refresh=9',
    );
    render(
      <CitationList citations={[{ rel: 'thread:release-2', pointer: '/properties/status' }]} />,
    );

    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-current')).toBe('location');
    expect(link.getAttribute('href')).toBe(
      '/canvas?focus=thread%3Arelease-2&scope=publishing&thread=release-2',
    );
  });

  it('fails closed for malformed metadata instead of inventing a citation', () => {
    const { container } = render(
      <CitationList citations={[{ rel: 'post:ghost', pointer: 'not-a-json-pointer' }] as never} />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
