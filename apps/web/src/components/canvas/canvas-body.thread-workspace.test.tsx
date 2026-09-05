// @vitest-environment jsdom
/**
 * T56 P2.1 Red:页面目标与空间契约(D78 决定 1/design §1/spec FR1·FR4/US01·US05·US07)。
 *
 * Red 为主:刻画 P2.2 壳重构后的行为契约,当前实现应失败——
 * - 本线是主内容主体:thread 深链(含无显式 focus)渲染目标/生命周期/责任内容,
 *   不再走 noGaze 旁路(canvas-body.tsx 的协作说明+应用书架,FR1/US01/F02);
 * - 唯一 H1:机制标题「共同注视」不再压过业务标题(D78/design §1);
 * - 默认无永久材料栏,存在明确「相关材料」展开入口(FR4/D78);
 * - focus=X 保留 T 的身份与「返回本线」路径(US07/FR1);
 * - raw/why/reload 收进次要工具入口,不占主区域首屏(D78/design §1);
 * - 钉住控件改「固定视图」舞台语义,不写「挂进本线」(FR5;P3.1 修复)。
 *
 * 几何 px 契约(并排阈值 1072/1008、200% 必覆盖、无 body 横滚、覆盖层不超屏)
 * 归 E2E `e2e/workstation/work-thread-workspace.spec.ts`;组件级只断言结构、
 * 文案与 URL/DOM 事实(G2 纪律,不断言 class 字符串)。
 *
 * mock 口径同 canvas-first-screen.test:useSearchParams 读 window.location,
 * 全局 fetch 应答目录协商/sitemap/实体读取;POST /api/presentation 404 →
 * 客户端通用规划兜底(与生产同一条 Presentation 管线)。实体形状是本文件的
 * 投影 fixture(P1.1 落地后由真实 thread 投影供给;壳契约不绑定具体投影字段,
 * 只要求「可呈现的线实体」经同一管线渲染为主内容)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { renderCatalogJson } from '@/render/registry';

import { CanvasBody } from './canvas-body';
import { EntityCacheProvider } from '../entity-cache-provider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/canvas',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const THREAD_IDENTITY = '处理 CVE 批次';
const THREAD_GOAL_TEXT = '形成跨应用修复决定并留痕';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 本线实体投影 fixture:身份 + 目标全文经 presentation 声明可呈现。 */
function threadEntity(): SirenEntity {
  return {
    class: ['work-thread', 'open'],
    properties: {
      rel: 'thread:t1',
      id: 't1',
      identity: THREAD_IDENTITY,
      goal: { text: THREAD_GOAL_TEXT, source: 'chat 消息' },
      goalText: THREAD_GOAL_TEXT,
      status: 'open',
      statusText: '进行中',
      context: ['post:p1'],
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
    links: [{ rel: ['self'], href: '/api/entity?rel=thread:t1' }],
    'guard-results': [],
    entities: [
      {
        class: ['thread-reference'],
        properties: { rel: 'post:p1', identity: '第一篇', status: 'published' },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=post:p1' }],
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
    links: [{ rel: ['self'], href: '/api/entity?rel=post:p1' }],
  };
}

function articlesCollection(): SirenEntity {
  return {
    class: ['collection', 'articles'],
    properties: {
      rel: 'articles',
      count: 0,
      title: '文章',
      presentation: { fields: [{ path: 'properties.title', title: '标题', role: 'identity' }] },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
    entities: [],
  };
}

/** 画布合同桩:目录协商 + sitemap + 实体读取;POST /api/presentation 404 →
 * 客户端通用规划兜底(生产同路径)。render-specs 404 → 冻结规格为空,合法前置。 */
function canvasContract(rows: Record<string, SirenEntity>): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/render/catalog') {
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    }
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
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
}

async function renderCanvas(
  query: string,
  rows: Record<string, SirenEntity>,
): Promise<HTMLElement> {
  window.history.pushState({}, '', `/canvas?${query}`);
  vi.stubGlobal('fetch', canvasContract(rows));
  const { container } = render(
    <EntityCacheProvider>
      <CanvasBody />
    </EntityCacheProvider>,
  );
  return container;
}

/**
 * 就绪门(非断言目标):Red 下等旁路渲染完成(书桌叙述卡出现);Green(P2.2)
 * 下等本线 surface 的 H1 出现——两侧都不因 gate 本身而失败。
 */
async function waitSettled(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.queryByTestId('desk-narrative') !== null ||
        screen.queryAllByRole('heading', { level: 1 }).length > 0,
    ).toBe(true);
  });
}

/** 对象页就绪门:对象正文经语义 surface 上屏(Red/Green 两态都成立)。 */
async function waitObjectSurfaceReady(): Promise<void> {
  await screen.findByText(/第一篇正文/);
}

function h1Texts(): string[] {
  return [...document.querySelectorAll('h1')].map((heading) => heading.textContent);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
  globalThis.localStorage?.clear();
});

describe('本线是主内容主体(T56 D78/US01/FR1;P2.1 Red)', () => {
  it('深链 thread=T&focus=thread:T:线目标/身份成为唯一 H1 主内容', async () => {
    const container = await renderCanvas('thread=t1&focus=thread%3At1', {
      'thread:t1': threadEntity(),
    });
    await waitSettled();
    // D78/design §1:当前视口只呈现一个主要 H1,取本线目标(现状 0 个 h1)。
    expect(h1Texts()).toEqual([THREAD_IDENTITY]);
    // 目标全文可读:本线内容是主区域主体,而非旁路占位。
    expect(container.textContent).toContain(THREAD_GOAL_TEXT);
  });

  it('本线页不再渲染操作说明书(noGaze 旁路文案退场,US01)', async () => {
    const container = await renderCanvas('thread=t1&focus=thread%3At1', {
      'thread:t1': threadEntity(),
    });
    await waitSettled();
    expect(container.textContent).not.toContain('左侧书桌常驻');
  });

  it('本线页不再渲染应用书架(FR1:应用书架不放进本线概览,F02)', async () => {
    const container = await renderCanvas('thread=t1&focus=thread%3At1', {
      'thread:t1': threadEntity(),
    });
    await waitSettled();
    expect(container.querySelector('[data-testid="application-entry-strip"]')).toBeNull();
  });

  it('thread=T 无显式 focus:落本线概览,而非默认对象注视(FR1 可解释本线落点)', async () => {
    await renderCanvas('thread=t1', {
      'thread:t1': threadEntity(),
      articles: articlesCollection(),
    });
    await waitSettled();
    // 现状:无 focus 默认落 articles(注视列渲染「文章」集合面)+「共同注视」h1。
    expect(h1Texts()).toEqual([THREAD_IDENTITY]);
  });
});

describe('唯一 H1 与返回路径(T56 D78/US07/FR1;P2.1 Red)', () => {
  it('对象页唯一 H1 是对象身份,机制标题「共同注视」不再是 h1(D78)', async () => {
    await renderCanvas('thread=t1&focus=post%3Ap1', {
      'thread:t1': threadEntity(),
      'post:p1': postEntity(),
    });
    await waitObjectSurfaceReady();
    // 现状 2 个 h1:「共同注视」(presentation-surface-host 机制标题)+「第一篇」。
    expect(h1Texts()).toEqual(['第一篇']);
  });

  it('focus=X 保留 T 的身份与返回路径:「返回本线」入口存在且保留 thread/scope(US07)', async () => {
    const container = await renderCanvas('thread=t1&focus=post%3Ap1&scope=publishing', {
      'thread:t1': threadEntity(),
      'post:p1': postEntity(),
    });
    await waitObjectSurfaceReady();
    const back = await screen.findByRole('link', { name: '返回本线' });
    const href = back.getAttribute('href') ?? '';
    expect(href).toContain('thread=t1');
    expect(href).toContain('scope=publishing');
    expect(href).toContain(`focus=${encodeURIComponent('thread:t1')}`);
    // 线身份随返回路径保留在页面上(US01:恢复一件事)。
    expect(container.textContent).toContain(THREAD_IDENTITY);
  });
});

describe('阅读空间结构(F56 FR4/D78;P2.1 Red,px 契约归 E2E)', () => {
  it('本线页默认无永久材料栏(书桌常驻栏退场,FR4/D78 决定 1)', async () => {
    const container = await renderCanvas('thread=t1&focus=thread%3At1', {
      'thread:t1': threadEntity(),
    });
    await waitSettled();
    expect(container.querySelector('[data-testid="thread-desk-rail"]')).toBeNull();
  });

  it('存在明确的「相关材料」展开入口,默认收起(FR4:材料默认关闭按需展开)', async () => {
    await renderCanvas('thread=t1&focus=thread%3At1', { 'thread:t1': threadEntity() });
    await waitSettled();
    const entry = await screen.findByRole('button', { name: /相关材料/ });
    expect(entry.getAttribute('aria-expanded')).toBe('false');
  });

  it('机制工具(重新载入/为什么/原始合同)收进次要工具入口,不占主区域首屏(D78/design §1)', async () => {
    const container = await renderCanvas('thread=t1&focus=post%3Ap1', {
      'thread:t1': threadEntity(),
      'post:p1': postEntity(),
    });
    await waitObjectSurfaceReady();
    expect(container.textContent).not.toContain('重新载入');
    expect(container.textContent).not.toContain('为什么这样展示');
    expect(container.textContent).not.toContain('原始合同');
  });

  it('钉住控件是「固定视图」舞台语义,不写「挂进本线」(FR5/US06;P3.1 修复)', async () => {
    const container = await renderCanvas('thread=t1&focus=post%3Ap1', {
      'thread:t1': threadEntity(),
      'post:p1': postEntity(),
    });
    await waitObjectSurfaceReady();
    // 现状:surface 卡钉住按钮文案为「📌 挂进本线」(presentation-surface-host),
    // 把本地视图偏好标作线成员语义。
    expect(container.textContent).not.toContain('挂进本线');
    expect(screen.getByRole('button', { name: /固定视图/ })).toBeTruthy();
  });
});
