import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceTree } from '@ui4a/engine';

import {
  INITIAL_COLLECTION_READ_QUERY,
  canvasCollectionQueryHref,
  canonicalReadQueryOf,
  collectionQueryFromContractHref,
  collectionQueryFromSearchParams,
  collectionQueryNavigation,
  collectionQueryString,
  collectionReadQueryResolver,
  collectionRepeatSubjects,
  pageableCollectionRelsOf,
} from './collection-query';

// 集合读面查询的画布侧机械(T38 FR5):画布 URL 与合同读面参数同形
// (offset + filter.<dimension>),focus 导航携参、scope/thread 保留;
// 过滤/翻页是读面导航,零 exec、零页码推算、零页尺寸常量。
// Phase C:集合区域初始读游标 offset=0 也声明驱动(repeat 来源 ∧ sitemap
// collection 面),URL 读面参数只作用于注视集合且优先。

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectionQueryFromSearchParams(URL 机械提取)', () => {
  it('offset + filter.* 同形合同读面参数(保请求序);无读面参数 → undefined', () => {
    const params = new URLSearchParams('offset=20&filter.status=pending&scope=publishing');
    expect(collectionQueryFromSearchParams(params)).toEqual({
      offset: '20',
      filter: [{ dimension: 'status', value: 'pending' }],
    });
    expect(
      collectionQueryFromSearchParams(new URLSearchParams('scope=publishing')),
    ).toBeUndefined();
    expect(collectionQueryFromSearchParams(new URLSearchParams())).toBeUndefined();
  });
});

describe('canonicalReadQueryOf(画布 URL → 规范读面查询串)', () => {
  it('offset + filter.* 规范化(offset 在前、维度字典序);无读面参数 → undefined', () => {
    expect(
      canonicalReadQueryOf(new URLSearchParams('offset=20&filter.status=pending&scope=publishing')),
    ).toBe('offset=20&filter.status=pending');
    expect(
      canonicalReadQueryOf(
        new URLSearchParams('focus=articles&filter.kind=q&filter.status=pending&scope=publishing'),
      ),
    ).toBe('filter.kind=q&filter.status=pending');
    // 非读面参数(处境/回执声明)不进读面查询串。
    expect(canonicalReadQueryOf(new URLSearchParams('focus=articles&scope=publishing'))).toBe(
      undefined,
    );
    expect(canonicalReadQueryOf(new URLSearchParams())).toBeUndefined();
  });
});

describe('collectionQueryString(规范查询串)', () => {
  it('offset 在前、过滤维度按字典序稳定排序(缓存键用途)', () => {
    expect(
      collectionQueryString({
        offset: '20',
        filter: [
          { dimension: 'kind', value: 'a' },
          { dimension: 'status', value: 'pending' },
        ],
      }),
    ).toBe('offset=20&filter.kind=a&filter.status=pending');
    expect(collectionQueryString({ filter: [] })).toBe('');
  });
});

describe('collectionQueryFromContractHref(合同 href 解析)', () => {
  it('self/页链接携带的 rel 与当前读面状态可机械还原(人机同门)', () => {
    expect(
      collectionQueryFromContractHref('/api/entity?rel=comments&offset=20&filter.status=pending'),
    ).toEqual({
      rel: 'comments',
      query: { offset: '20', filter: [{ dimension: 'status', value: 'pending' }] },
    });
    expect(collectionQueryFromContractHref('/api/entity?rel=articles&offset=0')).toEqual({
      rel: 'articles',
      query: { offset: '0', filter: [] },
    });
    expect(collectionQueryFromContractHref('/api/exec')).toBeUndefined();
  });
});

describe('canvasCollectionQueryHref(读面导航目标)', () => {
  it('focus 落到目标集合并携参;scope/thread 保留,上一视图机械声明不携带', () => {
    expect(
      canvasCollectionQueryHref(
        '/canvas?focus=workspace%3Aapp%3Acommunity&scope=community&concern=presentation%3Ainbox',
        {
          rel: 'comments',
          offset: '20',
          filter: [{ dimension: 'status', value: 'pending' }],
        },
      ),
    ).toBe(
      `/canvas?focus=${encodeURIComponent('comments')}&offset=20&filter.status=pending&scope=community`,
    );
  });

  it('清除语义:offset null + 空过滤 → URL 只剩 focus 与处境声明(全量,零残留)', () => {
    expect(
      canvasCollectionQueryHref('/canvas?focus=comments&offset=20&filter.status=pending', {
        rel: 'comments',
        offset: null,
        filter: [],
      }),
    ).toBe(`/canvas?focus=${encodeURIComponent('comments')}`);
    expect(
      canvasCollectionQueryHref('/canvas?scope=community&thread=t1&focus=comments', {
        rel: 'comments',
        filter: [{ dimension: 'status', value: 'approved' }],
      }),
    ).toBe(
      `/canvas?focus=${encodeURIComponent('comments')}&filter.status=approved&scope=community&thread=t1`,
    );
  });
});

describe('collectionQueryNavigation(可注入导航面)', () => {
  it('缺省经 window.location.assign;window 缺席时诚实不动', () => {
    const assign = vi.fn();
    const original = collectionQueryNavigation.assign;
    collectionQueryNavigation.assign = assign;
    try {
      collectionQueryNavigation.assign('/canvas?focus=comments');
      expect(assign).toHaveBeenCalledWith('/canvas?focus=comments');
    } finally {
      collectionQueryNavigation.assign = original;
    }
  });
});

function repeatSurface(subject: string): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'slot',
      id: 'relation',
      role: 'relation',
      name: 'relation',
      dependencies: [],
      provenance: [],
      child: {
        kind: 'repeat',
        id: 'repeat-0',
        role: 'relation',
        source: { kind: 'entities', subject },
        dependencies: [],
        provenance: [],
        item: {
          kind: 'word',
          id: 'member',
          role: 'identity',
          word: 'member-card',
          bindings: { label: { kind: 'item', path: 'properties.identity' } },
          dependencies: [],
          provenance: [],
        },
      },
    },
  };
}

describe('collectionRepeatSubjects(计划面的 collection 形态区域,声明数据)', () => {
  it('repeat 的 entities 来源 subject 入集;纯词节点树不入', () => {
    const surface = repeatSurface('articles');
    expect([...collectionRepeatSubjects(surface)]).toEqual(['articles']);
    const wordOnly: SurfaceTree = {
      schemaVersion: 1,
      root: {
        kind: 'word',
        id: 'w',
        role: 'identity',
        word: 'prose',
        bindings: {
          value: { kind: 'property', subject: 'articles', path: 'properties.title' },
        },
        dependencies: [],
        provenance: [],
      },
    };
    expect(collectionRepeatSubjects(wordOnly).size).toBe(0);
  });
});

describe('pageableCollectionRelsOf(sitemap collection 面 = 合同可分页集合)', () => {
  it('collection:true 的 rel 入集;缺标记/非法 rel/非数组诚实跳过', () => {
    expect(
      pageableCollectionRelsOf([
        { rel: 'articles', title: '文章', collection: true },
        { rel: 'flow:article-drafting', title: '向导' },
        { rel: 'inbox', title: '在等我', collection: false },
        { collection: true },
        { rel: '', collection: true },
        'junk',
      ]),
    ).toEqual(new Set(['articles']));
    expect(pageableCollectionRelsOf(undefined)).toEqual(new Set());
  });
});

describe('collectionReadQueryResolver(集合区域初始读游标,声明驱动零特判)', () => {
  const surfaces = [{ rel: 'articles', collection: true }];

  it('集合形态区域(repeat 来源)∧ 声明可分页 → 初始读 offset=0(服务端定页大小)', () => {
    const readQueryOf = collectionReadQueryResolver({
      surface: repeatSurface('articles'),
      sitemapSurfaces: surfaces,
    });
    expect(readQueryOf('articles')).toBe(INITIAL_COLLECTION_READ_QUERY);
    expect(INITIAL_COLLECTION_READ_QUERY).toBe('offset=0');
  });

  it('非成员集合的平台视图(repeat 但 sitemap 未声明 collection)→ 零参数(我的事不破)', () => {
    const readQueryOf = collectionReadQueryResolver({
      surface: repeatSurface('inbox'),
      sitemapSurfaces: surfaces,
    });
    expect(readQueryOf('inbox')).toBeUndefined();
  });

  it('实体形态区域(flow 向导,非 repeat)→ 零参数(shape:entity 不受影响)', () => {
    const readQueryOf = collectionReadQueryResolver({
      surface: repeatSurface('articles'),
      sitemapSurfaces: surfaces,
    });
    expect(readQueryOf('flow:article-drafting')).toBeUndefined();
  });

  it('URL 读面参数只作用于注视集合且优先(分享/回放以 URL 为准)', () => {
    const twoRegions: SurfaceTree = {
      schemaVersion: 1,
      root: {
        kind: 'layout',
        id: 'root',
        role: 'relation',
        layout: 'stack',
        dependencies: [],
        provenance: [],
        children: [repeatSurface('articles').root, repeatSurface('comments').root],
      },
    };
    const readQueryOf = collectionReadQueryResolver({
      focus: 'articles',
      surface: twoRegions,
      sitemapSurfaces: [
        { rel: 'articles', collection: true },
        { rel: 'comments', collection: true },
      ],
      urlQuery: 'offset=20&filter.status=pending',
    });
    expect(readQueryOf('articles')).toBe('offset=20&filter.status=pending');
    // 非注视集合区域仍走初始游标。
    expect(readQueryOf('comments')).toBe(INITIAL_COLLECTION_READ_QUERY);
  });

  it('无计划面(generic 兜底)→ 只按 sitemap 声明判定初始游标', () => {
    const readQueryOf = collectionReadQueryResolver({
      sitemapSurfaces: surfaces,
    });
    expect(readQueryOf('articles')).toBe(INITIAL_COLLECTION_READ_QUERY);
    expect(readQueryOf('inbox')).toBeUndefined();
  });
});
