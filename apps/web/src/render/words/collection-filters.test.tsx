// @vitest-environment jsdom
/**
 * collection-filters 词条测试(T38 FR3/FR5):仅声明维度渲染过滤控件(维度
 * 标题与值域标签全部来自声明数据,零 per-app 文案);值变更 → 导航到带参画布
 * 查询(scope 保留,翻页参数复位);清除回全量(URL 同步清空);永不 exec。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenLink } from '@ui4a/engine';

import { collectionQueryNavigation } from '../canvas/collection-query';
import { CollectionFiltersWord } from './collection-filters';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/canvas');
});

const declarations = [
  {
    field: 'status',
    title: '状态',
    values: [
      { value: 'pending', title: '待处理' },
      { value: 'approved', title: '已通过' },
    ],
  },
];

function linksOf(entries: Array<{ rel: string[]; href: string }>): SirenLink[] {
  return entries.map((entry) => ({ rel: entry.rel, href: entry.href }));
}

function stubAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  const original = collectionQueryNavigation.assign;
  collectionQueryNavigation.assign = assign;
  afterEach(() => {
    collectionQueryNavigation.assign = original;
  });
  return assign;
}

describe('collection-filters 词条', () => {
  it('声明维度 → 控件按声明渲染(标题=声明 title,选项=声明值域;零发明文案)', () => {
    render(
      <CollectionFiltersWord
        declarations={declarations}
        links={linksOf([{ rel: ['self'], href: '/api/entity?rel=comments&offset=0' }])}
      />,
    );

    expect(screen.getByRole('region', { name: '过滤' })).toBeTruthy();
    expect(screen.getByText('状态')).toBeTruthy();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const labels = [...select.options].map((option) => option.textContent);
    expect(labels).toEqual(['全部', '待处理', '已通过']);
    expect([...select.options].map((option) => option.value)).toEqual(['', 'pending', 'approved']);
    expect(select.value).toBe('');
  });

  it('值变更 → 导航到带参画布查询(focus 落到集合,scope 保留,翻页复位)', () => {
    window.history.pushState({}, '', '/canvas?scope=community&focus=workspace%3Aapp%3Acommunity');
    const assign = stubAssign();
    render(
      <CollectionFiltersWord
        declarations={declarations}
        links={linksOf([{ rel: ['self'], href: '/api/entity?rel=comments&offset=0' }])}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pending' } });
    expect(assign).toHaveBeenCalledWith(
      `/canvas?focus=${encodeURIComponent('comments')}&filter.status=pending&scope=community`,
    );
  });

  it('当前过滤状态来自合同 self 链接(刷新/回放后控件如实回显)', () => {
    render(
      <CollectionFiltersWord
        declarations={declarations}
        links={linksOf([
          { rel: ['self'], href: '/api/entity?rel=comments&offset=0&filter.status=pending' },
        ])}
      />,
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('pending');
  });

  it('清除(选「全部」)→ 过滤参数移除,URL 同步清空,回全量读', () => {
    window.history.pushState({}, '', '/canvas?focus=comments&filter.status=pending&offset=20');
    const assign = stubAssign();
    render(
      <CollectionFiltersWord
        declarations={declarations}
        links={linksOf([
          { rel: ['self'], href: '/api/entity?rel=comments&offset=20&filter.status=pending' },
        ])}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(assign).toHaveBeenCalledWith(`/canvas?focus=${encodeURIComponent('comments')}`);
  });

  it('多维度组合:变更一个维度保留其余维度(合同 self 链接携带的当前状态)', () => {
    const multi = [
      ...declarations,
      {
        field: 'kind',
        title: '种类',
        values: [{ value: 'question', title: '提问' }],
      },
    ];
    window.history.pushState({}, '', '/canvas?focus=comments&filter.status=pending');
    const assign = stubAssign();
    render(
      <CollectionFiltersWord
        declarations={multi}
        links={linksOf([
          {
            rel: ['self'],
            href: '/api/entity?rel=comments&offset=0&filter.status=pending&filter.kind=question',
          },
        ])}
      />,
    );

    fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: '' } });
    expect(assign).toHaveBeenCalledWith(
      `/canvas?focus=${encodeURIComponent('comments')}&filter.status=pending`,
    );
  });

  it('未声明维度(declarations 缺省)→ 隐藏节段,零零件', () => {
    const { container } = render(
      <CollectionFiltersWord
        links={linksOf([{ rel: ['self'], href: '/api/entity?rel=articles' }])}
      />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(container.querySelector('[data-word="collection-filters"]')?.className).toContain(
      'hidden',
    );
  });
});
