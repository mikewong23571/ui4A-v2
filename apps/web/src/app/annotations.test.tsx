// @vitest-environment jsdom
/**
 * 全站可点元素标注抽样断言(T7 Phase B / spec 架构决定 6,I3 基础):
 * 一切可点元素必带 data-action(已声明动作 → /api/exec)或 data-nav
 * (合同链接/本地视图控件)。抽样覆盖:实体页(动作 + 导航)、舰队页
 * (本地刷新)、悬浮聊天(全局布局控件)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import DelegationsPage from '@/app/delegations/page';
import { EntityView } from '@/components/entity-view';
import { FloatingChat } from '@/components/chat/floating-chat';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const POST_ENTITY: SirenEntity = {
  class: ['flow-instance', 'post-status'],
  properties: {
    rel: 'post:post-welcome',
    node: 'published',
    title: '已发布',
    fields: { title: '欢迎' },
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
  links: [
    { rel: ['collection'], href: '/api/entity?rel=articles' },
    { rel: ['target'], href: '/api/entity?rel=post:first-post' },
  ],
  'guard-results': [],
};

describe('可点元素标注抽样(data-action / data-nav)', () => {
  it('实体页:动作按钮 data-action;首页/成员/合同链接 data-nav', () => {
    const { container } = render(<EntityView rel="post:post-welcome" entity={POST_ENTITY} />);
    // 动作(ActionRunner):data-action = 已声明动作名
    expect(container.querySelector('[data-action="unpublish"]')).not.toBeNull();
    // 导航:首页回链 / 合同链接(rel 投影)/ 外链兜底
    expect(container.querySelector('a[data-nav="home"]')).not.toBeNull();
    expect(container.querySelector('a[data-nav="collection"]')).not.toBeNull();
    expect(container.querySelector('a[data-nav="target"]')).not.toBeNull();
    // 抽样断言:页面内所有 button 与 a 必有 data-action 或 data-nav
    const clickables = container.querySelectorAll('button, a');
    expect(clickables.length).toBeGreaterThan(0);
    for (const element of clickables) {
      expect(
        element.hasAttribute('data-action') || element.hasAttribute('data-nav'),
        `${element.tagName} ${element.textContent ?? ''}`,
      ).toBe(true);
    }
  });

  it('集合成员链接同样标注 data-nav(item)', () => {
    const collection: SirenEntity = {
      class: ['collection', 'comments'],
      properties: { rel: 'comments', count: 1 },
      actions: [],
      links: [],
      entities: [
        {
          class: ['flow-instance'],
          rel: ['item'],
          href: '/api/entity?rel=comment:c1',
          properties: { rel: 'comment:c1', node: 'pending', fields: { body: '好' } },
          actions: [],
          links: [],
        },
      ],
    };
    const { container } = render(<EntityView rel="comments" entity={collection} />);
    expect(container.querySelector('a[data-nav="item"][data-rel="comment:c1"]')).not.toBeNull();
  });

  it('舰队页:刷新按钮 = 本地视图控件 data-nav(local: 前缀)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ delegations: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );
    const { container } = render(<DelegationsPage />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="empty-fleet"]')).not.toBeNull();
    });
    expect(container.querySelector('button[data-nav="local:fleet-refresh"]')).not.toBeNull();
  });

  it('悬浮聊天(全站全局布局):展开按钮带 data-nav(local: 前缀)', () => {
    const { container } = render(<FloatingChat />);
    expect(container.querySelector('button[data-nav="local:chat-open"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '展开聊天窗' })).toBeTruthy();
  });
});
