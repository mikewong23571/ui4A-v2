// @vitest-environment jsdom
/**
 * page-links 词条测试(T38 FR2/FR5):集合分页脚——只渲染合同声明的 next/prev
 * 页链接(「上一页/下一页」式);零页码推算、零页大小常量、零 exec;点击 =
 * 导航到链接对应的带参画布查询(URL query 同步,scope/thread 保留);无声明
 * 链接 → 隐藏节段,零零件。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenLink } from '@ui4a/engine';

import { collectionQueryNavigation } from '../canvas/collection-query';
import { PageLinksWord } from './page-links';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/canvas');
});

function linksOf(entries: Array<{ rel: string[]; href: string }>): SirenLink[] {
  return entries.map((entry) => ({ rel: entry.rel, href: entry.href }));
}

function renderLinks(links: SirenLink[]): ReturnType<typeof render> {
  return render(<PageLinksWord links={links} />);
}

describe('page-links 词条', () => {
  it('声明 next/prev 链接 → 分页脚只渲染声明的「上一页/下一页」控制(零页码推算)', () => {
    renderLinks(
      linksOf([
        { rel: ['self'], href: '/api/entity?rel=articles&offset=20' },
        { rel: ['prev'], href: '/api/entity?rel=articles&offset=0' },
        { rel: ['next'], href: '/api/entity?rel=articles&offset=40' },
      ]),
    );

    expect(screen.getByRole('navigation', { name: '分页' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一页' })).toBeTruthy();
    // 零页码列表、零页尺寸选择(传统分页组件按 §六 判据退回)。
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('只声明 next → 无上一页(诚实缺链)', () => {
    renderLinks(
      linksOf([
        { rel: ['self'], href: '/api/entity?rel=articles&offset=0' },
        { rel: ['next'], href: '/api/entity?rel=articles&offset=20' },
      ]),
    );
    expect(screen.queryByRole('button', { name: '上一页' })).toBeNull();
    expect(screen.getByRole('button', { name: '下一页' })).toBeTruthy();
  });

  it('无声明分页链接 → 隐藏节段,零零件', () => {
    const { container } = renderLinks(
      linksOf([{ rel: ['self'], href: '/api/entity?rel=articles' }]),
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-word="page-links"]')?.className).toContain('hidden');
  });

  it('点击下一页 → 导航到声明链接对应的带参画布查询(scope 保留)', () => {
    window.history.pushState({}, '', '/canvas?focus=workspace%3Aapp%3Apublishing&scope=publishing');
    const assign = vi.fn();
    const original = collectionQueryNavigation.assign;
    collectionQueryNavigation.assign = assign;
    try {
      renderLinks(
        linksOf([
          { rel: ['self'], href: '/api/entity?rel=articles&offset=0' },
          { rel: ['next'], href: '/api/entity?rel=articles&offset=20&filter.status=pending' },
        ]),
      );
      fireEvent.click(screen.getByRole('button', { name: '下一页' }));
      expect(assign).toHaveBeenCalledWith(
        `/canvas?focus=${encodeURIComponent('articles')}&offset=20&filter.status=pending&scope=publishing`,
      );
    } finally {
      collectionQueryNavigation.assign = original;
    }
  });

  it('点击上一页 → 回到声明链接对应的 offset(过滤参数随链接保留)', () => {
    window.history.pushState({}, '', '/canvas?focus=comments&offset=20&filter.status=pending');
    const assign = vi.fn();
    const original = collectionQueryNavigation.assign;
    collectionQueryNavigation.assign = assign;
    try {
      renderLinks(
        linksOf([
          { rel: ['self'], href: '/api/entity?rel=comments&offset=20&filter.status=pending' },
          { rel: ['prev'], href: '/api/entity?rel=comments&offset=0&filter.status=pending' },
        ]),
      );
      fireEvent.click(screen.getByRole('button', { name: '上一页' }));
      expect(assign).toHaveBeenCalledWith(
        `/canvas?focus=${encodeURIComponent('comments')}&offset=0&filter.status=pending`,
      );
    } finally {
      collectionQueryNavigation.assign = original;
    }
  });

  it('声明链接无 rel 可导航 → 点击诚实不动,零发明', () => {
    const assign = vi.fn();
    const original = collectionQueryNavigation.assign;
    collectionQueryNavigation.assign = assign;
    try {
      renderLinks(
        linksOf([
          { rel: ['self'], href: '/api/entity?rel=articles&offset=0' },
          { rel: ['next'], href: '/somewhere/else' },
        ]),
      );
      fireEvent.click(screen.getByRole('button', { name: '下一页' }));
      expect(assign).not.toHaveBeenCalled();
    } finally {
      collectionQueryNavigation.assign = original;
    }
  });
});
