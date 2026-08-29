/**
 * 集合读面查询的画布侧机械(T38 FR5;纯函数 + 可注入导航面):
 *
 * - 画布 URL query 与合同读面参数同形(`offset` + `filter.<dimension>`);
 *   过滤/翻页导航 = focus 落到目标集合并携带声明参数(与 /api/entity 请求
 *   同一参数语义,人机同门),scope/thread 处境声明保留;
 * - 过滤/翻页是读面导航机械,永不 exec、零业务事件;零页码推算、零页尺寸
 *   常量——参数只来自合同声明的链接 href 或用户控件选择;
 * - 导航面可注入(auth-redirect 先例:jsdom 不可重定义 location)。
 */

/** 过滤请求对(维度 + 值;与合同读面参数同形)。 */
export interface CollectionFilterPair {
  dimension: string;
  value: string;
}

/** 集合读面查询状态(URL/合同 href 两态共用)。 */
export interface CollectionQueryState {
  offset?: string;
  filter: CollectionFilterPair[];
}

/**
 * URL 查询串的读面参数机械提取:offset 单值 + filter.<dimension>=<value>
 * 请求对(保请求序)。无读面参数 → undefined(全量,零机制介入)。
 */
export function collectionQueryFromSearchParams(
  params: URLSearchParams,
): CollectionQueryState | undefined {
  const offset = params.get('offset') ?? undefined;
  const filter: CollectionFilterPair[] = [];
  for (const [key, value] of params) {
    if (key.startsWith('filter.')) filter.push({ dimension: key.slice('filter.'.length), value });
  }
  if (offset === undefined && filter.length === 0) return undefined;
  return { offset, filter };
}

/** 规范查询串:offset 在前,过滤维度按字典序稳定排序(缓存键/探针断言用)。 */
export function collectionQueryString(query: CollectionQueryState): string {
  const params = new URLSearchParams();
  if (query.offset !== undefined) params.set('offset', query.offset);
  for (const pair of [...query.filter].sort((left, right) =>
    left.dimension.localeCompare(right.dimension),
  )) {
    params.set(`filter.${pair.dimension}`, pair.value);
  }
  return params.toString();
}

/**
 * 画布 URL 的规范读面查询串(T38 FR5):无读面参数 → undefined(全量,零机制
 * 介入);有则输出稳定序的 `offset=…&filter.…`(缓存键与 /api/entity 请求共用,
 * 同一 URL 状态永远映射同一合同读)。
 */
export function canonicalReadQueryOf(params: URLSearchParams): string | undefined {
  const query = collectionQueryFromSearchParams(params);
  if (query === undefined) return undefined;
  const canonical = collectionQueryString(query);
  return canonical === '' ? undefined : canonical;
}

/** 合同 href(/api/entity?rel=…&offset=…&filter.…)解析;无 rel 可提 → undefined。 */
export function collectionQueryFromContractHref(
  href: string,
): { rel: string; query: CollectionQueryState } | undefined {
  const query = href.split('?')[1] ?? '';
  const match = /(?:^|&)rel=([^&]*)/.exec(query);
  if (match === null) return undefined;
  const rel = decodeURIComponent(match[1]!.replace(/\+/g, ' '));
  return {
    rel,
    query: collectionQueryFromSearchParams(new URLSearchParams(query)) ?? { filter: [] },
  };
}

/**
 * 集合查询导航目标:focus 落到目标集合 + 声明读面参数;scope/thread 处境
 * 声明从当前 URL 保留(D51 授权与注意力的导航偏好),其余参数(concern/
 * sidecar/refresh 等上一视图的机械声明)不携带。offset 为 null/'' 表示清除。
 */
export function canvasCollectionQueryHref(
  currentHref: string,
  target: { rel: string; offset?: string | null; filter?: ReadonlyArray<CollectionFilterPair> },
): string {
  const url = new URL(currentHref, 'http://ui4a.local');
  const params = new URLSearchParams();
  params.set('focus', target.rel);
  if (target.offset !== undefined && target.offset !== null && target.offset !== '') {
    params.set('offset', target.offset);
  }
  for (const pair of target.filter ?? []) {
    params.set(`filter.${pair.dimension}`, pair.value);
  }
  for (const key of ['scope', 'thread'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') params.set(key, value);
  }
  const search = params.toString();
  return `${url.pathname}${search === '' ? '' : `?${search}`}`;
}

/** 可注入导航面(缺省 window.location.assign;window 缺席时诚实不动)。 */
export const collectionQueryNavigation = {
  assign(href: string): void {
    const candidate = (globalThis as { window?: unknown }).window;
    if (typeof candidate !== 'object' || candidate === null) return;
    const location = (candidate as { location?: unknown }).location;
    if (typeof location !== 'object' || location === null) return;
    const assign = (location as { assign?: unknown }).assign;
    if (typeof assign !== 'function') return;
    (assign as (target: string) => void).call(location, href);
  },
};
