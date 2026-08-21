/**
 * 词条组件测试的合同 fixtures:与引擎投影同形的 Siren 实体(种子域)
 * ——articles 集合(成员带 fields.title/fields.category 与 node)、
 * 事件成员、拓扑实体、diff 实体。测试口径:给 deref 输出 → 组件树含
 * 预期内容(spec 架构决定 2 的渲染链:bind → deref → 词条)。
 */
import type { SirenEntity } from '@ui4a/engine';

import type { EntityCache } from '../deref';
import type { RenderSpec } from '../spec';

/** 文章成员(post-status 实例投影;fields 是投影后的扁平形状)。 */
function postMember(rel: string, node: string, title: string, category: string): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    rel: ['item'],
    href: `/api/entity?rel=${encodeURIComponent(rel)}`,
    properties: { rel, node, title: node, fields: { title, category } },
    actions: [],
    links: [],
  };
}

/** articles 集合实体(种子域:2 篇 published,tech/essay 各一)。 */
export function articlesCollection(): SirenEntity {
  return {
    class: ['collection', 'articles'],
    properties: { rel: 'articles', count: 2 },
    actions: [],
    links: [
      { rel: ['self'], href: '/api/entity?rel=articles' },
      { rel: ['flow'], href: '/api/entity?rel=flow:article-drafting' },
    ],
    'guard-results': [],
    entities: [
      postMember('post:post-welcome', 'published', '欢迎来到 UI4A', 'tech'),
      postMember('post:first-post', 'published', '第一篇', 'essay'),
    ],
  };
}

/** 事件日志成员(事件流页的投影形状:seq/kind/rel/action 标量)。 */
export function eventMember(
  seq: number,
  kind: string,
  rel: string,
  action?: string,
): SirenEntity {
  return {
    class: ['event'],
    rel: ['item'],
    properties: { seq, kind, rel, ...(action !== undefined ? { action } : {}) },
    actions: [],
    links: [],
  };
}

/** articles 域的实体缓存(集合 + 实体引用均可解)。 */
export function articlesCache(): EntityCache {
  return new Map([
    ['articles', articlesCollection()],
    ['post:post-welcome', articlesCollection().entities![0]!],
  ]);
}

/** 拓扑实体(flow 词条的 graph 引用目标;sitemap 拓扑来自实体数据)。 */
export function graphEntity(): SirenEntity {
  return {
    class: ['sitemap'],
    properties: {
      rel: 'sitemap:main',
      nodes: [
        { id: 'home', label: '首页' },
        { id: 'articles', label: '文章' },
        { id: 'article', label: '文章详情' },
        { id: 'inbox', label: '收件箱' },
      ],
      edges: [
        { from: 'home', to: 'articles' },
        { from: 'articles', to: 'article' },
        { from: 'home', to: 'inbox' },
      ],
    },
    actions: [],
    links: [],
  };
}

/** 机械 diff 实体(diff 词条的 entity 引用目标;DefinitionDiff 载荷)。 */
export function diffEntity(): SirenEntity {
  return {
    class: ['render-source', 'diff'],
    properties: {
      rel: 'activation:a1',
      diff: {
        algorithm: 'deep-object-diff',
        before: { name: 'old-flow', initial: 'draft' },
        after: { name: 'new-flow', initial: 'ready' },
        changed: {
          added: {},
          deleted: {},
          updated: { name: 'new-flow', initial: 'ready' },
        },
      },
    },
    actions: [],
    links: [],
  };
}

/** 带 Markdown 正文的实体(markdown 词条的 entity 引用目标)。 */
export function markdownEntity(body: string): SirenEntity {
  return {
    class: ['render-source', 'markdown'],
    properties: { rel: 'post:post-welcome', fields: { body } },
    actions: [],
    links: [],
  };
}

/** 构造 render spec(词条测试的输入;bind 全引用,零字面)。 */
export function specOf(
  component: string,
  bind: RenderSpec['bind'],
  concern = `test:${component}`,
): RenderSpec {
  return { concern, component, bind };
}
