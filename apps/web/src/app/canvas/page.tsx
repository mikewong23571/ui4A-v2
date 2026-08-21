'use client';
/**
 * 画布页(T7 Phase B / spec 架构决定 3/5):A2UI surface 宿主。
 *
 * 渲染流(spec 架构决定 2,客户端拥有数据模型):
 * 1. 目录协商:GET /api/render/catalog → catalogId 与本地注册表同源才继续;
 * 2. 凝固 spec 列表:GET /api/entity?rel=render-specs(合同路径,零特权端点);
 * 3. 单例演示:table 词条静态绑定 articles 集合(零 AI,审计通道隔离);
 * 4. 每 spec:planSurface(校验 → 引用实体拉取进缓存 → deref)→
 *    MessageProcessor 四消息 → A2uiSurface 渲染;
 * 5. action 拦截门:组件事件 → 实体已声明 action → /api/exec;白名单外
 *    拒(零调用),executed 后重载 surface(数据即事件投影)。
 *
 * spec 激活(T7 Phase C / S5):?concern=<凝固键>(悬浮聊天 render 回执的
 * 画布入口)→ 命中 surface 排最前 + data-active 高亮;每个 surface 携带
 * data-concern(断言/链接锚点)。
 *
 * 词汇表 = 官方 SDK(@a2ui/react + web_core,DECISIONS D12)的
 * basic 布局原语 + 十数据词条(word-catalog)。
 */
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { SirenEntity } from '@ui4a/engine';
import { useCallback, useEffect, useRef, useState } from 'react';

import { execAction, fetchEntity } from '@/components/exec-client';

import { createActionGate, type ActionGate, type CanvasClientAction } from '@/render/canvas/action-gate';
import { planSurface } from '@/render/canvas/surface-flow';
import { ui4aRenderCatalog } from '@/render/canvas/word-catalog';
import { CATALOG_ID, catalogUrl } from '@/render/registry';
import type { RenderSpec } from '@/render/spec';

// 注:@a2ui/react 0.10.2 声明的 ./styles/structural.css 在包内缺失(打包缺口);
// basic 原语样式经 useBasicCatalogStyles 运行时注入(adoptedStyleSheets),
// 词条样式走本站 tailwind——无需额外 CSS 引入。

/** 单例演示 spec(table 词条:articles 集合;写死绑定,零 AI)。 */
const DEMO_SPEC: RenderSpec = {
  concern: 'demo-articles-table',
  component: 'table',
  bind: { rows: { collection: 'articles' } },
};

/** 从 render-specs 集合实体提取凝固 spec(properties 直出,零特权端点)。 */
function frozenSpecsOf(collection: SirenEntity): RenderSpec[] {
  return (collection.entities ?? []).flatMap((member) => {
    const { concern, component, bind } = member.properties;
    if (typeof concern !== 'string' || typeof component !== 'string' || bind === undefined) {
      return [];
    }
    return [{ concern, component, bind: bind as RenderSpec['bind'] }];
  });
}

/** 渲染中的 surface 条目(surface 模型进 state:渲染只读 state,不读 ref)。 */
interface SurfaceEntry {
  id: string;
  /** spec 关注点键(data-concern 锚点;chat 回执链接/断言用)。 */
  concern: string;
  /** ?concern= 激活高亮(排最前 + data-active)。 */
  active: boolean;
  surface: SurfaceModel<ReactComponentImplementation>;
}

export default function CanvasPage() {
  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [negotiated, setNegotiated] = useState(false);
  // 重载触发器:拦截门 executed 后重载(gate 闭包经 ref 触发,不经渲染期读)。
  const reloadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setNotice(null);
    try {
      // 1. 目录协商(catalogId 稳定 URI;目录与注册表同源才继续)。
      const catalogResponse = await fetch(catalogUrl);
      if (!catalogResponse.ok) throw new Error(`GET ${catalogUrl} → HTTP ${catalogResponse.status}`);
      const catalog = (await catalogResponse.json()) as { catalogId?: string };
      if (catalog.catalogId !== CATALOG_ID) {
        throw new Error(
          `目录协商失败:服务目录 ${String(catalog.catalogId)} 与本地词汇表 ${CATALOG_ID} 不同源`,
        );
      }
      setNegotiated(true);

      // 2/3. 凝固 spec 列表(合同路径)+ 单例演示;?concern= 激活的
      // spec 排最前(S5:悬浮聊天的画布入口;命中与否不改变渲染集)。
      const frozenCollection = await fetchEntity('render-specs');
      const frozenSpecs = frozenCollection !== null ? frozenSpecsOf(frozenCollection) : [];
      const activeConcern =
        typeof window === 'undefined'
          ? undefined
          : new URLSearchParams(window.location.search).get('concern') ?? undefined;
      const all = [...frozenSpecs, DEMO_SPEC];
      const specs = [
        ...all.filter((spec) => spec.concern === activeConcern),
        ...all.filter((spec) => spec.concern !== activeConcern),
      ];

      // 4. 拦截门 + MessageProcessor(每轮重载重建,白名单随数据模型重建)。
      const gate = createActionGate(execAction);
      const processor = new MessageProcessor([ui4aRenderCatalog], async (action) => {
        const outcome = await gate.handle(action as CanvasClientAction);
        if (outcome.outcome === 'executed') {
          setNotice(`动作已执行:${action.name}`);
          reloadRef.current(); // executed → 数据即事件投影,重载 surface
          return;
        }
        setNotice(
          outcome.outcome === 'rejected'
            ? `渲染层拒绝:${outcome.reason}`
            : `裁决层拒绝:[${outcome.layer}] ${outcome.reason}`,
        );
      });

      const failed: string[] = [];
      const planned: { surfaceId: string; concern: string }[] = [];
      for (const spec of specs) {
        try {
          const plan = await planSurface(spec, fetchEntity);
          for (const entity of plan.cache.values()) gate.register(entity);
          processor.processMessages(plan.messages);
          planned.push({ surfaceId: plan.surfaceId, concern: spec.concern });
        } catch (error) {
          failed.push(`${spec.concern}:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      setSurfaces(
        planned.flatMap(({ surfaceId, concern }) => {
          const surface = processor.model.surfacesMap.get(surfaceId);
          return surface === undefined
            ? []
            : [{ id: surfaceId, concern, active: concern === activeConcern, surface }];
        }),
      );
      setErrors(failed);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    return () => clearTimeout(initial);
  }, [load]);

  // latest-ref:拦截门 executed 后的重载入口(effect 内更新,渲染期零 ref 访问)。
  useEffect(() => {
    reloadRef.current = () => void load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">画布</h1>
        <button
          type="button"
          data-nav="local:canvas-reload"
          onClick={() => void load()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          重新载入
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        A2UI surface 宿主 · 目录 {negotiated ? `已协商(${CATALOG_ID})` : '协商中'}
        {loading ? ' · 加载中…' : ` · ${surfaces.length} 个 surface`}
      </p>

      {notice !== null && (
        <p
          role="status"
          data-testid="canvas-notice"
          className="mt-4 rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700"
        >
          {notice}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-red-600" data-testid="canvas-errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <section aria-label="surfaces" className="mt-6 space-y-8">
        {surfaces.map((entry) => (
          <div
            key={entry.id}
            data-surface={entry.id}
            data-concern={entry.concern}
            {...(entry.active ? { 'data-active': 'true' } : {})}
            className={`rounded-lg border p-4 ${
              entry.active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-zinc-200'
            }`}
          >
            <h2 className="mb-3 text-sm font-semibold text-zinc-500">{entry.id}</h2>
            <A2uiSurface surface={entry.surface} />
          </div>
        ))}
      </section>
    </main>
  );
}
