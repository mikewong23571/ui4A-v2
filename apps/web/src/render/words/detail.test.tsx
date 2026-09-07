// @vitest-environment jsdom
/**
 * detail 词条组件测试(T7 Phase B):给 deref 输出(实体引用)→ 详情卡:
 * properties/actions/links 四件组装直出;动作走 ActionRunner(data-action)。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionSubmitProvider, type ActionSubmit } from '@/components/actions/action-submit';

import { derefSpec } from '../deref';

import { articlesCollection, specOf } from './fixtures';
import { DetailWord } from './detail';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

const submit: ActionSubmit = vi.fn();

function detailEntity(): ReturnType<typeof articlesCollection> {
  return {
    class: ['flow-instance', 'post-status'],
    properties: {
      rel: 'post:post-welcome',
      node: 'published',
      title: '已发布',
      fields: { title: '欢迎来到 UI4A', category: 'tech' },
    },
    actions: [
      {
        name: 'unpublish',
        title: '下线',
        method: 'POST',
        href: '/api/exec',
        fields: { type: 'object', properties: {} },
      },
    ],
    links: [{ rel: ['collection'], href: '/api/entity?rel=articles' }],
    'guard-results': [],
  };
}

describe('detail 词条', () => {
  it('deref 输出 → 详情卡:属性/字段/链接/动作直出', async () => {
    const cache = new Map([['post:post-welcome', detailEntity()]]);
    const props = derefSpec(
      specOf('detail', { entity: { ref: 'entity:post:post-welcome' } }),
      cache,
    );
    const { container } = render(
      <ActionSubmitProvider submit={submit}>
        <DetailWord {...props} />
      </ActionSubmitProvider>,
    );

    const view = container.querySelector('[data-word="detail"]');
    expect(view).not.toBeNull();
    // properties 直出(rel/node + 扁平 fields 行)
    expect(screen.getByText('post:post-welcome')).toBeTruthy();
    expect(screen.getByText('published')).toBeTruthy();
    expect(screen.getByText(/欢迎来到 UI4A/)).toBeTruthy();
    // 链接(合同 href → 页面路由)
    expect(screen.getByText('articles')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'articles' }).getAttribute('href')).toBe(
      '/entity?rel=articles',
    );
    // 动作(ActionRunner,data-action 标注)
    expect(await screen.findByRole('button', { name: '下线' })).toBeTruthy();
    expect(container.querySelector('[data-action="unpublish"]')).not.toBeNull();
  });

  it('entity 非实体 → 响亮抛错', () => {
    expect(() => render(<DetailWord entity="post:post-welcome" />)).toThrow(/detail 的 entity/);
  });

  it('actions/links 语义模式只呈现对应交互，不重复原始属性表', async () => {
    const { container, rerender } = render(
      <ActionSubmitProvider submit={submit}>
        <DetailWord entity={detailEntity()} mode="actions" />
      </ActionSubmitProvider>,
    );
    expect(await screen.findByRole('button', { name: '下线' })).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
    expect(screen.queryByText('articles')).toBeNull();

    rerender(
      <ActionSubmitProvider submit={submit}>
        <DetailWord entity={detailEntity()} mode="links" />
      </ActionSubmitProvider>,
    );
    expect(screen.getByText('articles')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '下线' })).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('F-06:链接锚文本优先 flow title,机械 rel 标签不作首屏主文案', () => {
    const entity = detailEntity();
    entity.links = [
      { rel: ['collection'], href: '/api/entity?rel=articles' },
      { rel: ['flow'], href: '/api/entity?rel=flow%3Atodo-capture', title: '待办捕捉' },
    ];
    render(
      <ActionSubmitProvider submit={submit}>
        <DetailWord entity={entity} mode="links" />
      </ActionSubmitProvider>,
    );
    expect(screen.getByText('待办捕捉')).toBeTruthy();
    expect(screen.queryByText('collection')).toBeNull();
    expect(screen.queryByText('flow')).toBeNull();
  });

  it('links mode stays on the workspace, preserves context, and keeps meta and external destinations distinct', () => {
    window.history.replaceState(
      {},
      '',
      '/canvas?scope=publishing&thread=review&returnTo=%2Fthreads&focus=threads-current',
    );
    const entity = detailEntity();
    entity.links = [
      { rel: ['collection'], href: '/api/entity?rel=threads', title: '全部工作线' },
      { rel: ['related'], href: '/api/entity?rel=thread%3Aother', title: '另一条线' },
      { rel: ['related'], href: '/_meta/api/entity?rel=meta%2Fflow%3Areview', title: '治理定义' },
      { rel: ['related'], href: '/api/entity?rel=draft%3Achange', title: '草稿' },
      { rel: ['help'], href: 'https://docs.example/api/entity?rel=external', title: '外部说明' },
    ];
    render(<DetailWord entity={entity} mode="links" />);
    expect(screen.getByRole('link', { name: '全部工作线' }).getAttribute('href')).toBe(
      '/canvas?focus=threads&scope=publishing&thread=review&returnTo=%2Fthreads',
    );
    expect(screen.getByRole('link', { name: '另一条线' }).getAttribute('href')).toBe(
      '/canvas?focus=thread%3Aother&scope=publishing&thread=other&returnTo=%2Fthreads',
    );
    expect(screen.getByRole('link', { name: '治理定义' }).getAttribute('href')).toBe(
      '/meta/entity?rel=meta%2Fflow%3Areview&scope=publishing&thread=review&returnTo=%2Fthreads',
    );
    expect(screen.getByRole('link', { name: '草稿' }).getAttribute('href')).toBe(
      '/meta/entity?rel=draft%3Achange&scope=publishing&thread=review&returnTo=%2Fthreads',
    );
    expect(screen.getByRole('link', { name: '外部说明' }).getAttribute('href')).toBe(
      'https://docs.example/api/entity?rel=external',
    );
  });
});

it('keeps named sources visible and moves unlabeled contract references into a closed disclosure', () => {
  const entity = detailEntity();
  entity.links = [
    { rel: ['source'], href: '/api/entity?rel=source%3Aone', title: '创建时的目标原文' },
    { rel: ['context'], href: '/api/entity?rel=message%3Along-id' },
  ];
  const { container } = render(<DetailWord entity={entity} mode="links" />);
  expect(screen.getByRole('link', { name: '创建时的目标原文' })).toBeTruthy();
  const disclosure = container.querySelector('details')!;
  expect(disclosure).not.toBeNull();
  expect(disclosure.open).toBe(false);
  expect(disclosure.contains(screen.getByText('message:long-id'))).toBe(true);
  fireEvent.click(screen.getByText('合同引用（1）'));
  expect(disclosure.open).toBe(true);
});
