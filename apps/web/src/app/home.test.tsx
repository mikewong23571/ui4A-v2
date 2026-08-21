// @vitest-environment jsdom
/**
 * 入口页测试(T2 Phase F / Task F2):首页 = renderer 的导航入口。
 *
 * - 文章列表:articles 集合成员逐篇链接到 /entity?rel=post:<id>(标题 + 节点可见);
 * - 发布向导入口:来自 articles.links 的 flow 入口链接(零 startRel 特权);
 * - 评论队列:pending 计数 + 入口链接 /entity?rel=comments;
 * - 收件箱(T3 Phase D):pending 确认计数(/api/entity?rel=inbox)+ 入口链接
 *   /entity?rel=inbox(确认门的人类待办入口);
 * - 铁律 3:首页是纯导航页,不渲染任何 button/form(可提交元素只存在于实体页)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import Home from './page';

// ---- fixtures -----------------------------------------------------------------

function member(rel: string, node: string, title: string): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    rel: ['item'],
    href: `/api/entity?rel=${encodeURIComponent(rel)}`,
    properties: {
      rel,
      node,
      title: node,
      // 投影后的扁平字段(engine fieldValues 已剥离开出处)
      fields: { title },
    },
    actions: [],
    links: [],
  };
}

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
    member('post:post-welcome', 'published', '欢迎来到 UI4A'),
    member('post:first-post', 'published', '第一篇'),
  ],
};

function comment(rel: string, node: string, body: string): SirenEntity {
  return {
    class: ['flow-instance', 'comment-moderation'],
    rel: ['item'],
    href: `/api/entity?rel=${encodeURIComponent(rel)}`,
    properties: { rel, node, title: node, fields: { body } },
    actions: [],
    links: [],
  };
}

const commentsEntity: SirenEntity = {
  class: ['collection', 'comments'],
  properties: { rel: 'comments', count: 4 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=comments' }],
  'guard-results': [],
  entities: [
    comment('comment:c1', 'pending', '好文章'),
    comment('comment:c2', 'pending', '学习了'),
    comment('comment:c3', 'pending', '期待下一篇'),
    comment('comment:c4', 'approved', '赞'),
  ],
};

/** 确认成员(inbox 子实体;pending confirmation 的投影形状)。 */
function confirmationMember(
  id: string,
  overrides: Record<string, unknown> = {},
): SirenEntity {
  return {
    class: ['confirmation', 'pending'],
    rel: ['item'],
    href: `/api/entity?rel=${encodeURIComponent(`confirmation:${id}`)}`,
    properties: {
      id,
      'target-rel': 'post:post-welcome',
      'target-action': 'archive',
      params: {},
      'proposed-by': { actor: 'agent', principal: 'user:mike' },
      channel: 'e2e',
      status: 'pending',
      notified: true,
      ...overrides,
    },
    actions: [],
    links: [],
  };
}

function inboxEntity(count: number): SirenEntity {
  return {
    class: ['collection', 'inbox'],
    properties: { rel: 'inbox', count, delivered: count },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=inbox' }],
    'guard-results': [],
    entities:
      count === 0
        ? []
        : [confirmationMember('c1'), confirmationMember('c2', { id: 'c2' })].slice(0, count),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 按合同 URL 分发的 fetch mock(articles/comments/inbox 三端点)。 */
function mockContract(inbox: SirenEntity = inboxEntity(2)) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/entity?rel=articles')) {
      return Promise.resolve(jsonResponse(200, articlesEntity));
    }
    if (url.startsWith('/api/entity?rel=comments')) {
      return Promise.resolve(jsonResponse(200, commentsEntity));
    }
    if (url.startsWith('/api/entity?rel=inbox')) {
      return Promise.resolve(jsonResponse(200, inbox));
    }
    return Promise.resolve(jsonResponse(404, { error: `未知端点 ${url}` }));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- tests -----------------------------------------------------------------------

describe('入口页(首页)', () => {
  it('文章列表:每篇链接到 /entity?rel=post:<id>,标题与节点可见', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[href*="post%3Apost-welcome"]')).not.toBeNull();
    });
    const welcome = container.querySelector<HTMLAnchorElement>('a[href*="post%3Apost-welcome"]')!;
    expect(welcome.textContent).toContain('欢迎来到 UI4A');
    expect(welcome.textContent).toContain('published');
    const firstPost = container.querySelector<HTMLAnchorElement>('a[href*="post%3Afirst-post"]');
    expect(firstPost).not.toBeNull();
    expect(firstPost!.textContent).toContain('第一篇');
    expect(screen.getByText(/共 2 篇/)).toBeTruthy();
  });

  it('发布向导入口:来自 articles.links 的 flow 链接(导航不靠 startRel 特权)', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[href*="flow%3Aarticle-drafting"]')).not.toBeNull();
    });
    const entry = container.querySelector<HTMLAnchorElement>('a[href*="flow%3Aarticle-drafting"]')!;
    expect(entry.href).toBe('http://localhost:3000/entity?rel=flow%3Aarticle-drafting');
  });

  it('评论队列:pending 计数与入口链接', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[href$="rel=comments"]')).not.toBeNull();
    });
    expect(screen.getByText(/待处理 3/)).toBeTruthy();
    const queue = container.querySelector<HTMLAnchorElement>('a[href$="rel=comments"]')!;
    expect(queue.href).toBe('http://localhost:3000/entity?rel=comments');
  });

  it('收件箱入口:pending 确认计数(/api/entity?rel=inbox)与链接', async () => {
    vi.stubGlobal('fetch', mockContract(inboxEntity(2)));
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[href$="rel=inbox"]')).not.toBeNull();
    });
    const inbox = container.querySelector<HTMLAnchorElement>('a[href$="rel=inbox"]')!;
    expect(inbox.textContent).toContain('待确认 2');
    expect(inbox.href).toBe('http://localhost:3000/entity?rel=inbox');
  });

  it('收件箱入口:空收件箱渲染待确认 0(集合恒可投影)', async () => {
    vi.stubGlobal('fetch', mockContract(inboxEntity(0)));
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[href$="rel=inbox"]')).not.toBeNull();
    });
    expect(container.querySelector<HTMLAnchorElement>('a[href$="rel=inbox"]')!.textContent).toContain(
      '待确认 0',
    );
  });

  it('BIOS 入口:仅一行链接到 /meta(人类显式意图,进入定义层;T4 Phase C)', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);
    await waitFor(() => {
      expect(container.querySelector('a[href*="post%3Apost-welcome"]')).not.toBeNull();
    });
    const bios = container.querySelector<HTMLAnchorElement>('a[href="/meta"]');
    expect(bios).not.toBeNull();
    expect(bios!.textContent).toContain('BIOS');
  });

  it('铁律 3:纯导航首页不渲染任何可提交元素(零 button/form)', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[href*="post%3Apost-welcome"]')).not.toBeNull();
    });
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('form')).toHaveLength(0);
  });
});
