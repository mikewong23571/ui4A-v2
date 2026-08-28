// @vitest-environment jsdom
/**
 * form 词条组件测试(T7 Phase B):给 deref 输出(实体引用)→ 复用
 * ActionRunner(RJSF):字段 schema 来自实体 actions,提交按钮带
 * data-action(铁律 3:可提交元素必映射已声明动作)。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { derefSpec } from '../deref';

import { ActionSubmitProvider, createDirectActionSubmit } from '@/components/actions/action-submit';
import { execAction } from '@/components/exec-client';

import { articlesCollection, specOf } from './fixtures';
import { FormWord } from './form';

afterEach(cleanup);

function entityWithActions(): ReturnType<typeof articlesCollection> {
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
        fields: {
          type: 'object',
          properties: { reason: { type: 'string', title: '下线原因' } },
          required: ['reason'],
        },
      },
      {
        name: 'archive',
        title: '归档',
        method: 'POST',
        href: '/api/exec',
        fields: { type: 'object', properties: {} },
      },
    ],
    links: [{ rel: ['collection'], href: '/api/entity?rel=articles' }],
    'guard-results': [],
  };
}

describe('form 词条', () => {
  it('deref 输出 → 实体动作逐个渲染(RJSF 表单 + 推送按钮),data-action 标注', async () => {
    const entity = entityWithActions();
    const cache = new Map([['post:post-welcome', entity]]);
    const props = derefSpec(specOf('form', { entity: { ref: 'entity:post:post-welcome' } }), cache);
    const { container } = render(
      <ActionSubmitProvider submit={createDirectActionSubmit(execAction)}>
        <FormWord {...props} />
      </ActionSubmitProvider>,
    );

    // D50:默认收起,先打开表单;字段 schema 来自实体 actions(RJSF 输入)
    fireEvent.click(screen.getByRole('button', { name: '下线' }));
    expect(await screen.findByText('下线原因')).toBeTruthy();
    // 推送按钮(无字段动作)
    expect(screen.getByRole('button', { name: '归档' })).toBeTruthy();
    // 铁律 3:每个可提交元素都带 data-action(已声明动作名)
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[data-action]');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect([...buttons].every((button) => button.dataset.action !== '')).toBe(true);
  });

  it('提交走 /api/exec(实体声明的动作;白名单外拒)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ entity: { class: [], properties: {}, actions: [], links: [] } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const entity = entityWithActions();
    const cache = new Map([['post:post-welcome', entity]]);
    const props = derefSpec(specOf('form', { entity: { ref: 'entity:post:post-welcome' } }), cache);
    render(
      <ActionSubmitProvider submit={createDirectActionSubmit(execAction)}>
        <FormWord {...props} />
      </ActionSubmitProvider>,
    );

    screen.getByRole('button', { name: '归档' }).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(input)).toContain('/api/exec');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.action).toBe('archive');
    expect(body.rel).toBe('post:post-welcome');
    vi.unstubAllGlobals();
  });

  it('entity 缺 rel(提交目标)→ 响亮抛错', () => {
    expect(() =>
      render(
        <FormWord entity={{ class: [], properties: { node: 'x' }, actions: [], links: [] }} />,
      ),
    ).toThrow(/form/);
  });
});
