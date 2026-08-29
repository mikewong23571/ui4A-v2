/**
 * 集合读面查询的画布侧机械(T38 FR5;纯函数 + 可注入导航面):
 *
 * - 画布 URL query 与合同读面参数同形(`offset` + `filter.<dimension>`);
 *   过滤/翻页导航 = focus 落到目标集合并携带声明参数(与 /api/entity 请求
 *   同一参数语义,人机同门),scope/thread 处境声明保留;
 * - 过滤/翻页是读面导航机械,永不 exec、零业务事件;零页码推算、零页尺寸
 *   常量——参数只来自合同声明的链接 href 或用户控件选择;
 * - 集合区域初始读游标(Phase C):collection 形态区域(计划面 repeat 来源)
 *   且合同声明可分页(sitemap collection 面)的初始读携带 offset=0,页大小
 *   由服务端投影决定;URL 读面参数只作用于注视集合且优先(分享/回放);
 * - 导航面可注入(auth-redirect 先例:jsdom 不可重定义 location)。
 */
import type { SurfaceNode, SurfaceTree } from '@ui4a/engine';

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

/**
 * 宿主合并式读面导航目标(Phase C 修复 2):保留当前画布 URL 的 subject 与
 * 处境声明(focus/scope/thread/…),只以声明的读面状态替换旧读面参数——
 * offset + filter.*(offset 为 null/'' → 清除,读回首页起点)。组合面语境
 * 就地翻页/过滤,不再 focus 落点替换单主体面;零发明:参数只来自合同声明
 * 链接 href 与用户控件选择。
 */
export function mergeCollectionReadQueryHref(
  currentHref: string,
  read: { offset?: string | null; filter?: ReadonlyArray<CollectionFilterPair> },
): string {
  const url = new URL(currentHref, 'http://ui4a.local');
  const params = new URLSearchParams(url.searchParams);
  for (const key of [...params.keys()]) {
    if (key === 'offset' || key.startsWith('filter.')) params.delete(key);
  }
  if (read.offset !== undefined && read.offset !== null && read.offset !== '') {
    params.set('offset', read.offset);
  }
  for (const pair of read.filter ?? []) {
    params.set(`filter.${pair.dimension}`, pair.value);
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

/**
 * 集合区域初始读游标:第一页起点。页大小住服务端投影(渲染器零页尺寸常量、
 * 零页码推算);后续翻页严格跟随合同声明的 next/prev 链接 href 参数。
 */
export const INITIAL_COLLECTION_READ_QUERY = 'offset=0';

/**
 * 计划面里的 collection 形态区域:repeat 节点的 entities 来源 subject
 * (组合区域 shape 声明经规划落面的声明数据,零 rel 特判)。
 */
export function collectionRepeatSubjects(surface: SurfaceTree): ReadonlySet<string> {
  const subjects = new Set<string>();
  const visit = (node: SurfaceNode): void => {
    if (node.kind === 'repeat') {
      if (node.source.kind === 'entities') subjects.add(node.source.subject);
      visit(node.item);
      return;
    }
    if (node.kind === 'layout') node.children.forEach(visit);
    else if (node.kind === 'slot') visit(node.child);
  };
  visit(surface.root);
  return subjects;
}

/**
 * 合同可分页的集合 rel: sitemap surfaces 里声明 collection 的面(append
 * 效应推导的成员集合;inbox/threads 等平台视图不在其列,读面参数会被合同
 * 结构化拒绝)。非法条目诚实跳过,不造事实。
 */
export function pageableCollectionRelsOf(surfaces: unknown): ReadonlySet<string> {
  const rels = new Set<string>();
  if (!Array.isArray(surfaces)) return rels;
  for (const surface of surfaces) {
    if (typeof surface !== 'object' || surface === null) continue;
    const candidate = surface as { rel?: unknown; collection?: unknown };
    if (
      candidate.collection === true &&
      typeof candidate.rel === 'string' &&
      candidate.rel !== ''
    ) {
      rels.add(candidate.rel);
    }
  }
  return rels;
}

/** 集合区域读面参数解析器的声明输入(全部声明数据,零 rel 特判)。 */
export interface CollectionReadQueryInput {
  /** 注视 rel:URL 读面参数只作用于注视集合(分享/回放)。缺省 = 无注视语境。 */
  focus?: string;
  /** 计划面:在场时以 repeat 来源判定 collection 形态;缺省只看 sitemap 声明。 */
  surface?: SurfaceTree;
  /** sitemap surfaces 原始数据(声明 collection 的面 = 可分页成员集合)。 */
  sitemapSurfaces?: unknown;
  /** URL 读面参数规范串(优先于初始游标)。 */
  urlQuery?: string;
  /**
   * 组合面语境旗标(Phase C):URL 读面参数作用于全部可分页 repeat 集合
   * 区域(就地翻页/过滤;当前每应用至多一个产物集合,无目标歧义)。缺省
   * 关闭——单 focus 分支维持「URL 只作用于注视集合」既有语义。
   */
  applyUrlToPageable?: boolean;
}

/**
 * 集合区域读面参数解析(T38 Phase C 缺陷 1 修法,声明驱动):
 * - URL 声明读面参数且 rel = 注视 → URL 为准(分享/回放;非法参数由合同
 *   结构化拒绝,零静默修正);
 * - 其余集合形态区域(repeat 来源)∧ 声明可分页(sitemap collection 面)
 *   → 初始读 offset=0(服务端决定页大小);
 * - 实体形态区域与平台视图 → 零参数(sidecar/多根/规格路径维持既有键设计)。
 */
export function collectionReadQueryResolver(
  input: CollectionReadQueryInput,
): (rel: string) => string | undefined {
  const repeatSubjects =
    input.surface === undefined ? undefined : collectionRepeatSubjects(input.surface);
  const pageableRels = pageableCollectionRelsOf(input.sitemapSurfaces);
  const urlQuery = input.urlQuery === '' ? undefined : input.urlQuery;
  return (rel) => {
    if (input.focus !== undefined && rel === input.focus && urlQuery !== undefined) {
      return urlQuery;
    }
    if (!pageableRels.has(rel)) return undefined;
    if (repeatSubjects !== undefined && !repeatSubjects.has(rel)) return undefined;
    if (input.applyUrlToPageable === true && urlQuery !== undefined) return urlQuery;
    return INITIAL_COLLECTION_READ_QUERY;
  };
}
