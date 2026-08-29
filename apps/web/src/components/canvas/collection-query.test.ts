import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canvasCollectionQueryHref,
  canonicalReadQueryOf,
  collectionQueryFromContractHref,
  collectionQueryFromSearchParams,
  collectionQueryString,
  collectionQueryNavigation,
} from './collection-query';

// 集合读面查询的画布侧机械(T38 FR5):画布 URL 与合同读面参数同形
// (offset + filter.<dimension>),focus 导航携参、scope/thread 保留;
// 过滤/翻页是读面导航,零 exec、零页码推算、零页尺寸常量。

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
