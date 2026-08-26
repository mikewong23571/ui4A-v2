'use client';
/**
 * 页面级实体缓存的 React 承载(T12 Phase B Task 2 / spec 架构决定 3)。
 *
 * 承载选型(读现有页面结构后):
 * - React context provider 挂进每个消费页面:同页面多 surface 经 context
 *   共享同一 PageEntityCache;跨页面不共享——provider 随页面卸载销毁,
 *   且本 renderer 页内导航全走 <a href> 整页加载(仅聊天面板一处 <Link>),
 *   缓存生命周期恒 ≤ 一次页面加载;
 * - 模块级单例会随 client-side 导航跨页存活(违「跨页面不共享」),页面组件
 *   内 useRef 私有方案供给不了同页多 surface(Task 3 画布),故选 context
 *   (分叉版 Next 官方形态:client component provider,见
 *   docs/01-app/01-getting-started/05-server-and-client-components.md);
 * - version 一致性戳:每 provider 实例惰性取一次 /.well-known/ui4a.json
 *   (FR4 既有端点,零新增),version = sitemap 内容 hash;取数失败读取如实
 *   拒绝,但不焊死(下次读取重试,瞬时 503 可自愈);
 * - 真实所属 collection:exec 成功的实体投影 links 携带 ['collection'] 回链
 *   (引擎成员反查),优先于 rel 前缀推导——Task 1 的已知边界在接线点闭环;
 *   无回链(集合自身/确认/委托实体)回退前缀推导,整面 reload 兜底不变。
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { collectionBacklinkOf, PageEntityCache, type EntityFetcher } from '@/render/entity-cache';

import { redirectToLoginOnAuthError } from './auth-redirect';
import { fetchEntity, withPolicyScope } from './exec-client';

/** 业务 sitemap version 取数(FR4 端点;一致性戳不可得时响亮失败,不静默跳过)。 */
async function fetchSitemapVersion(scope?: string): Promise<string> {
  const endpoint = withPolicyScope('/.well-known/ui4a.json', scope);
  const response = await fetch(endpoint);
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as unknown;
    // 认证类 401 统一跳转登录(T22 验证修复)。
    redirectToLoginOnAuthError(response.status, body);
    throw new Error(`GET ${endpoint} → HTTP ${response.status}`);
  }
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== 'string' || body.version === '') {
    throw new Error('sitemap 响应缺 version 字段(一致性戳不可得,不静默跳过)');
  }
  return body.version;
}

/**
 * 页面级缓存门面:对消费方隐藏 version 一致性戳的取数与失效口径。
 * 实例由 provider 创建并随其销毁;handle 本身无 React 生命周期依赖。
 */
export interface EntityCacheHandle {
  /** 读实体:同 version 下命中缓存零 fetch;miss 经 /api/entity 填充。 */
  get(rel: string): Promise<SirenEntity | null>;
  /**
   * exec 成功后精确失效:当前 rel + 所属 collection(entity 的 collection
   * 回链优先,无前缀推导兜底);其他 rel 不动。
   */
  invalidateAfterExec(rel: string, entity?: SirenEntity): void;
  /** 单 rel 失效(别名页:页面入口 rel ≠ exec 实例 rel 时同步失效页面 rel)。 */
  invalidate(rel: string): void;
  /** 外部执行者改写范围未知时，清空当前页面实体缓存。 */
  invalidateAll(): void;
}

function createHandle(fetcher: EntityFetcher, versionFetcher: () => Promise<string>) {
  const cache = new PageEntityCache(fetcher);
  let versionPromise: Promise<string> | undefined;
  const version = (): Promise<string> => {
    // 惰性一次取数;失败清槽重试(瞬时故障不焊死本页会话)。
    versionPromise ??= versionFetcher().catch((error: unknown) => {
      versionPromise = undefined;
      throw error;
    });
    return versionPromise;
  };
  const handle: EntityCacheHandle = {
    get: (rel) => version().then((stamp) => cache.get(rel, stamp)),
    invalidateAfterExec: (rel, entity) => {
      const backlink = entity !== undefined ? collectionBacklinkOf(entity) : undefined;
      cache.invalidateAfterExec(rel, backlink !== undefined ? { collection: backlink } : undefined);
    },
    invalidate: (rel) => cache.invalidate(rel),
    invalidateAll: () => cache.invalidateAll(),
  };
  return handle;
}

const EntityCacheContext = createContext<EntityCacheHandle | null>(null);

export interface EntityCacheProviderProps {
  children: ReactNode;
  /** Optional policy scope carried by cross-plane Definition/Run navigation. */
  scope?: string;
  /** 实体取数(缺省 /api/entity;测试注入计数 fetcher)。挂载后固定。 */
  fetcher?: EntityFetcher;
  /** version 取数(缺省 /.well-known/ui4a.json;测试注入)。挂载后固定。 */
  versionFetcher?: () => Promise<string>;
}

export function EntityCacheProvider({
  children,
  scope,
  fetcher,
  versionFetcher,
}: EntityCacheProviderProps) {
  // 句柄与 provider 同生同灭(useState 惰性初始化 = 每挂载恰一次)。
  const [handle] = useState(() =>
    createHandle(
      fetcher ?? ((rel) => fetchEntity(rel, undefined, scope)),
      versionFetcher ?? (() => fetchSitemapVersion(scope)),
    ),
  );
  return <EntityCacheContext.Provider value={handle}>{children}</EntityCacheContext.Provider>;
}

/** 消费页面级实体缓存;provider 外使用响亮抛错(接线遗漏不静默)。 */
export function useEntityCache(): EntityCacheHandle {
  const handle = useContext(EntityCacheContext);
  if (handle === null) {
    throw new Error('useEntityCache 必须在 EntityCacheProvider 内使用(页面未挂缓存承载)');
  }
  return handle;
}
