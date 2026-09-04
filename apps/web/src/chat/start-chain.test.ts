import { readFileSync } from 'node:fs';

import { activeDefinitionOf, definitionSeedEvent, deriveSitemap, fold } from '@ui4a/engine';
import type { FlowDefinition, LogEvent, Sitemap } from '@ui4a/engine';
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
      { rel: 'applications', title: '应用', collection: true, scope: 'principal' },
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
  it('starts unlocated users at application discovery without choosing publishing', () => {
    const current = situation();
    current.scope = undefined;
    expect(start({ situation: current })).toEqual({ rel: 'applications' });
  });

  it('uses an owned workline before an application entry, but preserves explicit focus', () => {
    const current = { ...situation(), thread: 'release-1' };
    const snapshot = {
      ...snapshotFixture(),
      threads: {
        'release-1': {
          id: 'release-1',
          owner: current.principal,
          status: 'open' as const,
          goal: { text: '发布公告', source: 'message:goal' },
          references: { context: [], active: [], approval: [], event: [] },
          recentEventSeqs: [],
        },
      },
    };
    expect(start({ situation: current, snapshot })).toEqual({ rel: 'thread:release-1' });
    expect(start({ situation: { ...current, focus: 'post:welcome' }, snapshot })).toEqual({
      rel: 'post:welcome',
    });
    expect(start({ situation: { ...current, principal: 'another-user' }, snapshot })).toEqual({
      rel: 'flow:article-drafting',
    });
  });

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
      rel: 'applications',
      notice: {
        code: 'focus_degraded',
        droppedRel: 'ghost',
        startedRel: 'applications',
        startedTitle: '应用',
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

  it('meta 站:站内 focus 原样起步,无 focus 走应用定义目录', () => {
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
      rel: 'meta/applications',
    });
  });

  it('缺 application/entry 时回落应用目录', () => {
    expect(
      start({
        situation: situation({ focus: null }),
        snapshot: { ...snapshotFixture(), applications: {} },
      }),
    ).toEqual({ rel: 'applications' });
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

// ---------------------------------------------------------------------------
// T52 Phase 3:停用应用的 chat 发现链收缩钉测(sitemap 消费口径)。
//
// knownBusinessRels/siteFallbackRel 只消费 sitemap.surfaces 与
// snapshot.applications(入口声明)——两者在停用后分别经 service activeFlowList
// 过滤与 fold 删键收缩。本组用引擎真链路(fold 折叠停用态 → 按 service 同一
// 口径组装 deriveSitemap)钉住:停用应用的入口/表面不再进入发现面,存量实例
// 的存在性诚实保留(可读性由受众层裁决,P3b 已钉 403/404)。
// ---------------------------------------------------------------------------
describe('T52 停用联动:chat 发现链随 sitemap/applications 收缩', () => {
  const ARTICLE_FLOW: FlowDefinition = {
    name: 'article-drafting',
    title: '文章发布向导',
    initial: 'ready',
    app: 'publishing',
    nodes: [
      {
        name: 'ready',
        title: '就绪',
        actions: [
          {
            name: 'publish',
            title: '发布',
            to: 'done',
            effect: [{ type: 'append', collection: 'articles' }],
          },
        ],
      },
      { name: 'done', title: '完成', actions: [] },
    ],
  };
  const TODO_FLOW: FlowDefinition = {
    name: 'todo-lifecycle',
    title: '待办',
    initial: 'open',
    app: 'default',
    nodes: [
      {
        name: 'open',
        title: '打开',
        actions: [{ name: 'close', title: '完成', to: 'closed' }],
      },
      { name: 'closed', title: '已关闭', actions: [] },
    ],
  };
  const PUBLISHING_APP: ApplicationDefinition = {
    name: 'publishing',
    title: '内容发布',
    intent: '内容起草与发布',
    entry: { target: 'articles', role: 'primary-collection' },
  };
  const DEFAULT_APP: ApplicationDefinition = {
    name: 'default',
    title: '默认应用',
    intent: '兜底归组',
  };

  /** 停用后折叠态 + service 同口径组装的 sitemap(真链路,非手写 fixture)。 */
  function deprecatedChain(): { snapshot: EngineSnapshot; sitemap: Sitemap } {
    const registry = Object.fromEntries([ARTICLE_FLOW, TODO_FLOW].map((flow) => [flow.name, flow]));
    const log: LogEvent[] = [
      {
        seq: 1,
        kind: 'application-seeded',
        rel: 'meta/application:publishing',
        detail: { name: 'publishing', definition: PUBLISHING_APP },
      },
      {
        seq: 2,
        kind: 'application-seeded',
        rel: 'meta/application:default',
        detail: { name: 'default', definition: DEFAULT_APP },
      },
      definitionSeedEvent(3, ARTICLE_FLOW),
      definitionSeedEvent(4, TODO_FLOW),
      // 停用前写入的业务数据:存量实例保留(D71.4)。
      {
        seq: 5,
        kind: 'seed',
        detail: {
          instances: {
            'draft:one': { rel: 'draft:one', flow: 'article-drafting', node: 'ready', fields: {} },
          },
        },
      },
      {
        seq: 6,
        kind: 'application-deprecated',
        rel: 'meta/application:publishing',
        action: 'deprecate',
        actor: 'human',
        principal: 'user:mike',
        detail: { name: 'publishing', commandId: 'cmd:t52-start-chain-pin' },
      },
    ];
    const snapshot = fold(log, { flows: registry });
    const activeFlows = Object.entries(snapshot.definitions ?? {}).flatMap(([name, entry]) => {
      if (entry.status === 'deprecated') return [];
      const active = activeDefinitionOf(snapshot, name);
      return active === undefined ? [] : [active];
    });
    return {
      snapshot,
      sitemap: deriveSitemap(activeFlows, { applications: snapshot.applications }),
    };
  }

  it('knownBusinessRels:停用应用的表面与入口目标缺席;存量实例的存在性诚实保留', () => {
    const { snapshot, sitemap } = deprecatedChain();
    const known = knownBusinessRels(snapshot, sitemap);

    // 停用侧:flow 面、归属集合面、application 面与入口目标均不进发现面。
    expect(known.has('flow:article-drafting')).toBe(false);
    expect(known.has('articles')).toBe(false);
    expect(known.has('application:publishing')).toBe(false);
    // 存量实例保留在存在性表(可读性由受众层裁决,不是发现层的入口)。
    expect(known.has('draft:one')).toBe(true);
    // 活跃侧照常:另一应用的 flow 面与站点根仍在场。
    expect(known.has('flow:todo-lifecycle')).toBe(true);
    expect(known.has('application:default')).toBe(true);
    expect(known.has('applications')).toBe(true);
  });

  it('siteFallbackRel 消费口径:scope 指向停用应用时入口缺位,回落应用目录', () => {
    const { snapshot, sitemap } = deprecatedChain();
    // applications[scope] 已被 fold 删键 → 站点兜底不指向停用入口。
    expect(start({ situation: situation({ scope: 'publishing' }), snapshot, sitemap })).toEqual({
      rel: 'applications',
    });
  });

  it('停用应用的 focus 走降级回执(结构化 notice + 站点兜底),活跃应用照常起步', () => {
    const { snapshot, sitemap } = deprecatedChain();
    expect(
      start({
        situation: situation({ scope: 'publishing', focus: 'flow:article-drafting' }),
        snapshot,
        sitemap,
      }),
    ).toEqual({
      rel: 'applications',
      notice: {
        code: 'focus_degraded',
        droppedRel: 'flow:article-drafting',
        startedRel: 'applications',
        startedTitle: '应用',
      },
    });
    // 反向锚:活跃应用的 flow 面照常起步,无 notice。
    expect(
      start({
        situation: situation({ scope: 'default', focus: 'flow:todo-lifecycle' }),
        snapshot,
        sitemap,
      }),
    ).toEqual({ rel: 'flow:todo-lifecycle' });
  });
});
