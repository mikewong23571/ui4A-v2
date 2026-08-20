'use client';
/**
 * 实体通用渲染页:/entity?rel=…(T2 Phase F,:form runner 人类路径)。
 *
 * 路由口径:rel 含 ":"(post:post-welcome / flow:article-drafting / …),
 * query 参数与合同端点 /api/entity?rel=… 同构,renderer 不做任何 rel 解析——
 * flow 别名、集合、实例一律交给引擎投影。
 * 页面 = fetch /api/entity → EntityView(properties/actions/links/guard-results);
 * 动作 exec 成功后经 tick 重拉(事件溯源:投影总能由日志重算;重拉期间保留旧投影)。
 */
import type { SirenEntity } from '@ui4a/engine';
import { use, useEffect, useState } from 'react';

import { EntityView } from '@/components/entity-view';
import { fetchEntity } from '@/components/exec-client';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export default function EntityPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = use(searchParams);
  const rel = typeof params.rel === 'string' ? params.rel : '';
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
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <nav className="mb-2 text-sm">
          <a href="/" className="text-blue-600 hover:underline">
            ← 首页
          </a>
        </nav>
        <p className="text-sm text-zinc-700">缺少 rel 参数。用法:/entity?rel=post:post-welcome。</p>
      </main>
    );
  }

  if (state === 'error' || state === 'missing') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <nav className="mb-2 text-sm">
          <a href="/" className="text-blue-600 hover:underline">
            ← 首页
          </a>
        </nav>
        {state === 'missing' ? (
          <p className="text-sm text-zinc-700">实体 “{rel}” 不存在(404)。</p>
        ) : (
          <p className="text-sm text-zinc-700">读取实体 “{rel}” 失败(服务不可用)。</p>
        )}
      </main>
    );
  }

  if (state === 'loading' || entity === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <p className="text-sm text-zinc-500">加载中…</p>
      </main>
    );
  }

  return <EntityView rel={rel} entity={entity} onChanged={() => setTick((n) => n + 1)} />;
}
