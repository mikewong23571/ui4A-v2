import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';
import type { EngineSnapshot } from '@ui4a/shared';

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
 * T38 FR1 合同锚点:同 fixture 无参数集合投影 JSON 与升级前(引入分页机制前)
 * 逐字节一致——本字符串在改造前的 project 输出上捕获;分页/过滤机制只允许在
 * 查询参数在场时生效,无参数路径零形状漂移(CLI/外部 agent 的全量发现面承诺)。
 */
const ARTICLES_FULL_ANCHOR =
  '{"class":["collection","articles"],"properties":{"rel":"articles","count":2},"actions":[],"links":[{"rel":["self"],"href":"/api/entity?rel=articles"}],"guard-results":[],"entities":[{"class":["flow-instance","post-status"],"properties":{"rel":"post:post-welcome","flow":"post-status","node":"published","title":"已发布","identity":"Welcome to UI4A","status":"published","fields":{"title":"Welcome to UI4A","category":"tech"},"presentation":{"fields":[{"path":"properties.fields.title","title":"title","role":"identity"},{"path":"properties.fields.category","title":"category","role":"metadata"}]}},"actions":[{"name":"unpublish","title":"下线","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false}},{"name":"archive","title":"归档","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false},"requires-confirmation":"high"}],"links":[{"rel":["self"],"href":"/api/entity?rel=post:post-welcome"},{"rel":["collection"],"href":"/api/entity?rel=articles"}],"guard-results":[{"action":"unpublish","blocked":false,"guards":[]},{"action":"archive","blocked":false,"guards":[]}],"rel":["item"],"href":"/api/entity?rel=post:post-welcome"},{"class":["flow-instance","post-status"],"properties":{"rel":"post:post-getting-started","flow":"post-status","node":"published","title":"已发布","identity":"Getting Started","status":"published","fields":{"title":"Getting Started","category":"essay"},"presentation":{"fields":[{"path":"properties.fields.title","title":"title","role":"identity"},{"path":"properties.fields.category","title":"category","role":"metadata"}]}},"actions":[{"name":"unpublish","title":"下线","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false}},{"name":"archive","title":"归档","method":"POST","href":"/api/exec","fields":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false},"requires-confirmation":"high"}],"links":[{"rel":["self"],"href":"/api/entity?rel=post:post-getting-started"},{"rel":["collection"],"href":"/api/entity?rel=articles"}],"guard-results":[{"action":"unpublish","blocked":false,"guards":[]},{"action":"archive","blocked":false,"guards":[]}],"rel":["item"],"href":"/api/entity?rel=post:post-getting-started"}]}';

describe('parseCollectionQuery — 集合读面查询参数解析(T38 FR1)', () => {
  it('无参数(undefined/无 offset)→ none:全量路径,零分页机制生效', () => {
    expect(parseCollectionQuery(undefined)).toEqual({ kind: 'none' });
    expect(parseCollectionQuery({})).toEqual({ kind: 'none' });
  });

  it('合法 offset(含 0)→ query', () => {
    expect(parseCollectionQuery({ offset: '0' })).toEqual({ kind: 'query', query: { offset: 0 } });
    expect(parseCollectionQuery({ offset: '20' })).toEqual({
      kind: 'query',
      query: { offset: 20 },
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
  it('无参数全量:投影 JSON 与升级前逐字节一致(合同零窄化锚点)', () => {
    expect(JSON.stringify(project(seedSnapshot, 'articles', deps))).toBe(ARTICLES_FULL_ANCHOR);
  });

  it('offset 切片嵌入成员;properties 声明 count(本页)与 offset;prev/next 诚实缺链', () => {
    const entity = project(seedSnapshot, 'articles', deps, { offset: 1 });
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
    const entity = project(seedSnapshot, 'articles', deps, { offset: 0 });
    expect(entity?.properties).toEqual({ rel: 'articles', count: 2, offset: 0 });
    expect(entity?.links).toEqual([{ rel: ['self'], href: '/api/entity?rel=articles&offset=0' }]);
    expect(entity?.entities).toHaveLength(2);
  });

  it('多页集合:页大小 = 投影策略常量;next/prev 按声明序推进(零重叠零缺口)', () => {
    const snapshot = pagedSnapshot(COLLECTION_PAGE_SIZE * 2 + 5);
    const first = project(snapshot, 'articles', deps, { offset: 0 });
    expect(first?.entities).toHaveLength(COLLECTION_PAGE_SIZE);
    expect(first?.properties).toEqual({ rel: 'articles', count: COLLECTION_PAGE_SIZE, offset: 0 });
    expect(first?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['next'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE}` },
    ]);

    const middle = project(snapshot, 'articles', deps, { offset: COLLECTION_PAGE_SIZE });
    expect(middle?.entities).toHaveLength(COLLECTION_PAGE_SIZE);
    expect(middle?.links).toEqual([
      { rel: ['self'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE}` },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['next'], href: `/api/entity?rel=articles&offset=${COLLECTION_PAGE_SIZE * 2}` },
    ]);

    const last = project(snapshot, 'articles', deps, { offset: COLLECTION_PAGE_SIZE * 2 });
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
    const entity = project(snapshot, 'articles', deps, { offset: 100 });
    expect(entity?.entities).toEqual([]);
    expect(entity?.properties).toEqual({ rel: 'articles', count: 0, offset: 100 });
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=100' },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=80' },
    ]);
  });

  it('非成员对齐 offset(滑动窗口):next 起点 = offset + 本页长度,不跳行', () => {
    const snapshot = pagedSnapshot(COLLECTION_PAGE_SIZE + 7);
    const entity = project(snapshot, 'articles', deps, { offset: 4 });
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
      },
    );
    expect(entity?.links?.[0]?.href).toBe('http://localhost:3100/api/entity?rel=articles&offset=1');
  });

  it('投影是纯函数:查询切片不改输入快照', () => {
    const before = JSON.stringify(seedSnapshot);
    project(seedSnapshot, 'articles', deps, { offset: 1 });
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
