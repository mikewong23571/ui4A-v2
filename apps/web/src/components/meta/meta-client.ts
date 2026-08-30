'use client';
/**
 * BIOS(定义平面)的合同客户端(T4 Phase C):读 /_meta/api/entity、写 /_meta/api/exec。
 *
 * 与业务 renderer(exec-client)同一 HTTP 合同形态,仅三点不同:
 * - 端点在 /_meta 站点(canonical API;业务面 sitemap 不携带 _meta 入口,
 *   进入定义层必须显式意图——arch-brief §10 A.7 跨站规则);
 * - 身份 channel=bios(人类经 BIOS 面的显式操作;actor 恒 human——铁律 5
 *   "审批不委托":renderer 只能以人类身份提交,agent 侧 approve 在引擎层被拒);
 * - 渲染零 AI:本模块与使用它的 BIOS 组件不引入任何 AI/LLM 依赖(源级测试断言)。
 */
import type { SirenEntity } from '@ui4a/engine';
import { useEffect, useState } from 'react';

import type { ExecClientResult } from '../exec-client';
import type { MetaSitemapDocument } from './meta-surfaces';

interface ScopedInflight<T> {
  generation: number;
  promise: Promise<T>;
}

const sitemapInflight = new Map<string, ScopedInflight<MetaSitemapDocument>>();
const entityInflight = new Map<string, ScopedInflight<SirenEntity | null>>();
const entityCache = new Map<string, SirenEntity>();
const scopeGenerations = new Map<string, number>();
const MAX_ENTITY_CACHE_ENTRIES = 128;

function scopeKey(scope?: string): string {
  return scope ?? '';
}

function currentScopeGeneration(scope?: string): number {
  return scopeGenerations.get(scopeKey(scope)) ?? 0;
}

function scopedEndpoint(path: string, scope?: string): string {
  if (scope === undefined || scope.length === 0) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}scope=${encodeURIComponent(scope)}`;
}

/** Read the authorized Meta inventory and effective-scope provenance. */
export async function fetchMetaSitemap(scope?: string): Promise<MetaSitemapDocument> {
  const endpoint = scopedEndpoint('/_meta/.well-known/ui4a.json', scope);
  const generation = currentScopeGeneration(scope);
  const existing = sitemapInflight.get(endpoint);
  if (existing?.generation === generation) return existing.promise;
  const pending = (async () => {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`GET Meta sitemap → HTTP ${response.status}`);
    return (await response.json()) as MetaSitemapDocument;
  })();
  const inflight = { generation, promise: pending };
  sitemapInflight.set(endpoint, inflight);
  try {
    return await pending;
  } finally {
    if (sitemapInflight.get(endpoint) === inflight) sitemapInflight.delete(endpoint);
  }
}

/** 提交一个已声明的 meta 动作(POST /_meta/api/exec);空 params 不上送。 */
export async function execMetaAction(input: {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
  scope?: string;
}): Promise<ExecClientResult> {
  let response: Response;
  try {
    const current = await fetchMetaEntity(input.rel, input.scope, { fresh: true });
    const declared = current?.actions.find(
      (action) =>
        action.name === input.action &&
        action.href === '/_meta/api/exec' &&
        !action.name.includes('callback'),
    );
    if (declared === undefined) {
      return {
        ok: false,
        status: 409,
        layer: 'stale-action',
        reason: `动作 ${input.action} 已不存在或不是公开 Meta action，请刷新后重试。`,
      };
    }
    const params =
      input.params !== undefined && Object.keys(input.params).length > 0
        ? { params: input.params }
        : {};
    response = await fetch(scopedEndpoint('/_meta/api/exec', input.scope), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: input.rel, action: input.action, ...params }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      layer: 'network',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok && body.entity !== undefined) {
    invalidateMetaScope(input.scope);
    return { ok: true, entity: body.entity as SirenEntity };
  }
  return {
    ok: false,
    status: response.status,
    layer: typeof body.layer === 'string' ? body.layer : `http-${response.status}`,
    reason:
      typeof body.reason === 'string'
        ? body.reason
        : typeof body.error === 'string'
          ? body.error
          : '未知错误',
    ...(body.detail !== undefined ? { detail: body.detail } : {}),
  };
}

/** GET /_meta/api/entity?rel=…;404 → null(实体不存在),其余非 200 → 抛错。 */
export async function fetchMetaEntity(
  rel: string,
  scope?: string,
  options: { revision?: string; fresh?: boolean } = {},
): Promise<SirenEntity | null> {
  const endpoint = scopedEndpoint(`/_meta/api/entity?rel=${encodeURIComponent(rel)}`, scope);
  const generation = currentScopeGeneration(scope);
  const cacheKey =
    options.revision === undefined ? undefined : `${scope ?? ''}\0${options.revision}\0${rel}`;
  if (options.fresh !== true && cacheKey !== undefined) {
    const cached = entityCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }
  const existing = entityInflight.get(endpoint);
  if (options.fresh !== true && existing?.generation === generation) return existing.promise;
  const pending = (async () => {
    const response = await fetch(endpoint);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GET /_meta/api/entity?rel=${rel} → HTTP ${response.status}`);
    }
    const entity = (await response.json()) as SirenEntity;
    if (cacheKey !== undefined && currentScopeGeneration(scope) === generation) {
      entityCache.set(cacheKey, entity);
      if (entityCache.size > MAX_ENTITY_CACHE_ENTRIES) {
        const oldest = entityCache.keys().next().value as string | undefined;
        if (oldest !== undefined) entityCache.delete(oldest);
      }
    }
    return entity;
  })();
  const inflight = { generation, promise: pending };
  entityInflight.set(endpoint, inflight);
  try {
    return await pending;
  } finally {
    if (entityInflight.get(endpoint) === inflight) entityInflight.delete(endpoint);
  }
}

function invalidateMetaScope(scope?: string): void {
  const invalidatedScope = scopeKey(scope);
  scopeGenerations.set(invalidatedScope, currentScopeGeneration(scope) + 1);
  const prefix = `${invalidatedScope}\0`;
  for (const cacheKey of entityCache.keys()) {
    if (cacheKey.startsWith(prefix)) entityCache.delete(cacheKey);
  }
}

/**
 * meta 实体取数状态机(BIOS 页主体共用):加载 → ready/missing/error;
 * refresh 在动作 exec 成功后重拉(事件溯源口径:投影总能由日志重算)。
 */
export interface MetaEntityState {
  entity: SirenEntity | null;
  state: 'loading' | 'ready' | 'missing' | 'error';
  refresh: () => void;
}

export interface MetaSitemapState {
  sitemap: MetaSitemapDocument | null;
  state: 'loading' | 'ready' | 'error';
}

/** Scope-aware sitemap state for generic deep links and human titles. */
export function useMetaSitemap(scope?: string): MetaSitemapState {
  const [sitemap, setSitemap] = useState<MetaSitemapDocument | null>(null);
  const [state, setState] = useState<MetaSitemapState['state']>('loading');
  useEffect(() => {
    let cancelled = false;
    void fetchMetaSitemap(scope)
      .then((next) => {
        if (cancelled) return;
        setSitemap(next);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);
  return { sitemap, state };
}

export function useMetaEntity(rel: string, scope?: string, revision?: string): MetaEntityState {
  const [tick, setTick] = useState(0);
  const [entity, setEntity] = useState<SirenEntity | null>(null);
  const [state, setState] = useState<MetaEntityState['state']>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchMetaEntity(rel, scope, { revision, fresh: tick > 0 });
        if (cancelled) return;
        setEntity(next);
        setState(next === null ? 'missing' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [rel, revision, scope, tick]);

  return { entity, state, refresh: () => setTick((n) => n + 1) };
}
