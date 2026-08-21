// @vitest-environment jsdom
/**
 * 入口页测试(T2 Phase F / Task F2;T7 Phase B 增态势投影与骨架导航):
 * 首页 = renderer 的导航入口 + 态势投影(骨架路径,零 AI)。
 *
 * - 文章列表:articles 集合成员逐篇链接到 /entity?rel=post:<id>;
 * - 发布向导入口:来自 articles.links 的 flow 入口链接(零 startRel 特权);
 * - 评论队列/收件箱:pending 计数 + 入口链接;
 * - 态势投影(T7):stat 数值与实体 count 对拍(待确认 = inbox.count、
 *   文章数 = articles.count、在飞 = delegations running 计数);timeline
 *   最近事件(/api/events 投影,零 AI);
 * - 全站导航(SiteNav,经 AppShell 顶栏):事件流/画布/舰队/BIOS 入口;
 * - 铁律 3:首页是纯导航页,不渲染任何可提交元素(form / type=submit 按钮 /
 *   data-action 按钮;chrono 内部 type=button 控件不构成提交面)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { AppShell } from '@/components/app-shell';
import { stubBrowserApis } from '@/test/browser-stubs';

import Home from './page';

stubBrowserApis();

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
function confirmationMember(id: string, overrides: Record<string, unknown> = {}): SirenEntity {
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

/** 按合同 URL 分发的 fetch mock(articles/comments/inbox/delegations/events)。 */
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
    if (url.startsWith('/api/entity?rel=delegations')) {
      return Promise.resolve(
        jsonResponse(200, {
          class: ['collection', 'delegations'],
          properties: { rel: 'delegations', count: 2 },
          actions: [],
          links: [],
          entities: [
            {
              class: ['delegation'],
              properties: { rel: 'delegation:a', status: 'running' },
              actions: [],
              links: [],
            },
            {
              class: ['delegation'],
              properties: { rel: 'delegation:b', status: 'completed' },
              actions: [],
              links: [],
            },
          ],
        }),
      );
    }
    if (url.startsWith('/api/events')) {
      return Promise.resolve(
        jsonResponse(200, {
          events: [
            {
              seq: 1,
              kind: 'seed',
              rel: 'seed:business-domain',
              action: null,
              actor: null,
              principal: null,
              channel: null,
            },
            {
              seq: 2,
              kind: 'action-executed',
              rel: 'post:post-welcome',
              action: 'unpublish',
              actor: 'human',
              principal: 'local-user',
              channel: 'renderer',
            },
            {
              seq: 3,
              kind: 'delegation-started',
              rel: 'delegation:a',
              action: null,
              actor: 'agent',
              principal: 'user:mike',
              channel: null,
            },
          ],
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: `未知端点 ${url}` }));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stubBrowserApis();
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
      expect(container.querySelector('a[data-rel="inbox"]')).not.toBeNull();
    });
    const inbox = container.querySelector<HTMLAnchorElement>('a[data-rel="inbox"]')!;
    expect(inbox.textContent).toContain('待确认 2');
    expect(inbox.href).toBe('http://localhost:3000/entity?rel=inbox');
  });

  it('收件箱入口:空收件箱渲染待确认 0(集合恒可投影)', async () => {
    vi.stubGlobal('fetch', mockContract(inboxEntity(0)));
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[data-rel="inbox"]')).not.toBeNull();
    });
    expect(
      container.querySelector<HTMLAnchorElement>('a[data-rel="inbox"]')!.textContent,
    ).toContain('待确认 0');
  });

  it('委托舰队入口(T5 Phase B):链接到 /delegations(并行委托的监控视图)', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);
    await waitFor(() => {
      expect(container.querySelector('a[href*="post%3Apost-welcome"]')).not.toBeNull();
    });
    const fleet = container.querySelector<HTMLAnchorElement>('a[data-rel="delegations"]');
    expect(fleet).not.toBeNull();
    expect(fleet!.textContent).toContain('委托舰队');
  });

  it('BIOS 入口:仅一行链接到 /meta(人类显式意图,进入定义层;T4 Phase C)', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);
    await waitFor(() => {
      expect(container.querySelector('a[href*="post%3Apost-welcome"]')).not.toBeNull();
    });
    const bios = container.querySelector<HTMLAnchorElement>('a[data-rel="meta"]');
    expect(bios).not.toBeNull();
    expect(bios!.textContent).toContain('BIOS');
  });

  it('铁律 3:纯导航首页不渲染任何可提交元素(零 form / 零提交按钮 / 零 data-action)', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('a[href*="post%3Apost-welcome"]')).not.toBeNull();
    });
    expect(container.querySelectorAll('form')).toHaveLength(0);
    // 可提交元素 = form、关联 form 的 submit 按钮、或携带 data-action(已声明
    // 动作)的按钮。chrono 的箭头/点位按钮无 type 属性(HTML 缺省序列化为
    // submit)但**不关联任何 form**——无 form owner 的按钮在浏览器语义里
    // 不构成提交面;此前"type=submit 即提交面"口径在 chrono 按渲染上下文
    // 出箭头钮时误报,按铁律本义(能否提交)以 form owner 为准。
    const submitButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.form !== null || button.hasAttribute('data-action'),
    );
    expect(submitButtons).toHaveLength(0);
    expect(container.querySelectorAll('[data-action]')).toHaveLength(0);
  });

  it('态势投影(T7):stat 数值与实体对拍——待确认=inbox.count、文章数=articles.count、在飞=running 计数', async () => {
    vi.stubGlobal('fetch', mockContract(inboxEntity(2)));
    const { container } = render(<Home />);

    await waitFor(() => {
      expect(container.querySelector('[data-testid="stat-pending"]')).not.toBeNull();
    });
    // deref 对拍:待确认 = inbox.count(2),文章数 = articles.count(2)
    expect(container.querySelector('[data-testid="stat-pending"]')?.textContent).toContain('2');
    expect(container.querySelector('[data-testid="stat-pending"]')?.textContent).toContain(
      '待确认',
    );
    expect(container.querySelector('[data-testid="stat-articles"]')?.textContent).toContain('2');
    expect(container.querySelector('[data-testid="stat-articles"]')?.textContent).toContain(
      '文章数',
    );
    // 在飞委托 = delegations 成员 running 计数(1 running / 2 total)
    expect(container.querySelector('[data-testid="stat-running"]')?.textContent).toContain('1');
    expect(container.querySelector('[data-testid="stat-running"]')?.textContent).toContain(
      '在飞委托',
    );
  });

  it('态势 timeline:最近事件来自 /api/events 投影(零 AI,尾部窗口)', async () => {
    vi.stubGlobal('fetch', mockContract());
    const { container } = render(<Home />);

    // chrono 的卡片在容器挂载后异步渲染:等待内容本身而非仅容器
    //(机器负载下卡片晚于容器出现,读早了 textContent 为空——竞态修复)。
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="situation-timeline"]')?.textContent ?? '',
      ).toContain('action-executed');
    });
    const text = container.querySelector('[data-testid="situation-timeline"]')?.textContent ?? '';
    expect(text).toContain('delegation-started');
  });

  it('全站导航(SiteNav):事件流/画布入口可见(data-nav 标注)', async () => {
    vi.stubGlobal('fetch', mockContract());
    // T9 Phase A:SiteNav 上移至 AppShell 顶栏,随壳断言。
    const { container } = render(
      <AppShell>
        <Home />
      </AppShell>,
    );
    await waitFor(() => {
      expect(container.querySelector('a[href*="post%3Apost-welcome"]')).not.toBeNull();
    });
    expect(container.querySelector('a[data-nav="events"]')?.getAttribute('href')).toBe('/events');
    expect(container.querySelector('a[data-nav="canvas"]')?.getAttribute('href')).toBe('/canvas');
  });
});
