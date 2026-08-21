/**
 * 页面级实体缓存(T12 Phase B Task 1 / spec 架构决定 3)。
 *
 * 现状的每次渲染临时构建(page.tsx 现取现填)提升为页面级缓存:
 *
 * - 按 rel 索引实体,携带 sitemap version 一致性戳(版本号即缓存键);
 * - version 变 → 全量失效(定义/拓扑变了,投影口径可能变);
 * - exec 成功 → invalidateAfterExec(rel) 精确失效:当前 rel + 其所属
 *   collection rel(宁可多失效不可脏读,I2);
 * - 读 miss 经既有 /api/entity 取数路径填充(复用 exec-client.fetchEntity,
 *   不新辟通道);404(null)不缓存——实体可能随后被创建,否定结果缓存会脏读;
 * - 整面 reload 兜底路径不受影响(本模块不阻止 reload)。
 *
 * 所属 collection 推导口径(读 deref.ts / page.tsx / fixtures 现有 rel 形态):
 * 实体 rel 形如 `<collection>:<name>`(post:post-welcome / comment:c1 /
 * meta/flow:article-drafting)→ 首个 ":" 前缀即所属集合 rel;rel 不含 ":"
 * (articles / comments / inbox / delegations)→ 集合自身,失效即自身。
 * 已知边界:种子数据里成员 rel 前缀是实体型前缀而集合名未必相同
 * (post:* 隶属集合 articles),前缀推导出的集合候选不在缓存时失效是
 * no-op(安全方向:不脏读);version 全量失效与整面 reload 兜底不变。
 */
import type { SirenEntity } from '@ui4a/engine';

import { fetchEntity } from '@/components/exec-client';

import type { EntityCache } from './deref';

/** 取数函数口径:与 exec-client.fetchEntity 同形(/api/entity;404 → null)。 */
export type EntityFetcher = (rel: string) => Promise<SirenEntity | null>;

/** 所属 collection rel:`<collection>:<name>` → `<collection>`;无 ":" → 自身。 */
export function collectionRelOf(rel: string): string {
  const colon = rel.indexOf(':');
  return colon === -1 ? rel : rel.slice(0, colon);
}

/**
 * 页面级实体缓存(渲染器私有,agent 不发 updateDataModel;生命周期 =
 * 页面,跨页面共享/离线缓存不在本模块范围)。
 */
export class PageEntityCache {
  private entities: EntityCache = new Map();
  private inflight = new Map<string, Promise<SirenEntity | null>>();
  private version: string | undefined;
  private readonly fetcher: EntityFetcher;

  constructor(fetcher: EntityFetcher = fetchEntity) {
    this.fetcher = fetcher;
  }

  /**
   * 读实体:同 version 下命中缓存零 fetch;miss 经 /api/entity 拉取填充;
   * version 变 → 先全量失效再走 miss 路径。
   */
  async get(rel: string, version: string): Promise<SirenEntity | null> {
    if (this.version !== version) {
      this.entities.clear();
      this.inflight.clear();
      this.version = version;
    }
    const cached = this.entities.get(rel);
    if (cached !== undefined) return cached;

    // inflight 去重:同 rel 并发读只发一次取数(换 concern/换词条的并发渲染)。
    const pending = this.inflight.get(rel);
    if (pending !== undefined) return pending;

    const requestedVersion = version;
    const request = this.fetcher(rel)
      .then((fetched) => {
        // 版本在飞行中变了 → 该响应出自旧投影口径,落缓存即脏读(I2),丢弃。
        if (fetched !== null && this.version === requestedVersion) {
          this.entities.set(rel, fetched);
        }
        return fetched;
      })
      .finally(() => {
        if (this.inflight.get(rel) === request) this.inflight.delete(rel);
      });
    this.inflight.set(rel, request);
    return request;
  }

  /** exec 成功后精确失效:当前 rel + 所属 collection rel;其他 rel 不动。 */
  invalidateAfterExec(rel: string): void {
    this.entities.delete(rel);
    this.inflight.delete(rel);
    const collection = collectionRelOf(rel);
    if (collection !== rel) {
      this.entities.delete(collection);
      this.inflight.delete(collection);
    }
  }

  /** deref 消费的缓存视图(rel → 实体;消费侧只读,写入只能经 get 填充)。 */
  snapshot(): EntityCache {
    return this.entities;
  }
}
