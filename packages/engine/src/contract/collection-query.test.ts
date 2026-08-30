import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';
import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';

import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
  seedSnapshot,
} from '../core/fixtures';
import {
  COLLECTION_PAGE_SIZE,
  parseCollectionQuery,
  project,
  queryTargetRejection,
} from './siren/index';

const deps = {
  flows: flowRegistry(articleDraftingFlow, postStatusFlow, commentModerationFlow),
  guards: seedGuardRegistry,
};

/**
 * T38 FR1 / D54 合同锚点:同 fixture 无参数集合投影 JSON 与当前 canonical
 * 单 wire 投影逐字节一致;分页/过滤机制只允许在查询参数在场时生效,无参数路径
 * 保持完整全量发现面(CLI/外部 agent 的合同承诺)。
 */
const ARTICLES_FULL_ANCHOR =
  '{"class":["collection","articles"],"properties":{"rel":"articles","count":2},"actions":[],"links":[{"rel":["self"],"href":"/api/entity?rel=articles"}],"guard-results":[],"entities":[{"class":["flow-instance","post-status"],"properties":{"rel":"post:post-welcome","flow":"post-status","node":"published","title":"已发布","identity":"Welcome to UI4A","status":"published","fields":{"title":"Welcome to UI4A","category":"tech"},"presentation":{"version":1,"fields":[{"path":"properties.fields.title","title":"title","role":"identity"},{"path":"properties.fields.category","title":"category","role":"metadata"}]}},"actions":[{"name":"unpublish","title":"下线","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false}},{"name":"archive","title":"归档","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false},"requires-confirmation":"high"}],"links":[{"rel":["self"],"href":"/api/entity?rel=post:post-welcome"},{"rel":["collection"],"href":"/api/entity?rel=articles"}],"guard-results":[{"action":"unpublish","blocked":false,"guards":[]},{"action":"archive","blocked":false,"guards":[]}],"rel":["item"],"href":"/api/entity?rel=post:post-welcome"},{"class":["flow-instance","post-status"],"properties":{"rel":"post:post-getting-started","flow":"post-status","node":"published","title":"已发布","identity":"Getting Started","status":"published","fields":{"title":"Getting Started","category":"essay"},"presentation":{"version":1,"fields":[{"path":"properties.fields.title","title":"title","role":"identity"},{"path":"properties.fields.category","title":"category","role":"metadata"}]}},"actions":[{"name":"unpublish","title":"下线","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false}},{"name":"archive","title":"归档","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false},"requires-confirmation":"high"}],"links":[{"rel":["self"],"href":"/api/entity?rel=post:post-getting-started"},{"rel":["collection"],"href":"/api/entity?rel=articles"}],"guard-results":[{"action":"unpublish","blocked":false,"guards":[]},{"action":"archive","blocked":false,"guards":[]}],"rel":["item"],"href":"/api/entity?rel=post:post-getting-started"}]}';

describe('parseCollectionQuery — 集合读面查询参数解析(T38 FR1)', () => {
  it('无参数(undefined/无 offset)→ none:全量路径,零分页机制生效', () => {
    expect(parseCollectionQuery(undefined)).toEqual({ kind: 'none' });
    expect(parseCollectionQuery({})).toEqual({ kind: 'none' });
  });

  it('合法 offset(含 0)→ query', () => {
    expect(parseCollectionQuery({ offset: '0' })).toEqual({
      kind: 'query',
      query: { offset: 0, filter: [] },
    });
    expect(parseCollectionQuery({ offset: '20' })).toEqual({
      kind: 'query',
      query: { offset: 20, filter: [] },
    });
  });

  it('非法 offset → 结构化拒绝(layer/reason,拒绝即教育)', () => {
    for (const offset of ['abc', '-1', '1.5', '', '1e3', ' ', '+2']) {
      const parsed = parseCollectionQuery({ offset });
      expect(parsed.kind, `offset=${JSON.stringify(offset)}`).toBe('rejected');
      if (parsed.kind !== 'rejected') continue;
      expect(parsed.rejection.layer).toBe('query');
      expect(parsed.rejection.reason).toBe('invalid-offset');
      expect(parsed.rejection.message).toContain('offset');
    }
    // 超出安全整数范围的超大值同样拒绝(诚实拒绝,不静默截断)。
    expect(parseCollectionQuery({ offset: '99999999999999999999' }).kind).toBe('rejected');
  });
});

describe('queryTargetRejection — 查询参数目标判定(仅业务成员集合可查询)', () => {
  it('成员集合(快照集合表/append 声明)→ 无拒绝', () => {
    expect(queryTargetRejection(seedSnapshot, deps.flows, 'articles')).toBeUndefined();
    expect(queryTargetRejection(seedSnapshot, deps.flows, 'comments')).toBeUndefined();
  });

  it('非集合实体与非成员集合视图 → 结构化拒绝(教育:何处可用分页)', () => {
    for (const rel of [
      'post:post-welcome',
      'confirmation:x',
      'inbox',
      'threads',
      'flow:article-drafting',
    ]) {
      const rejection = queryTargetRejection(seedSnapshot, deps.flows, rel);
      expect(rejection, `rel=${rel}`).not.toBeUndefined();
      expect(rejection?.layer).toBe('query');
      expect(rejection?.reason).toBe('query-target-not-pageable');
    }
  });
});

describe('project — 集合分页(查询参数在场时服务端驱动切片)', () => {
  it('无参数全量:投影 JSON 与当前 canonical 单 wire 逐字节一致', () => {
    expect(JSON.stringify(project(seedSnapshot, 'articles', deps))).toBe(ARTICLES_FULL_ANCHOR);
  });

  it('offset 切片嵌入成员;properties 声明 count(本页)与 offset;prev/next 诚实缺链', () => {
    const entity = project(seedSnapshot, 'articles', deps, { offset: 1, filter: [] });
    expect(entity?.entities?.map((child) => child.properties.rel)).toEqual([
      'post:post-getting-started',
    ]);
    expect(entity?.properties).toEqual({ rel: 'articles', count: 1, offset: 1 });
    // 末页:无 next;offset>0:prev 回到 0。
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=1' },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=0' },
    ]);
  });

  it('首页(offset=0):无 prev 无 next(短于页大小),self 携带 offset', () => {
    const entity = project(seedSnapshot, 'articles', deps, { offset: 0, filter: [] });
    expect(entity?.properties).toEqual({ rel: 'articles', count: 2, offset: 0 });
    expect(entity?.links).toEqual([{ rel: ['self'], href: '/api/entity?rel=articles&offset=0' }]);
    expect(entity?.entities).toHaveLength(2);
  });

  it('多页集合:页大小 = 投影策略常量;next/prev 按声明序推进(零重叠零缺口)', () => {
    const snapshot = pagedSnapshot(COLLECTION_PAGE_SIZE * 2 + 5);
    const first = project(snapshot, 'articles', deps, { offset: 0, filter: [] });
    expect(first?.entities).toHaveLength(COLLECTION_PAGE_SIZE);
    expect(first?.properties).toEqual({ rel: 'articles', count: COLLECTION_PAGE_SIZE, offset: 0 });
    expect(first?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['next'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE}` },
    ]);

    const middle = project(snapshot, 'articles', deps, {
      offset: COLLECTION_PAGE_SIZE,
      filter: [],
    });
    expect(middle?.entities).toHaveLength(COLLECTION_PAGE_SIZE);
    expect(middle?.links).toEqual([
      { rel: ['self'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE}` },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['next'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE * 2}` },
    ]);

    const last = project(snapshot, 'articles', deps, {
      offset: COLLECTION_PAGE_SIZE * 2,
      filter: [],
    });
    expect(last?.entities).toHaveLength(5);
    expect(last?.properties).toEqual({
      rel: 'articles',
      count: 5,
      offset: COLLECTION_PAGE_SIZE * 2,
    });
    expect(last?.links).toEqual([
      { rel: ['self'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE * 2}` },
      { rel: ['prev'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE}` },
    ]);
  });

  it('offset 越过末尾 → 诚实空页(count=0,prev 在场,无 next)', () => {
    const snapshot = pagedSnapshot(5);
    const entity = project(snapshot, 'articles', deps, { offset: 100, filter: [] });
    expect(entity?.entities).toEqual([]);
    expect(entity?.properties).toEqual({ rel: 'articles', count: 0, offset: 100 });
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=100' },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=80' },
    ]);
  });

  it('非成员对齐 offset(滑动窗口):next 起点 = offset + 本页长度,不跳行', () => {
    const snapshot = pagedSnapshot(COLLECTION_PAGE_SIZE + 7);
    const entity = project(snapshot, 'articles', deps, { offset: 4, filter: [] });
    expect(entity?.entities).toHaveLength(COLLECTION_PAGE_SIZE);
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=4' },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['next'], href: `/api/entity?rel=articles&offset=${4 + COLLECTION_PAGE_SIZE}` },
    ]);
  });

  it('baseHref 注入分页链接前缀(与 self 同口径)', () => {
    const entity = project(
      seedSnapshot,
      'articles',
      { ...deps, baseHref: 'http://localhost:3100' },
      {
        offset: 1,
        filter: [],
      },
    );
    expect(entity?.links?.[0]?.href).toBe('http://localhost:3100/api/entity?rel=articles&offset=1');
  });

  it('投影是纯函数:查询切片不改输入快照', () => {
    const before = JSON.stringify(seedSnapshot);
    project(seedSnapshot, 'articles', deps, { offset: 1, filter: [] });
    expect(JSON.stringify(seedSnapshot)).toBe(before);
  });
});

/** 生成 count 篇文章的快照(成员序 = 声明序,验证多页推进)。 */
function pagedSnapshot(count: number): EngineSnapshot {
  const instances: EngineSnapshot['instances'] = {};
  const members: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const rel = `post:p-${index}`;
    instances[rel] = {
      rel,
      flow: 'post-status',
      node: 'published',
      fields: { title: { value: `第 ${index} 篇`, origin: 'intent' } },
    };
    members.push(rel);
  }
  return {
    ...seedSnapshot,
    instances: { ...seedSnapshot.instances, ...instances },
    collections: { articles: members },
  };
}

// ---------------------------------------------------------------------------
// T38 FR3:声明式过滤(声明住定义平面 = flow 的 collections 声明;值域引用
// 流拓扑推导:status 维度取节点集,字段维度取 select options;service 层
// 零「集合名 → 值域」特判映射)。
// ---------------------------------------------------------------------------

import { collectionFilterDeclarations, resolveCollectionFilters } from './siren/index';

/** comment-moderation fixture + comments 集合的 status 过滤声明(与 bundle 同构)。 */
const commentFlowWithFilters: FlowDefinition = {
  ...commentModerationFlow,
  collections: [{ collection: 'comments', filters: [{ field: 'status', title: '状态' }] }],
};

/** post-status fixture + articles 集合的 status/category 过滤声明(测试专用组合)。 */
const postFlowWithFilters: FlowDefinition = {
  ...postStatusFlow,
  fields: [
    {
      name: 'category',
      type: 'select',
      title: '分类',
      options: ['tech', 'essay', 'review'],
      presentation: { role: 'metadata' },
    },
  ],
  collections: [
    {
      collection: 'articles',
      filters: [
        { field: 'status', title: '状态' },
        { field: 'category', title: '分类' },
      ],
    },
  ],
};

describe('collectionFilterDeclarations — 声明解析与值域拓扑推导(T38 FR3)', () => {
  it('status 维度值域 = 声明 flow 的节点集(值 = 节点名,标题 = 节点标题)', () => {
    const dims = collectionFilterDeclarations(flowRegistry(commentFlowWithFilters), 'comments');
    expect(dims).toEqual([
      {
        field: 'status',
        title: '状态',
        values: [
          { value: 'pending', title: '待处理' },
          { value: 'approved', title: '已通过' },
          { value: 'rejected', title: '已驳回' },
        ],
      },
    ]);
  });

  it('select 字段维度值域 = 字段 options(标题 = 值本身)', () => {
    const dims = collectionFilterDeclarations(flowRegistry(postFlowWithFilters), 'articles');
    expect(dims).toHaveLength(2);
    expect(dims[1]).toEqual({
      field: 'category',
      title: '分类',
      values: [
        { value: 'tech', title: 'tech' },
        { value: 'essay', title: 'essay' },
        { value: 'review', title: 'review' },
      ],
    });
  });

  it('未声明集合 → 空数组(零发明);多 flow 声明同集合按字段去重,首声明优先', () => {
    expect(collectionFilterDeclarations(deps.flows, 'comments')).toEqual([]);
    const duplicate = {
      ...commentFlowWithFilters,
      name: 'comment-moderation-b',
      collections: [
        {
          collection: 'comments',
          filters: [
            { field: 'status', title: '另一标题' },
            { field: 'category', title: '分类' },
          ],
        },
      ],
    };
    const dims = collectionFilterDeclarations(
      flowRegistry(commentFlowWithFilters, duplicate),
      'comments',
    );
    expect(dims.map((dim) => dim.field)).toEqual(['status', 'category']);
    expect(dims[0]?.title).toBe('状态');
  });
});

describe('parseCollectionQuery — filter 参数语法层', () => {
  it('filter 维度对原样解析;重复维度 / 空维度名 → 结构化拒绝', () => {
    expect(parseCollectionQuery({ filter: [{ dimension: 'status', value: 'pending' }] })).toEqual({
      kind: 'query',
      query: { offset: 0, filter: [{ dimension: 'status', value: 'pending' }] },
    });
    const duplicate = parseCollectionQuery({
      filter: [
        { dimension: 'status', value: 'pending' },
        { dimension: 'status', value: 'approved' },
      ],
    });
    expect(duplicate.kind).toBe('rejected');
    if (duplicate.kind === 'rejected') expect(duplicate.rejection.reason).toBe('invalid-filter');
    const empty = parseCollectionQuery({ filter: [{ dimension: '', value: 'x' }] });
    expect(empty.kind).toBe('rejected');
    if (empty.kind === 'rejected') expect(empty.rejection.reason).toBe('invalid-filter');
  });
});

describe('resolveCollectionFilters — 声明与值域裁决(语义层)', () => {
  it('声明维度 + 值域内 → 放行(携带解析后的声明)', () => {
    const resolved = resolveCollectionFilters(flowRegistry(commentFlowWithFilters), 'comments', [
      { dimension: 'status', value: 'pending' },
    ]);
    expect(resolved.kind).toBe('matched');
  });

  it('未声明维度 → 结构化拒绝(声明外维度零静默)', () => {
    const resolved = resolveCollectionFilters(flowRegistry(commentFlowWithFilters), 'comments', [
      { dimension: 'author', value: 'mike' },
    ]);
    expect(resolved.kind).toBe('rejected');
    if (resolved.kind === 'rejected') {
      expect(resolved.rejection.reason).toBe('undeclared-filter-dimension');
      expect(resolved.rejection.message).toContain('author');
    }
  });

  it('值域外取值 → 结构化拒绝(拒绝即教育)', () => {
    const resolved = resolveCollectionFilters(flowRegistry(commentFlowWithFilters), 'comments', [
      { dimension: 'status', value: 'ghost' },
    ]);
    expect(resolved.kind).toBe('rejected');
    if (resolved.kind === 'rejected') {
      expect(resolved.rejection.reason).toBe('unknown-filter-value');
      expect(resolved.rejection.message).toContain('ghost');
    }
  });

  it('未声明集合上的任何过滤 → 未声明维度拒绝(articles 无声明同口径)', () => {
    const resolved = resolveCollectionFilters(deps.flows, 'articles', [
      { dimension: 'status', value: 'published' },
    ]);
    expect(resolved.kind).toBe('rejected');
    if (resolved.kind === 'rejected') {
      expect(resolved.rejection.reason).toBe('undeclared-filter-dimension');
    }
  });
});

describe('project — 声明式过滤与组合(T38 FR3)', () => {
  const filterDeps = {
    flows: flowRegistry(commentFlowWithFilters),
    guards: seedGuardRegistry,
  };

  it('过滤收窄成员(status=pending → 3 行,排除 approved);count = 过滤后本页数', () => {
    const entity = project(seedSnapshot, 'comments', filterDeps, {
      offset: 0,
      filter: [{ dimension: 'status', value: 'pending' }],
    });
    expect(entity?.entities?.map((child) => child.properties.rel)).toEqual([
      'comment:c1',
      'comment:c2',
      'comment:c3',
    ]);
    expect(entity?.properties).toMatchObject({ rel: 'comments', count: 3, offset: 0 });
  });

  it('过滤 + 分页组合:先过滤后分页;next/prev 携带过滤参数(组合不丢状态)', () => {
    const page = project(seedSnapshot, 'comments', filterDeps, {
      offset: 2,
      filter: [{ dimension: 'status', value: 'pending' }],
    });
    expect(page?.entities?.map((child) => child.properties.rel)).toEqual(['comment:c3']);
    expect(page?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=comments&offset=2&filter.status=pending' },
      { rel: ['prev'], href: '/api/entity?rel=comments&offset=0&filter.status=pending' },
    ]);
  });

  it('过滤零命中 → 诚实空页(有过滤链时 prev 缺省于首页)', () => {
    const entity = project(seedSnapshot, 'comments', filterDeps, {
      offset: 0,
      filter: [{ dimension: 'status', value: 'rejected' }],
    });
    expect(entity?.entities).toEqual([]);
    expect(entity?.properties).toMatchObject({ count: 0, offset: 0 });
  });

  it('字段维度过滤(category=essay)机械作用于实例字段值', () => {
    const entity = project(
      seedSnapshot,
      'articles',
      { ...deps, flows: flowRegistry(postFlowWithFilters) },
      {
        offset: 0,
        filter: [{ dimension: 'category', value: 'essay' }],
      },
    );
    expect(entity?.entities?.map((child) => child.properties.rel)).toEqual([
      'post:post-getting-started',
    ]);
  });

  it('声明过滤维度的集合在投影中携带声明(presentation.filters;人机同门发现)', () => {
    const entity = project(seedSnapshot, 'comments', filterDeps);
    expect(entity?.properties.presentation).toEqual({
      filters: [
        {
          field: 'status',
          title: '状态',
          values: [
            { value: 'pending', title: '待处理' },
            { value: 'approved', title: '已通过' },
            { value: 'rejected', title: '已驳回' },
          ],
        },
      ],
    });
  });

  it('无声明集合的投影零新键(articles 不携带 presentation;诚实缺省)', () => {
    const entity = project(seedSnapshot, 'articles', filterDeps);
    expect(entity?.properties).toEqual({ rel: 'articles', count: 2 });
  });

  it('悬空成员(快照集合引用不存在实例)不匹配任何过滤,零发明', () => {
    const dangling: EngineSnapshot = {
      ...seedSnapshot,
      collections: { comments: [...seedSnapshot.collections.comments!, 'comment:ghost'] },
    };
    const entity = project(dangling, 'comments', filterDeps, {
      offset: 0,
      filter: [{ dimension: 'status', value: 'pending' }],
    });
    expect(entity?.entities?.map((child) => child.properties.rel)).toEqual([
      'comment:c1',
      'comment:c2',
      'comment:c3',
    ]);
  });
});
