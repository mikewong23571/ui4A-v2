'use client';
/**
 * 实体页主体(T2 Phase F):给定 rel 的取数 + 状态机 + EntityView 渲染。
 *
 * 与 app/entity/page.tsx 拆分的理由:页面壳只做 use(searchParams) 解包
 * (Next 16 客户端页的官方形态,由 e2e 走查覆盖);状态机本体在此,组件级可测。
 * - 加载:经页面级实体缓存(T12 Phase B:EntityCacheProvider,rel + sitemap
 *   version 一致性戳);404 → missing;异常 → error;成功 → EntityView;
 * - 刷新:动作 exec 成功后先精确失效(当前 rel + 真实所属 collection,
 *   实体回链优先)再 tick 重拉(重拉期间保留旧投影——事件溯源口径:
 *   投影总能由日志重算,短暂展示旧态无害且避免闪屏);tick 重拉即
 *   整面 reload 兜底路径,保留不变。
 */
import type { SirenEntity } from '@ui4a/engine';
import { useEffect, useState } from 'react';

import { useEntityCache } from './entity-cache-provider';
import { EntityView } from './entity-view';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export function EntityPageBody({ rel, scope }: { rel: string; scope?: string }) {
  const cache = useEntityCache();
  const [tick, setTick] = useState(0);
  const [entity, setEntity] = useState<SirenEntity | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await cache.get(rel);
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
  }, [cache, rel, tick]);

  if (rel === '') {
    return (
      <div>
        <nav className="mb-2 text-sm">
          <a href="/" data-nav="home" className="text-primary hover:underline">
            ← 首页
          </a>
        </nav>
        <p className="text-sm text-muted-foreground">
          缺少 rel 参数。用法:/entity?rel=post:post-welcome。
        </p>
      </div>
    );
  }

  if (state === 'error' || state === 'missing') {
    return (
      <div>
        <nav className="mb-2 text-sm">
          <a href="/" data-nav="home" className="text-primary hover:underline">
            ← 首页
          </a>
        </nav>
        {state === 'missing' ? (
          <p className="text-sm text-muted-foreground">实体 “{rel}” 不存在(404)。</p>
        ) : (
          <p className="text-sm text-muted-foreground">读取实体 “{rel}” 失败(服务不可用)。</p>
        )}
      </div>
    );
  }

  if (state === 'loading' || entity === null) {
    return (
      <div>
        <p className="text-sm text-zinc-500">加载中…</p>
      </div>
    );
  }

  return (
    <EntityView
      rel={rel}
      scope={scope}
      entity={entity}
      onChanged={(execRel) => {
        // exec 成功 → 精确失效(当前 rel + 真实所属 collection,回链优先);
        // tick 重拉 = 整面 reload 兜底(spec 架构决定 3)。
        cache.invalidateAfterExec(execRel, entity);
        // 别名页(flow:<name> 入口 → 实例 <flow>:main):exec 直投实例 rel
        // (entity-view:直投不绕别名),页面 rel 的缓存条目须一并失效,
        // 否则 tick 重拉命中旧投影(B1 向导停步回归)。
        if (execRel !== rel) cache.invalidate(rel);
        setTick((n) => n + 1);
      }}
    />
  );
}
