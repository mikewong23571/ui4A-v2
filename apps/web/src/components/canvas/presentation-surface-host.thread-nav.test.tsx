// @vitest-environment jsdom
/**
 * T56 P3.1 Red→Green:F-P2.3-1(登记于 evidence.md E-P2.3)+ 固定视图护栏。
 *
 * - **F-P2.3-1**:本线语境(thread=T)下,surface 成员链接与内容区实体链接
 *   的合同导航必须保留 `thread=` 声明——落点页因此常显「返回本线」(US07/
 *   FR7)。Red:现状点击后 href 只有 focus=X,thread 丢失;desk 条目已正确
 *   (thread-desk-navigation.test 为既有护栏,此处钉 surface 侧);
 * - 修复落点 = 客户端链接构建层(surface host 点击捕获改写),投影 link 保持
 *   合同原样(D78);已声明 thread 的链接、非 /canvas 落点、修饰键/新窗口
 *   目标诚实不动;
 * - **固定视图 pin 控件护栏(US06/FR5)**:pin/取消 pin 零业务事件、不进
 *   references 合同、状态可切换(localStorage 舞台偏好)。
 *
 * mock 口径同 canvas-body.thread-workspace.test:useSearchParams 读
 * window.location;fetch 桩 = 目录协商 + sitemap + 实体读 + exec 记账
 * (POST /api/presentation 404 → 客户端通用规划兜底,生产同管线)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { renderCatalogJson } from '@/render/registry';

import { CanvasBody } from './canvas-body';
import { threadPinsKey } from './desk/thread-desk';
import { EntityCacheProvider } from '../entity-cache-provider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/canvas',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const THREAD_IDENTITY = '处理 CVE 批次';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function threadEntity(): SirenEntity {
  return {
    class: ['work-thread', 'open'],
    properties: {
      rel: 'thread:t1',
      id: 't1',
      identity: THREAD_IDENTITY,
      goal: { text: '形成跨应用修复决定并留痕', source: 'chat 消息' },
      goalText: '形成跨应用修复决定并留痕',
      status: 'open',
      statusText: '进行中',
      context: ['todo:t35'],
      resume: '停在「进行中」',
      active: [],
      approval: [],
      'recent-events': [],
      presentation: {
        fields: [
          { path: 'properties.identity', title: '目标', role: 'identity' },
          { path: 'properties.goalText', title: '目标全文', role: 'primary-content' },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=thread%3At1' }],
    'guard-results': [],
    entities: [
      {
        class: ['thread-reference'],
        properties: { rel: 'post:p1', identity: '第一篇', status: 'published' },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=post%3Ap1' }],
      },
    ],
  };
}

function postEntity(): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    properties: {
      rel: 'post:p1',
      identity: '第一篇',
      status: 'published',
      fields: { title: '第一篇', body: '第一篇正文,用于对象页阅读。' },
      presentation: {
        fields: [
          { path: 'properties.fields.title', title: '标题', role: 'identity' },
          { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=post%3Ap1' }],
  };
}

/** 内容区实体链接用例的集合面:成员是可点实体链接(collection→object)。 */
function articlesCollection(): SirenEntity {
  return {
    class: ['collection', 'articles'],
    properties: {
      rel: 'articles',
      count: 1,
      title: '文章',
      presentation: { fields: [{ path: 'properties.title', title: '标题', role: 'identity' }] },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
    'guard-results': [],
    entities: [
      {
        class: ['flow-instance', 'post-status'],
        properties: { rel: 'post:p1', identity: '第一篇', status: 'published' },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=post%3Ap1' }],
      },
    ],
  };
}

function todosEntity(): SirenEntity {
  return {
    class: ['collection', 'todos'],
    properties: { rel: 'todos', count: 1, title: '待办' },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=todos' }],
    'guard-results': [],
    entities: [
      {
        class: ['flow-instance', 'todo-capture'],
        properties: { rel: 'todo:t35', identity: '完成 T35 全轨道验收', status: 'archived' },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=todo%3At35' }],
      },
    ],
  };
}

interface Fixture {
  fetchMock: ReturnType<typeof vi.fn>;
  execPosts: () => number;
  httpContext: () => Promise<string[]>;
}

function canvasContract(rows: Record<string, SirenEntity>): Fixture {
  let execPostCount = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/render/catalog') {
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    }
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
    }
    if (url === '/api/exec' && init?.method === 'POST') {
      execPostCount += 1;
      return Promise.resolve(jsonResponse(200, { entity: rows['thread:t1'] }));
    }
    if (url.startsWith('/api/entity?rel=')) {
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel') ?? '';
      const entity = rows[rel];
      return Promise.resolve(
        entity === undefined
          ? jsonResponse(404, { error: 'not found' })
          : jsonResponse(200, entity),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
  });
  return {
    fetchMock,
    execPosts: () => execPostCount,
    httpContext: async () => {
      const response = await fetch('/api/entity?rel=thread%3At1');
      const body = (await response.json()) as SirenEntity;
      return body.properties.context as string[];
    },
  };
}

async function renderCanvas(
  query: string,
  rows: Record<string, SirenEntity>,
): Promise<Fixture & { container: HTMLElement }> {
  window.history.pushState({}, '', `/canvas?${query}`);
  const fixture = canvasContract(rows);
  vi.stubGlobal('fetch', fixture.fetchMock);
  const { container } = render(
    <EntityCacheProvider>
      <CanvasBody />
    </EntityCacheProvider>,
  );
  return { ...fixture, container };
}

function surfaceMemberLink(container: HTMLElement): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>('[data-surface] a[href*="focus=post%3Ap1"]');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
  globalThis.localStorage?.clear();
});

describe('本线合同导航保留 thread 声明(F-P2.3-1;US07/FR7)', () => {
  it('surface 成员链接点击后落点 URL 保留 thread=T(现状丢失,Red)', async () => {
    const { container } = await renderCanvas('thread=t1&focus=thread%3At1', {
      'thread:t1': threadEntity(),
      'post:p1': postEntity(),
      'todo:t35': todosEntity(),
    });
    const link = await waitFor(() => {
      const anchor = surfaceMemberLink(container);
      expect(anchor).not.toBeNull();
      return anchor!;
    });
    expect(link.getAttribute('href')).toContain(`focus=${encodeURIComponent('post:p1')}`);
    // Red:现状 href 无 thread;契约:点击后导航出参保留线身份。
    fireEvent.click(link);
    expect(link.getAttribute('href')).toContain('thread=t1');
  });

  it('内容区实体链接(集合→对象)点击后同样保留 thread=T', async () => {
    const { container } = await renderCanvas('thread=t1&focus=articles', {
      'thread:t1': threadEntity(),
      articles: articlesCollection(),
      'post:p1': postEntity(),
    });
    const link = await waitFor(() => {
      const anchor = surfaceMemberLink(container);
      expect(anchor).not.toBeNull();
      return anchor!;
    });
    fireEvent.click(link);
    expect(link.getAttribute('href')).toContain('thread=t1');
  });

  it('已声明 thread 的链接与非画布落点诚实不动(零改写)', async () => {
    const { hrefWithThreadContext } = await import('./presentation-surface-helpers');
    // 已带 thread → null(不重复声明)。
    expect(hrefWithThreadContext(`/canvas?focus=articles&thread=t1`, 't1')).toBeNull();
    // 非 /canvas 落点(元合同站/实体页/外站)→ null。
    expect(hrefWithThreadContext('/meta/entity?rel=flow%3Atodo-capture', 't1')).toBeNull();
    expect(hrefWithThreadContext('/entity?rel=post%3Ap1', 't1')).toBeNull();
    expect(
      hrefWithThreadContext('https://elsewhere.example/canvas?focus=articles', 't1'),
    ).toBeNull();
    // /canvas 落点 → 补声明,其余参数原样。
    expect(hrefWithThreadContext('/canvas?focus=articles&scope=publishing', 't1')).toBe(
      '/canvas?focus=articles&scope=publishing&thread=t1',
    );
  });
});

describe('固定视图 pin 控件护栏(US06/FR5:零业务事件、不进合同)', () => {
  it('pin/取消 pin 不产生任何业务事件,references 合同不变,状态可切换', async () => {
    const { execPosts, httpContext } = await renderCanvas('thread=t1&focus=post%3Ap1', {
      'thread:t1': threadEntity(),
      'post:p1': postEntity(),
    });
    await screen.findByText(/第一篇正文/);

    const pin = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        'button[data-nav="local:thread-pin:presentation:post:p1"]',
      );
      expect(button).not.toBeNull();
      return button!;
    });
    expect(pin.getAttribute('aria-pressed')).toBe('false');

    // pin 一个未关联对象:零业务事件。
    fireEvent.click(pin);
    await waitFor(() =>
      expect(
        JSON.parse(globalThis.localStorage?.getItem(threadPinsKey('t1')) ?? '[]') as string[],
      ).toEqual(['post:p1']),
    );
    expect(execPosts()).toBe(0);
    expect(await httpContext()).toEqual(['todo:t35']);

    // 取消 pin:同样零业务事件。
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pin);
    await waitFor(() =>
      expect(
        JSON.parse(globalThis.localStorage?.getItem(threadPinsKey('t1')) ?? '[]') as string[],
      ).toEqual([]),
    );
    expect(execPosts()).toBe(0);
    expect(await httpContext()).toEqual(['todo:t35']);
  });
});
