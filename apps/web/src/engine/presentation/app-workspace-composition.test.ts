import { describe, expect, it } from 'vitest';

import type { BuiltinCompositionDeclaration } from './compositions';
import {
  appWorkspaceScopeOf,
  createDynamicCompositionSubjectResolver,
  deriveAppWorkspaceComposition,
  type AppWorkspaceSitemapView,
} from './app-workspace-composition';

/**
 * T37 Phase B fixtures:与线上业务 sitemap 同构(publishing/community/todo 三个
 * application 的 surfaces + applications 分组),含 community 的关键事实——
 * comments 集合面归属 app 'default',community 仅经 entry 声明指向它。
 */
function fixtureSitemap(): AppWorkspaceSitemapView {
  return {
    surfaces: [
      { rel: 'flow:article-drafting', title: '文章发布向导', app: 'publishing' },
      { rel: 'flow:post-status', title: '文章状态', app: 'publishing' },
      { rel: 'flow:comment-moderation', title: '评论审核', app: 'community' },
      { rel: 'flow:todo-capture', title: '待办捕捉', app: 'todo' },
      { rel: 'flow:todo-item', title: '待办状态', app: 'todo' },
      { rel: 'articles', title: 'articles', collection: true, app: 'publishing' },
      { rel: 'todos', title: 'todos', collection: true, app: 'todo' },
      { rel: 'comments', title: '评论', collection: true, app: 'default' },
      { rel: 'inbox', title: '确认收件箱', collection: true, scope: 'principal' },
    ],
    applications: [
      {
        name: 'publishing',
        title: '内容发布',
        intent: '写、审、发一条龙',
        entry: 'flow:article-drafting',
        flows: [
          { name: 'article-drafting', app: 'publishing' },
          { name: 'post-status', app: 'publishing' },
        ],
      },
      {
        name: 'community',
        title: '社区互动',
        intent: '评论的审核与治理',
        entry: 'comments',
        flows: [{ name: 'comment-moderation', app: 'community' }],
      },
      {
        name: 'todo',
        title: '待办',
        intent: '快速捕捉待办',
        entry: 'flow:todo-capture',
        flows: [
          { name: 'todo-capture', app: 'todo' },
          { name: 'todo-item', app: 'todo' },
        ],
      },
      { name: 'empty', title: '空应用', intent: '无成员应用', flows: [] },
    ],
  };
}

function regionTriple(declaration: BuiltinCompositionDeclaration): Array<[string, string, string]> {
  return declaration.regions.map((region) => [region.region, region.source, region.intent]);
}

describe('app workspace composition derivation(sitemap 运行时推导,零 per-app 代码)', () => {
  it('publishing:产物集合 region 在前,声明 entry 的向导面收尾', () => {
    const declaration = deriveAppWorkspaceComposition('publishing', fixtureSitemap());
    expect(declaration).toBeDefined();
    expect(declaration!.id).toBe('app-publishing');
    expect(regionTriple(declaration!)).toEqual([
      ['articles', 'articles', '浏览 内容发布 的产物'],
      ['article-drafting', 'flow:article-drafting', '发起 内容发布 的流程'],
    ]);
    expect(declaration!.regions[0]).toMatchObject({ mode: 'invalidate', shape: 'collection' });
    expect(declaration!.regions[1]).toMatchObject({ mode: 'invalidate', shape: 'entity' });
  });

  it('产物集合 region 声明 density=table(成员表格化),入口 region 不受影响', () => {
    const declaration = deriveAppWorkspaceComposition('publishing', fixtureSitemap());
    expect(declaration).toBeDefined();
    // 产物集合(articles)→ 表格密度;入口向导面(article-drafting)→ 缺省 card。
    expect(declaration!.regions[0]!.density).toBe('table');
    expect(declaration!.regions[1]!.density).toBeUndefined();
    // community 的唯一 region 经 entry 兑现集合面——入口 region 密度缺省,不升级。
    const community = deriveAppWorkspaceComposition('community', fixtureSitemap());
    expect(community!.regions[0]!.density).toBeUndefined();
  });

  it('community:entry 指向跨 app 归属的集合面时,经 entry 兑现唯一 collection region(U4)', () => {
    const declaration = deriveAppWorkspaceComposition('community', fixtureSitemap());
    expect(declaration).toBeDefined();
    expect(regionTriple(declaration!)).toEqual([['comments', 'comments', '浏览 社区互动 的产物']]);
    expect(declaration!.regions[0]).toMatchObject({ mode: 'invalidate', shape: 'collection' });
  });

  it('todo:同一函数吃 todo 数据得同款结构(同一推导路径,零特判)', () => {
    const declaration = deriveAppWorkspaceComposition('todo', fixtureSitemap());
    expect(declaration).toBeDefined();
    expect(regionTriple(declaration!)).toEqual([
      ['todos', 'todos', '浏览 待办 的产物'],
      ['todo-capture', 'flow:todo-capture', '发起 待办 的流程'],
    ]);
  });

  it('同一函数吃任意合成数据仍同构:entry 缺省回退首个 flow 面,region id 经消毒仍合法', () => {
    const declaration = deriveAppWorkspaceComposition('alpha', {
      surfaces: [
        { rel: 'widgets.x', title: 'widgets', collection: true, app: 'alpha' },
        { rel: 'meta/flows', title: '异形向导', app: 'alpha' },
      ],
      applications: [{ name: 'alpha', title: 'Alpha', intent: '合成应用' }],
    });
    expect(declaration).toBeDefined();
    expect(declaration!.regions.map((region) => region.region)).toEqual([
      'widgets.x',
      'meta-flows',
    ]);
    expect(declaration!.regions[1]!.source).toBe('meta/flows');
    expect(declaration!.regions[1]!.shape).toBe('entity');
    expect(declaration!.regions[1]!.intent).toBe('发起 Alpha 的流程');
  });

  it('无成员应用与未知 scope 诚实空态(undefined,不伪装内容)', () => {
    expect(deriveAppWorkspaceComposition('empty', fixtureSitemap())).toBeUndefined();
    expect(deriveAppWorkspaceComposition('nonexistent', fixtureSitemap())).toBeUndefined();
  });

  it('声明冻结,调用方不可变改注册数据', () => {
    const declaration = deriveAppWorkspaceComposition('publishing', fixtureSitemap());
    expect(declaration).toBeDefined();
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration!.regions)).toBe(true);
    expect(Object.isFrozen(declaration!.regions[0])).toBe(true);
    expect(() => {
      (declaration!.regions as unknown as Array<{ source: string }>)[0]!.source = 'changed';
    }).toThrow(TypeError);
  });
});

describe('workspace:app:<scope> subject 解析', () => {
  it('只对 workspace:app: 前缀给出 scope,其余 subject 不适用', () => {
    expect(appWorkspaceScopeOf('workspace:app:publishing')).toBe('publishing');
    expect(appWorkspaceScopeOf('workspace:app:todo')).toBe('todo');
    expect(appWorkspaceScopeOf('workspace:my-work')).toBeUndefined();
    expect(appWorkspaceScopeOf('articles')).toBeUndefined();
    expect(appWorkspaceScopeOf('workspace:app:')).toBeUndefined();
    expect(appWorkspaceScopeOf('workspace:app')).toBeUndefined();
  });

  it('动态解析器:静态注册优先,app 前缀经 sitemap 推导,未知 scope 维持拒绝', async () => {
    const resolver = createDynamicCompositionSubjectResolver(async () => fixtureSitemap());

    const builtin = await resolver('workspace:my-work');
    expect(builtin.kind).toBe('composition');

    const derived = await resolver('workspace:app:community');
    expect(derived.kind).toBe('composition');
    if (derived.kind === 'composition') {
      expect(derived.declaration.id).toBe('app-community');
      expect(derived.declaration.regions.map((region) => region.source)).toEqual(['comments']);
    }

    const ordinary = await resolver('articles');
    expect(ordinary).toEqual({ kind: 'not-workspace' });

    const unknown = await resolver('workspace:app:nonexistent');
    expect(unknown).toEqual({ kind: 'rejected-workspace' });
    const malformed = await resolver('workspace:app:');
    expect(malformed).toEqual({ kind: 'rejected-workspace' });
  });

  it('sitemap 暂不可得时 app 前缀 subject 诚实拒绝,不伪造声明', async () => {
    const resolver = createDynamicCompositionSubjectResolver(async () => undefined);
    expect(await resolver('workspace:app:publishing')).toEqual({ kind: 'rejected-workspace' });
  });
});
