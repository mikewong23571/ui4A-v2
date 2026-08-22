'use client';
/**
 * 画布主体(T7 Phase B / spec 架构决定 3/5;T12 Phase B Task 3 接入页面级实体缓存)。
 *
 * 与 app/canvas/page.tsx 拆分的理由同 entity 页:页面壳只挂页面级缓存承载
 * (EntityCacheProvider,生命周期 = 本页);渲染流与动作接线在此,组件级可测。
 *
 * 渲染流(spec 架构决定 2,客户端拥有数据模型):
 * 1. 目录协商:GET /api/render/catalog → catalogId 与本地注册表同源才继续;
 * 2. 凝固 spec 列表:GET /api/entity?rel=render-specs(合同路径,零特权端点)
 *    ——每轮 load 直取,不入页面缓存:它是本轮规划的输入,「重新载入」=
 *    spec 列表即新鲜(D18 整面 reload 兜底口径不变);
 * 3. 单例演示:table 词条静态绑定 articles 集合(零 AI,审计通道隔离);
 * 4. 每 spec:planSurface(校验 → 引用实体经页面级缓存拉取 → deref)→
 *    MessageProcessor 四消息 → A2uiSurface 渲染。同页多 surface 共享同一
 *    PageEntityCache:同 rel 跨 surface 零重复 fetch(换 concern/换词条的
 *    二次渲染直接命中);deref 仍消费每面一次性快照(D18 口径,零响应式订阅);
 * 5. action 拦截门:组件事件 → 实体已声明 action → /api/exec;白名单外
 *    拒(零调用);executed 后先精确失效(当前 rel + 真实所属 collection,
 *    实体回链优先)再整面 reload 重建(数据即事件投影,兜底路径保留)。
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
import type { SirenEntity, SurfaceTree } from '@ui4a/engine';
import { useSearchParams } from 'next/navigation';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import {
  createActionGate,
  type ActionGate,
  type CanvasClientAction,
} from '@/render/canvas/action-gate';
import { planSurface } from '@/render/canvas/surface-flow';
import { ui4aRenderCatalog } from '@/render/canvas/word-catalog';
import { CATALOG_ID, catalogUrl } from '@/render/registry';
import type { DerefWarning } from '@/render/deref';
import {
  hydratePresentationSurface,
  planGenericPresentationSurface,
} from '@/render/presentation/generic';
import type { RenderSpec } from '@/render/spec';

import { useEntityCache, type EntityCacheHandle } from './entity-cache-provider';
import { execAction, fetchEntity } from './exec-client';
import { Button } from './ui/button';

// 注:@a2ui/react 0.10.2 声明的 ./styles/structural.css 在包内缺失(打包缺口);
// basic 原语样式经 useBasicCatalogStyles 运行时注入(adoptedStyleSheets),
// 词条样式走本站 tailwind——无需额外 CSS 引入。

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

/** 画布动作处理的依赖(拦截门 / 页面缓存 / 告示 / 整面 reload 入口)。 */
export interface CanvasActionHandlerDeps {
  gate: ActionGate;
  cache: EntityCacheHandle;
  notify: (message: string) => void;
  reload: () => void;
}

/**
 * 画布动作处理:白名单裁决 → executed 时先精确失效(当前 rel + 实体回链的
 * 真实所属 collection)再整面 reload——reload 后受影响 rel 经页面缓存重取,
 * 无关 rel 命中缓存;rejected/refused 零失效零 reload(诚实失败口径不变)。
 */
export function createCanvasActionHandler(deps: CanvasActionHandlerDeps) {
  return async (action: CanvasClientAction): Promise<void> => {
    const outcome = await deps.gate.handle(action);
    if (outcome.outcome === 'executed') {
      const rel = action.context.rel;
      // gate 已保证 executed 时 rel 是非空字符串;这里仍按合同形状防御一次。
      if (typeof rel === 'string' && rel !== '') {
        deps.cache.invalidateAfterExec(rel, outcome.entity);
      }
      deps.notify(`动作已执行:${action.name}`);
      deps.reload(); // executed → 数据即事件投影,整面 reload 重建 surface
      return;
    }
    deps.notify(
      outcome.outcome === 'rejected'
        ? `渲染层拒绝:${outcome.reason}`
        : `裁决层拒绝:[${outcome.layer}] ${outcome.reason}`,
    );
  };
}

/** 渲染中的 surface 条目(surface 模型进 state:渲染只读 state,不读 ref)。 */
interface SurfaceEntry {
  id: string;
  generation: number;
  /** spec 关注点键(data-concern 锚点;chat 回执链接/断言用)。 */
  concern: string;
  /** ?concern= 激活高亮(排最前 + data-active)。 */
  active: boolean;
  surface: SurfaceModel<ReactComponentImplementation>;
  warnings: DerefWarning[];
}

const CANVAS_LOAD_TIMEOUT_MS = 15_000;

/** 把不支持 signal 的缓存/规划 Promise 纳入本轮取消域，旧轮结果不得落 state。 */
async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

interface SurfaceErrorBoundaryProps {
  surfaceId: string;
  children: ReactNode;
}

interface SurfaceErrorBoundaryState {
  error?: string;
}

/** 隔离单个 A2UI surface 的渲染期异常,保留同页其余 surface。 */
export class SurfaceErrorBoundary extends Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  state: SurfaceErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): SurfaceErrorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    if (this.state.error !== undefined) {
      return (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          surface {this.props.surfaceId} 渲染失败：{this.state.error}。请检查该 surface
          的数据绑定后重新载入。
        </div>
      );
    }
    return this.props.children;
  }
}

/** 成员缺字段诊断的人类可读机械投影。 */
function warningText(warning: DerefWarning): string {
  return `${warning.skipped} 条成员因缺字段 ${warning.fieldPath} 未纳入：${warning.members.join(
    '、',
  )}。请补齐该字段后重新载入。`;
}

export function CanvasBody() {
  const cache = useEntityCache();
  // ?concern= 经 hook 读取(同路由软导航不重挂载):concern 变化 → load 重建
  // → 挂载 effect 重跑,整面重载(render 回执即达即跳在画布上的二次渲染)。
  const concernParam = useSearchParams().get('concern') ?? undefined;
  const focusParam = useSearchParams().get('focus') ?? undefined;
  const rootsParam = useSearchParams().get('roots') ?? undefined;
  const sidecarParam = useSearchParams().get('sidecar') ?? undefined;
  const focusRefreshParam = useSearchParams().get('refresh') ?? undefined;
  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [negotiated, setNegotiated] = useState(false);
  // 重载触发器:拦截门 executed 后重载(gate 闭包经 ref 触发,不经渲染期读)。
  const reloadRef = useRef<() => void>(() => {});
  const loadGenerationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    // chat 是画布缓存之外的执行者；refresh 表明合同刚发生写入，影响范围
    // 可能包含追加集合等多个 rel，故在本代 load 开始前清空页面缓存。
    if (focusRefreshParam !== undefined) cache.invalidateAll();
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    inFlightRef.current?.abort(
      new DOMException('Superseded by a newer canvas load.', 'AbortError'),
    );
    const controller = new AbortController();
    inFlightRef.current = controller;
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Canvas load timed out.', 'TimeoutError')),
      CANVAS_LOAD_TIMEOUT_MS,
    );
    setLoading(true);
    setErrors([]);
    setNotice(null);
    setNegotiated(false);
    try {
      // 1. 目录协商(catalogId 稳定 URI;目录与注册表同源才继续)。
      const catalogResponse = await fetch(catalogUrl, { signal: controller.signal });
      if (!catalogResponse.ok)
        throw new Error(`GET ${catalogUrl} → HTTP ${catalogResponse.status}`);
      const catalog = (await catalogResponse.json()) as { catalogId?: string };
      if (catalog.catalogId !== CATALOG_ID) {
        throw new Error(
          `目录协商失败:服务目录 ${String(catalog.catalogId)} 与本地词汇表 ${CATALOG_ID} 不同源`,
        );
      }
      if (generation !== loadGenerationRef.current) return;
      setNegotiated(true);

      const sitemapResponse = await fetch('/.well-known/ui4a.json', {
        signal: controller.signal,
      });
      if (!sitemapResponse.ok) {
        throw new Error(`GET /.well-known/ui4a.json → HTTP ${sitemapResponse.status}`);
      }
      const sitemap = (await sitemapResponse.json()) as { version?: unknown };
      if (typeof sitemap.version !== 'string' || sitemap.version === '') {
        throw new Error('sitemap 响应缺 version');
      }

      // 2/3. focus/default 走语义 Surface Tree；旧 concern 只保留兼容读取。
      // ?concern= 激活的 spec 排最前(S5:聊天 render 回执的画布入口;命中与否
      // 不改变渲染集)。
      const frozenCollection = await fetchEntity('render-specs', controller.signal);
      const frozenSpecs = frozenCollection !== null ? frozenSpecsOf(frozenCollection) : [];
      const selectedRoots =
        rootsParam === undefined
          ? []
          : [
              ...new Set(
                rootsParam
                  .split(',')
                  .map((rel) => rel.trim())
                  .filter(Boolean),
              ),
            ].slice(0, 32);
      const requestedFocuses =
        selectedRoots.length > 0
          ? selectedRoots
          : [focusParam ?? (concernParam === undefined ? 'articles' : undefined)].filter(
              (rel): rel is string => rel !== undefined,
            );
      const activeConcern =
        requestedFocuses.length === 0 ? concernParam : `presentation:${requestedFocuses[0]}`;
      const specs =
        requestedFocuses.length === 0
          ? frozenSpecs.filter((spec) => spec.concern === activeConcern)
          : [];
      let resolvedSidecarId = sidecarParam;
      if (
        resolvedSidecarId === undefined &&
        focusParam !== undefined &&
        requestedFocuses.length === 1
      ) {
        const response = await fetch('/api/presentation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: 1,
            requestId: crypto.randomUUID(),
            principal: 'user:local',
            subject: requestedFocuses[0],
            intent: 'read',
            delivery: 'canvas',
            sourceMessageIds: [],
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const receipt = (await response.json()) as { sidecar?: { id?: unknown } };
          if (typeof receipt.sidecar?.id === 'string') resolvedSidecarId = receipt.sidecar.id;
        }
      }
      let sidecarSurface: SurfaceTree | undefined;
      if (resolvedSidecarId !== undefined && requestedFocuses.length === 1) {
        const response = await fetch(
          `/api/presentation/sidecar?sidecarId=${encodeURIComponent(resolvedSidecarId)}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`Sidecar ${resolvedSidecarId} → HTTP ${response.status}`);
        }
        const body = (await response.json()) as {
          sidecar?: { key?: { subject?: unknown }; surface?: SurfaceTree };
        };
        if (
          body.sidecar?.key?.subject !== requestedFocuses[0] ||
          body.sidecar.surface === undefined
        ) {
          throw new Error('Sidecar subject/surface does not match the requested focus');
        }
        sidecarSurface = body.sidecar.surface;
      }

      // 4. 拦截门 + MessageProcessor(每轮重载重建,白名单随数据模型重建);
      // 实体取数经页面缓存:同 rel 跨 surface 零重复 fetch。
      const gate = createActionGate(execAction);
      const handleAction = createCanvasActionHandler({
        gate,
        cache,
        notify: setNotice,
        reload: () => reloadRef.current(),
      });
      const processor = new MessageProcessor([ui4aRenderCatalog], (action) =>
        // SDK 动作是宽形状;拦截门按合同形状裁决(action-gate 既有口径)。
        handleAction(action as CanvasClientAction),
      );

      const failed: string[] = [];
      const planned: { surfaceId: string; concern: string; warnings: DerefWarning[] }[] = [];
      for (const requestedFocus of requestedFocuses) {
        try {
          const entity = await withAbort(cache.get(requestedFocus), controller.signal);
          if (entity === null) throw new Error(`实体 "${requestedFocus}" 不存在`);
          const plan =
            sidecarSurface === undefined
              ? planGenericPresentationSurface(requestedFocus, entity, sitemap.version)
              : hydratePresentationSurface(requestedFocus, sidecarSurface, entity);
          for (const hydrated of plan.entities.values()) gate.register(hydrated);
          processor.processMessages(plan.bundle.messages);
          planned.push({
            surfaceId: plan.bundle.surfaceId,
            concern: `presentation:${requestedFocus}`,
            warnings: [],
          });
        } catch (error) {
          failed.push(
            `presentation:${requestedFocus}:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      for (const spec of specs) {
        try {
          const plan = await withAbort(planSurface(spec, cache.get), controller.signal);
          for (const entity of plan.cache.values()) gate.register(entity);
          processor.processMessages(plan.messages);
          planned.push({
            surfaceId: plan.surfaceId,
            concern: spec.concern,
            warnings: plan.warnings,
          });
        } catch (error) {
          failed.push(`${spec.concern}:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (generation !== loadGenerationRef.current || controller.signal.aborted) return;
      setSurfaces(
        planned.flatMap(({ surfaceId, concern, warnings }) => {
          const surface = processor.model.surfacesMap.get(surfaceId);
          return surface === undefined
            ? []
            : [
                {
                  id: surfaceId,
                  generation,
                  concern,
                  active:
                    requestedFocuses.length > 0
                      ? concern.startsWith('presentation:')
                      : concern === activeConcern,
                  surface,
                  warnings,
                },
              ];
        }),
      );
      setErrors(failed);
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      if (reason instanceof Error && reason.name === 'AbortError') return;
      setErrors([reason instanceof Error ? reason.message : String(reason)]);
    } finally {
      clearTimeout(timeout);
      if (generation === loadGenerationRef.current) {
        inFlightRef.current = null;
        setLoading(false);
      }
    }
  }, [cache, concernParam, focusParam, focusRefreshParam, rootsParam, sidecarParam]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(initial);
      inFlightRef.current?.abort(new DOMException('Canvas view changed.', 'AbortError'));
    };
  }, [load]);

  // latest-ref:拦截门 executed 后的重载入口(effect 内更新,渲染期零 ref 访问)。
  useEffect(() => {
    reloadRef.current = () => void load();
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">画布</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-nav="local:canvas-reload"
          disabled={loading}
          onClick={() => void load()}
        >
          重新载入
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        A2UI surface 宿主 · 目录 {negotiated ? `已协商(${CATALOG_ID})` : '协商中'}
        {loading ? ' · 加载中…' : ` · ${surfaces.length} 个 surface`}
      </p>

      {notice !== null && (
        <p
          role="status"
          data-testid="canvas-notice"
          className="mt-4 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-destructive" data-testid="canvas-errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <section
        aria-label="surfaces"
        className={cn('mt-6 gap-6', rootsParam === undefined ? 'space-y-8' : 'grid lg:grid-cols-2')}
      >
        {surfaces.map((entry) => (
          <div
            key={`${entry.generation}:${entry.id}`}
            data-surface={entry.id}
            data-concern={entry.concern}
            {...(entry.active ? { 'data-active': 'true' } : {})}
            className={cn(
              'rounded-lg border bg-card p-4 text-card-foreground shadow-sm',
              entry.active && 'border-primary ring-2 ring-ring/20',
            )}
          >
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{entry.id}</h2>
            {entry.warnings.map((warning, index) => (
              <p
                key={`${warning.collection}:${warning.fieldPath}:${index}`}
                role="status"
                data-testid="surface-warning"
                className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-foreground"
              >
                {warningText(warning)}
              </p>
            ))}
            <SurfaceErrorBoundary surfaceId={entry.id}>
              <A2uiSurface surface={entry.surface} />
            </SurfaceErrorBoundary>
          </div>
        ))}
      </section>
    </div>
  );
}
