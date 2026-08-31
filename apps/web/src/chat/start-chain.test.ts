import { readFileSync } from 'node:fs';

import type { Sitemap } from '@ui4a/engine';
import type { ApplicationDefinition, ApplicationEntry, EngineSnapshot } from '@ui4a/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Situation } from '../engine/situation';
import { knownBusinessRels, resolveStartRel } from './start-chain';

function application(name: string, target?: string): ApplicationDefinition {
  return {
    name,
    title: `${name} application`,
    intent: `Operate the ${name} scope`,
    ...(target === undefined
      ? {}
      : {
          entry: {
            target,
            role: 'primary-task',
          } satisfies ApplicationEntry,
        }),
  };
}

function situation({
  site = 'workstation',
  scope = 'publishing',
  focus = null,
}: {
  site?: string;
  scope?: string;
  focus?: Situation['focus'];
} = {}): Situation {
  return {
    principal: 'user:start-chain',
    site,
    scope,
    thread: null,
    focus,
    disclosure: { scope, thread: null, focus },
  };
}

/** 最小定义条目(受众谓词读 flow.app 归属)。 */
function definitionEntry(
  name: string,
  app: string,
): NonNullable<EngineSnapshot['definitions']>[string] {
  return {
    name,
    version: 1,
    status: 'active',
    definition: { name, initial: 'start', nodes: [], app },
  };
}

function snapshotFixture(): EngineSnapshot {
  return {
    instances: {
      'post:welcome': { rel: 'post:welcome', flow: 'article-drafting', node: 'draft', fields: {} },
      'todo:ui': { rel: 'todo:ui', flow: 'todo-lifecycle', node: 'open', fields: {} },
    },
    collections: { articles: ['post:welcome'], todos: [] },
    definitions: {
      'article-drafting': definitionEntry('article-drafting', 'publishing'),
      'todo-lifecycle': definitionEntry('todo-lifecycle', 'default'),
    },
    applications: {
      publishing: application('publishing', 'flow:article-drafting'),
      default: application('default'),
    },
  };
}

function sitemapFixture(): Sitemap {
  return {
    version: 'test',
    surfaces: [
      { rel: 'flow:article-drafting', title: '文章草稿', app: 'publishing' },
      { rel: 'articles', title: '文章', collection: true, app: 'publishing' },
      { rel: 'todos', title: '待办', collection: true, app: 'default' },
      { rel: 'application:publishing', title: '发布应用', app: 'publishing' },
      { rel: 'application:default', title: '默认应用', app: 'default' },
    ],
    flows: [],
    applications: [],
    capabilities: [],
  };
}

function start(args: {
  situation: Situation;
  snapshot?: EngineSnapshot;
  sitemap?: Sitemap;
  granted?: readonly string[] | null;
}): ReturnType<typeof resolveStartRel> {
  return resolveStartRel({
    situation: args.situation,
    snapshot: args.snapshot ?? snapshotFixture(),
    sitemap: args.sitemap ?? sitemapFixture(),
    granted: args.granted ?? null,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('knownBusinessRels(存在性权威)', () => {
  it('覆盖实例/集合/sitemap 表面/应用入口,不含 workspace 虚主体', () => {
    const known = knownBusinessRels(snapshotFixture(), sitemapFixture());

    expect(known.has('post:welcome')).toBe(true);
    expect(known.has('articles')).toBe(true);
    expect(known.has('todos')).toBe(true);
    expect(known.has('flow:article-drafting')).toBe(true);
    expect(known.has('application:publishing')).toBe(true);
    expect(known.has('workspace:app:editorial')).toBe(false);
    expect(known.has('ghost')).toBe(false);
  });
});

describe('resolveStartRel', () => {
  it('合法业务实体 focus 原样保留,无 notice', () => {
    for (const focus of ['post:welcome', 'flow:article-drafting', 'articles']) {
      expect(start({ situation: situation({ focus }) })).toEqual({ rel: focus });
    }
  });

  it('selection focus 与无 focus 走 scope entry,无 notice', () => {
    expect(start({ situation: situation({ focus: { selection: ['post:first'] } }) })).toEqual({
      rel: 'flow:article-drafting',
    });
    expect(start({ situation: situation() })).toEqual({ rel: 'flow:article-drafting' });
  });

  it('虚主体 workspace:app:* 回落 scope entry 且附结构化 notice(合同标题主行)', () => {
    expect(start({ situation: situation({ focus: 'workspace:app:editorial' }) })).toEqual({
      rel: 'flow:article-drafting',
      notice: {
        code: 'focus_degraded',
        droppedRel: 'workspace:app:editorial',
        startedRel: 'flow:article-drafting',
        startedTitle: '文章草稿',
      },
    });
  });

  it('不存在 focus 回落站点兜底并附 notice(标题缺省时中性行)', () => {
    const noEntry = {
      ...snapshotFixture(),
      applications: { ...snapshotFixture().applications, publishing: application('publishing') },
    };

    expect(start({ situation: situation({ focus: 'ghost' }), snapshot: noEntry })).toEqual({
      rel: 'articles',
      notice: {
        code: 'focus_degraded',
        droppedRel: 'ghost',
        startedRel: 'articles',
        startedTitle: '文章',
      },
    });
  });

  it('授权外 focus(credential)回落;授权内保留;local 模式不应用受众谓词', () => {
    // credential:todo:ui 属 default 应用,授权集合 [publishing] 不含 → 回落。
    expect(
      start({ situation: situation({ focus: 'todo:ui' }), granted: ['publishing'] }),
    ).toMatchObject({
      rel: 'flow:article-drafting',
      notice: expect.objectContaining({ code: 'focus_degraded' }),
    });
    // 授权内:post:welcome 属 publishing → 保留。
    expect(
      start({ situation: situation({ focus: 'post:welcome' }), granted: ['publishing'] }),
    ).toEqual({
      rel: 'post:welcome',
    });
    // local 模式(受众谓词不适用):跨应用实体照常起步。
    expect(start({ situation: situation({ focus: 'todo:ui' }), granted: null })).toEqual({
      rel: 'todo:ui',
    });
  });

  it('meta 站:站内 focus 原样起步(meta rel 不进业务存在性表),无 focus 走 meta/flows', () => {
    expect(
      start({
        situation: situation({
          site: 'meta',
          scope: 'governance',
          focus: 'meta/flow:article-drafting',
        }),
      }),
    ).toEqual({ rel: 'meta/flow:article-drafting' });
    expect(start({ situation: situation({ site: 'meta', scope: 'governance' }) })).toEqual({
      rel: 'meta/flows',
    });
  });

  it('缺 application/entry 时回落站点兜底(articles)', () => {
    expect(
      start({
        situation: situation({ focus: null }),
        snapshot: { ...snapshotFixture(), applications: {} },
      }),
    ).toEqual({ rel: 'articles' });
  });

  it('纯函数:不做可达性探测、零 I/O;args 对象单参 API', () => {
    const fetchProbe = vi.fn(() => {
      throw new Error('start-chain must not probe entity reachability');
    });
    vi.stubGlobal('fetch', fetchProbe);

    expect(resolveStartRel).toHaveLength(1);
    expect(start({ situation: situation({ focus: 'post:welcome' }) })).toEqual({
      rel: 'post:welcome',
    });
    expect(fetchProbe).not.toHaveBeenCalled();
  });

  it('keeps lexical matching and request inputs out of the start chain source', () => {
    const implementation = readFileSync(new URL('./start-chain.ts', import.meta.url), 'utf8');

    expect(implementation).not.toMatch(/from\s+['"]@ui4a\/agent(?:\/[^'"]*)?['"]/);
    expect(implementation).not.toContain('protocol/match');
    expect(implementation).not.toMatch(/\boverlaps\b/);
    expect(implementation).not.toMatch(/\b(?:fetch|baseUrl|goal)\b/);
  });
});
