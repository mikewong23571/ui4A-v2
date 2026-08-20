// @vitest-environment jsdom
/**
 * :form runner 组件测试(T2 Phase F / Task F1,arch-brief §7、§11 铁律 3)。
 *
 * 覆盖 spec FR8 的人类路径合同面:
 * - actions[] 有 fields → RJSF 表单(text/select/textarea 三控件);无 fields → 按钮;
 * - 提交统一走 POST /api/exec(actor=human, principal=local-user, channel=renderer);
 * - 拒绝如实呈现(layer/reason),成功回调刷新;
 * - guard-results 的谓词投影:blocked → 按钮 disabled + title 显原因;
 * - 铁律 3 组件级断言:渲染出的 form/button 全部映射已声明 action,零合同外可提交元素;
 * - links[]/entities[] 渲染为 renderer 导航链接(/entity?rel=…)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from './action-runner';
import { EntityView } from './entity-view';

// ---- fixtures(形状与 /api/entity 的 Siren 投影一致)-------------------------

const publishAction: SirenAction = {
  name: 'publish',
  title: '发布',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题' },
      category: { type: 'string', title: '分类', enum: ['tech', 'essay', 'review'] },
      body: { type: 'string', title: '正文', format: 'textarea' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  },
};

const resetAction: SirenAction = {
  name: 'reset',
  title: '重置',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const wizardEntity: SirenEntity = {
  class: ['flow-instance', 'article-drafting'],
  properties: {
    rel: 'article-drafting:main',
    flow: 'article-drafting',
    node: 'ready',
    title: '就绪',
    fields: { title: { value: '草稿标题', origin: 'intent' } },
  },
  actions: [publishAction, resetAction],
  links: [
    { rel: ['self'], href: '/api/entity?rel=article-drafting:main' },
    { rel: ['collection'], href: '/api/entity?rel=articles' },
    { rel: ['flow'], href: '/api/entity?rel=flow:article-drafting' },
  ],
  'guard-results': [
    { action: 'publish', blocked: false, guards: [] },
    { action: 'reset', blocked: true, reason: 'guard 不满足: is-pending=false', guards: [] },
  ],
};

const articlesEntity: SirenEntity = {
  class: ['collection', 'articles'],
  properties: { rel: 'articles', count: 2 },
  actions: [],
  links: [
    { rel: ['self'], href: '/api/entity?rel=articles' },
    { rel: ['flow'], href: '/api/entity?rel=flow:article-drafting' },
  ],
  'guard-results': [],
  entities: [
    {
      class: ['flow-instance', 'post-status'],
      rel: ['item'],
      href: '/api/entity?rel=post:post-welcome',
      properties: {
        rel: 'post:post-welcome',
        node: 'published',
        title: '已发布',
        fields: { title: { value: '欢迎来到 UI4A', origin: 'default' } },
      },
      actions: [],
      links: [],
    },
  ],
};

// ---- harness -----------------------------------------------------------------

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- ActionRunner --------------------------------------------------------------

describe('ActionRunner:actions → RJSF 表单/按钮', () => {
  it('有 fields → RJSF 表单逐字段渲染(text 输入框、enum 下拉、textarea 文本域)', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(<ActionRunner rel="article-drafting:main" action={publishAction} />);

    expect(screen.getByLabelText(/标题/)).toBeTruthy();
    const category = screen.getByLabelText(/分类/) as HTMLSelectElement;
    expect(category.tagName).toBe('SELECT');
    // RJSF 缺省 indexed 编码:option value=索引,label=枚举值(解码回真实值)
    expect([...category.options].map((option) => option.label)).toEqual(
      expect.arrayContaining(['tech', 'essay', 'review']),
    );
    expect((screen.getByLabelText(/正文/) as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: '发布' })).toBeTruthy();
  });

  it('无 fields → 渲染按钮而非表单', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    const { container } = render(<ActionRunner rel="article-drafting:main" action={resetAction} />);

    expect(screen.getByRole('button', { name: '重置' })).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
  });

  it('提交走 /api/exec:actor=human, principal=local-user, channel=renderer', async () => {
    const fetchMock = mockFetch(200, { entity: wizardEntity });
    vi.stubGlobal('fetch', fetchMock);
    const onExecuted = vi.fn();
    render(
      <ActionRunner rel="article-drafting:main" action={publishAction} onExecuted={onExecuted} />,
    );

    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '第三篇' } });
    // indexed 编码:DOM value 是索引 0,formData 解码回 'tech'
    fireEvent.change(screen.getByLabelText(/分类/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/正文/), { target: { value: '正文内容' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/exec');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: '第三篇', category: 'tech', body: '正文内容' },
      actor: 'human',
      principal: 'local-user',
      channel: 'renderer',
    });
    await waitFor(() => expect(onExecuted).toHaveBeenCalled());
  });

  it('按钮(无 fields)提交同样走 /api/exec 并带固定身份', async () => {
    const fetchMock = mockFetch(200, { entity: wizardEntity });
    vi.stubGlobal('fetch', fetchMock);
    render(<ActionRunner rel="post:post-welcome" action={resetAction} />);

    fireEvent.click(screen.getByRole('button', { name: '重置' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1]!.body))).toEqual(
      {
        rel: 'post:post-welcome',
        action: 'reset',
        actor: 'human',
        principal: 'local-user',
        channel: 'renderer',
      },
    );
  });

  it('拒绝如实呈现 layer 与 reason,不触发成功回调', async () => {
    const fetchMock = mockFetch(422, {
      layer: 'guard-failed',
      reason: 'guard 不满足: title-not-taken=false',
    });
    vi.stubGlobal('fetch', fetchMock);
    const onExecuted = vi.fn();
    render(
      <ActionRunner rel="article-drafting:main" action={publishAction} onExecuted={onExecuted} />,
    );

    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '重名标题' } });
    fireEvent.change(screen.getByLabelText(/正文/), { target: { value: '正文' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('guard-failed');
    expect(alert.textContent).toContain('title-not-taken');
    expect(onExecuted).not.toHaveBeenCalled();
  });
});

describe('ActionRunner:guard-results 谓词投影', () => {
  it('blocked → 按钮 disabled 且 title 显示原因', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    const { container } = render(
      <ActionRunner
        rel="article-drafting:main"
        action={resetAction}
        blocked
        blockReason="guard 不满足: is-pending=false"
      />,
    );

    const button = screen.getByRole('button', { name: '重置' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('is-pending');
    // disabled 状态下不渲染表单交互(无 fields 路径同样受控)
    expect(container.querySelector('form')).toBeNull();
  });

  it('有 fields 且 blocked → 表单提交按钮 disabled + title 原因', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(
      <ActionRunner
        rel="article-drafting:main"
        action={publishAction}
        blocked
        blockReason="guard 不满足: title-not-taken=false"
      />,
    );

    const button = screen.getByRole('button', { name: '发布' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('title-not-taken');
  });
});

// ---- EntityView ----------------------------------------------------------------

describe('EntityView:实体四件组装渲染', () => {
  it('铁律 3:渲染的 form/button 全部来自 actions[](零合同外可提交元素)', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    const { container } = render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    const declared = new Set(wizardEntity.actions.map((action) => action.name));
    const submittables = [
      ...container.querySelectorAll<HTMLFormElement>('form'),
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ];
    // publish(RJSF 表单 + 提交按钮)+ reset(按钮);表单经容器背书,按钮直接背书
    expect(submittables.length).toBe(3);
    for (const element of submittables) {
      const endorsed =
        element.dataset.action ??
        (element.closest('[data-action]') as HTMLElement | null)?.dataset.action;
      expect(declared.has(String(endorsed)), `元素 ${element.outerHTML} 须背书已声明 action`).toBe(
        true,
      );
    }
  });

  it('links[] 渲染为 renderer 导航链接(/entity?rel=…)', () => {
    const { container } = render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>('a')].map((a) => a.href);
    expect(hrefs).toContain('http://localhost:3000/entity?rel=articles');
    expect(hrefs).toContain('http://localhost:3000/entity?rel=article-drafting%3Amain');
    expect(hrefs).toContain('http://localhost:3000/entity?rel=flow%3Aarticle-drafting');
  });

  it('集合子实体 entities[] 渲染为成员链接(含标题与节点)', () => {
    const { container } = render(<EntityView rel="articles" entity={articlesEntity} />);

    const anchor = container.querySelector<HTMLAnchorElement>('a[href*="post%3Apost-welcome"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toContain('欢迎来到 UI4A');
    expect(anchor!.textContent).toContain('published');
  });

  it('properties 简表呈现字段值', () => {
    render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    expect(screen.getByText(/草稿标题/)).toBeTruthy();
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('blocked 的 guard-results 注入 disabled(整页接线)', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    const reset = screen.getByRole('button', { name: '重置' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    expect(reset.title).toContain('is-pending');
    const publish = screen.getByRole('button', { name: '发布' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
  });
});
