'use client';
/**
 * 实体页主体(T2 Phase F):给定 rel 的取数 + 状态机 + EntityView 渲染。
 *
 * 与 app/entity/page.tsx 拆分的理由:页面壳只做 use(searchParams) 解包
 * (Next 16 客户端页的官方形态,由 e2e 走查覆盖);状态机本体在此,组件级可测。
 * - 加载:fetch /api/entity;404 → missing;异常 → error;成功 → EntityView;
 * - 刷新:动作 exec 成功后 tick 重拉(重拉期间保留旧投影——事件溯源口径:
 *   投影总能由日志重算,短暂展示旧态无害且避免闪屏)。
 */
import type { SirenEntity } from '@ui4a/engine';
import { useEffect, useState } from 'react';

import { EntityView } from './entity-view';
import { fetchEntity } from './exec-client';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export function EntityPageBody({ rel }: { rel: string }) {
  const [tick, setTick] = useState(0);
  const [entity, setEntity] = useState<SirenEntity | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchEntity(rel);
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
  }, [rel, tick]);

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

  return <EntityView rel={rel} entity={entity} onChanged={() => setTick((n) => n + 1)} />;
}
