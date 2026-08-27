'use client';
/**
 * 共享 Presentation Surface 宿主(T7/T12 Canvas 链路;T27 D46 提炼)。
 *
 * 调用方只提供结构化呈现参数与标题;本组件唯一拥有取数、Sidecar、
 * hydrate、action gate、单树渲染与 why 状态链。调用树必须提供 EntityCacheProvider。
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
 *
 * T23 Phase D 拆分:动作处理接线 → canvas-action-handler.ts;单 surface
 * 异常隔离 → surface-error-boundary.tsx;Sidecar 个人视图操作 →
 * use-sidecar-actions.ts;Sidecar 工具条 → canvas-sidecar-toolbar.tsx。
 *
 * T24 Phase A Task 4:主区域不再渲染 CanvasSidecarToolbar——控制条只经
 * 「为什么这样展示」抽屉(canvas-why-drawer)可达,首屏零机制文案;
 * sidecar 视图语义(收起/疏密渲染)与 useSidecarActions 操作保持不变。
 */
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { SirenEntity, SurfaceTree } from '@ui4a/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { createActionGate, type CanvasClientAction } from '@/render/canvas/action-gate';
import { planSurface } from '@/render/canvas/surface-flow';
import { ui4aRenderCatalog } from '@/render/canvas/word-catalog';
import { CATALOG_ID, catalogUrl } from '@/render/registry';
import type { DerefWarning } from '@/render/deref';
import {
  hydratePresentationSurface,
  planGenericPresentationSurface,
} from '@/render/presentation/generic';
import { createCanvasActionHandler } from '../canvas-action-handler';
import { readThreadPins, writeThreadPin } from './thread-rail';
import { CanvasWhyDrawer, type PresentationDiagnostic } from '../canvas-why-drawer';
import { ActionSubmitProvider, createSurfaceActionSubmit } from '../actions/action-submit';
import { useEntityCache } from '../entity-cache-provider';
import { execAction, fetchEntity, withPolicyScope } from '../exec-client';
import { RawContractDrawer } from './raw-contract-drawer';
import { SurfaceErrorBoundary } from '../surface-error-boundary';
import { Button } from '../ui/button';
import { useSidecarActions } from '../use-sidecar-actions';
import {
  sidecarLoadFailure,
  SURFACE_LOAD_FAILED_PHRASE,
  SIDECAR_UNAVAILABLE_PHRASE,
  SidecarLoadFailure,
} from './presentation-sidecar-failure';
import { frozenSpecsOf, uniqueDiagnostics } from './presentation-surface-helpers';

// 注:@a2ui/react 0.10.2 声明的 ./styles/structural.css 在包内缺失(打包缺口);
// basic 原语样式经 useBasicCatalogStyles 运行时注入(adoptedStyleSheets),
// 词条样式走本站 tailwind——无需额外 CSS 引入。

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
  diagnostics: PresentationDiagnostic[];
}

const CANVAS_LOAD_TIMEOUT_MS = 15_000;

// T32 Q5(D47 第 5 问口径):载入失败首屏只显示固定人话,零机制标识
// (URL/HTTP 状态/sidecar id 不上首屏);结构化细节作为诊断进 why 抽屉。
// T33/D51 denied/unknown 分流的短语、错误类型与解析单点在
// ./presentation-sidecar-failure(B4),本组件只消费。
const CANVAS_LOAD_FAILED_PHRASE = '画布内容暂时无法载入，请稍后重试';

/** 把不支持 signal 的缓存/规划 Promise 纳入本轮取消域，旧轮结果不得落 state。 */
async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 成员缺字段诊断的人类可读机械投影。 */
function warningText(warning: DerefWarning): string {
  return `${warning.skipped} 条成员因缺字段 ${warning.fieldPath} 未纳入：${warning.members.join(
    '、',
  )}。请补齐该字段后重新载入。`;
}

export interface PresentationSurfaceParameters {
  /** Frozen render concern when no semantic focus is requested. */
  concern?: string;
  /** Exact Presentation subject, including virtual `workspace:*` subjects. */
  focus?: string;
  /** Comma-separated exact subjects for the existing multi-root Canvas view. */
  roots?: string;
  /** Exact Sidecar id supplied by a Presentation receipt. */
  sidecar?: string;
  /** Explicit URL policy scope preserved across Presentation and action requests. */
  scope?: string;
  /** Presence means external writes occurred and the page cache must be cleared. */
  refresh?: string;
  /** T35 W2:声明中的工作线(线工作台模式;surface 卡出现钉住控件)。 */
  thread?: string;
}

export interface PresentationSurfaceHostProps {
  /** Human-facing stage heading; it does not participate in subject resolution. */
  heading: string;
  /** Structured Presentation inputs; no value is inferred from the heading. */
  parameters: PresentationSurfaceParameters;
}

/** Shared binding-only Presentation host for URL-driven and fixed-subject mounts. */
export function PresentationSurfaceHost({ heading, parameters }: PresentationSurfaceHostProps) {
  const cache = useEntityCache();
  const concernParam = parameters.concern;
  const focusParam = parameters.focus;
  const rootsParam = parameters.roots;
  const scopeParam = parameters.scope;
  const sidecarParam = parameters.sidecar;
  const threadParam = parameters.thread;
  const focusRefreshParam = parameters.refresh;
  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  // T35 F-02:主 focus 解析失败(404)的结构化空态——中性措辞(D51 存在性隐藏)
  // + 恢复出口;实体名等机制细节只进 why 抽屉。
  const [focusUnavailable, setFocusUnavailable] = useState(false);
  const [loadIssues, setLoadIssues] = useState<PresentationDiagnostic[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // T35 W2:钉住集(呈现偏好,localStorage 按线隔离);版本号驱动钉住图标重渲。
  const [pinsVersion, setPinsVersion] = useState(0);
  useEffect(() => {
    const sync = (): void => setPinsVersion((version) => version + 1);
    window.addEventListener('ui4a:thread-pins-changed', sync);
    return () => window.removeEventListener('ui4a:thread-pins-changed', sync);
  }, []);
  const threadPins = useMemo(
    () => (threadParam === undefined ? [] : readThreadPins(threadParam)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinsVersion 是重读信号
    [threadParam, pinsVersion],
  );
  // T24「为什么这样展示」抽屉数据源与 T28 exact Siren verification lens。
  const [catalogId, setCatalogId] = useState<string>();
  const [focusEntity, setFocusEntity] = useState<SirenEntity>();
  // 重载触发器:拦截门 executed 后重载(gate 闭包经 ref 触发,不经渲染期读)。
  const reloadRef = useRef<() => void>(() => {});
  const loadGenerationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  // T35 F-01:词汇动作组(detail/member 词条的 ActionGroup)与 A2UI 原生动作
  // 同走 executed 协议——exec 成功 → 精确失效(rel + collection 回链)→ 整面
  // reload;投影更新即反馈。此前该路径成功后既不失效也不重载,画布保持旧状态。
  const surfaceSubmit = useMemo(() => {
    const submit = createSurfaceActionSubmit({
      fetchEntity: (subject) => fetchEntity(subject, undefined, scopeParam),
      exec: (input) => execAction({ ...input, scope: scopeParam }),
    });
    return async (input: Parameters<typeof submit>[0]) => {
      const result = await submit(input);
      if (result.ok) {
        cache.invalidateAfterExec(input.rel, result.entity);
        reloadRef.current();
      }
      return result;
    };
  }, [cache, scopeParam]);

  // Sidecar 个人视图操作(pin/revert/patch/explain/promote)与元信息状态:
  // 搬到 use-sidecar-actions;revert 后的整面重载经 reloadRef 触发(同拦截门口径)。
  const reload = useCallback(() => reloadRef.current(), []);
  const {
    sidecarMeta,
    setSidecarMeta,
    promotionPending,
    setPromotionPending,
    explanation,
    mutateSidecar,
    patchSidecar,
    explainSidecar,
    promoteSidecar,
  } = useSidecarActions({ notify: setNotice, reload, scope: scopeParam });

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
    setFocusUnavailable(false);
    setLoadIssues([]);
    setNotice(null);
    setSidecarMeta(undefined);
    setCatalogId(undefined);
    setFocusEntity(undefined);
    try {
      // 目录、sitemap 与凝固 spec 是彼此独立的只读前置输入。并行取数后统一
      // 校验，Presentation 仍只在三者全部可信后启动。
      const [catalogResponse, sitemapResponse, frozenCollection] = await Promise.all([
        fetch(catalogUrl, { signal: controller.signal }),
        fetch(withPolicyScope('/.well-known/ui4a.json', scopeParam), {
          signal: controller.signal,
        }),
        fetchEntity('render-specs', controller.signal, scopeParam),
      ]);
      if (!catalogResponse.ok)
        throw new Error(`GET ${catalogUrl} → HTTP ${catalogResponse.status}`);
      const catalog = (await catalogResponse.json()) as { catalogId?: string };
      if (catalog.catalogId !== CATALOG_ID) {
        throw new Error(
          `目录协商失败:服务目录 ${String(catalog.catalogId)} 与本地词汇表 ${CATALOG_ID} 不同源`,
        );
      }
      // 协商通过即服务目录 === CATALOG_ID;记录供抽屉展示(主区域零渲染)。
      setCatalogId(CATALOG_ID);
      if (generation !== loadGenerationRef.current) return;

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
        const response = await fetch(withPolicyScope('/api/presentation', scopeParam), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: 1,
            requestId: crypto.randomUUID(),
            principal: 'local-user',
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
      let sidecarHydrationRels: string[] = [];
      if (resolvedSidecarId !== undefined && requestedFocuses.length === 1) {
        const response = await fetch(
          withPolicyScope(
            `/api/presentation/sidecar?sidecarId=${encodeURIComponent(resolvedSidecarId)}`,
            scopeParam,
          ),
          { signal: controller.signal },
        );
        if (!response.ok) {
          // D51/B4 诚实分支:denied(403)与 unknown(404)在
          // presentation-sidecar-failure 单点映射为人话;其余传输失败维持
          // T32 Q5 通用口径。[data-testid] 契约不变。
          const failureBody = await response.json().catch(() => undefined);
          const failure = sidecarLoadFailure(response.status, failureBody, resolvedSidecarId);
          if (failure !== undefined) throw failure;
          throw new Error(`Sidecar ${resolvedSidecarId} → HTTP ${response.status}`);
        }
        const body = (await response.json()) as {
          sidecar?: {
            id?: unknown;
            version?: unknown;
            retention?: unknown;
            key?: { subject?: unknown };
            surface?: SurfaceTree;
            dependencies?: Array<{ kind?: unknown; ref?: unknown }>;
            view?: {
              collapsedNodeIds?: unknown;
              densityByNodeId?: unknown;
            };
          };
        };
        if (
          body.sidecar?.key?.subject !== requestedFocuses[0] ||
          body.sidecar.surface === undefined
        ) {
          throw new Error('Sidecar subject/surface does not match the requested focus');
        }
        sidecarSurface = body.sidecar.surface;
        sidecarHydrationRels = [
          ...new Set(
            (body.sidecar.dependencies ?? [])
              .filter(
                (dependency) =>
                  dependency.kind === 'entity-contract' && typeof dependency.ref === 'string',
              )
              .map((dependency) => dependency.ref as string),
          ),
        ];
        if (
          typeof body.sidecar.id === 'string' &&
          typeof body.sidecar.version === 'number' &&
          (body.sidecar.retention === 'cache' || body.sidecar.retention === 'pinned')
        ) {
          setSidecarMeta({
            id: body.sidecar.id,
            version: body.sidecar.version,
            retention: body.sidecar.retention,
            rootNodeId: body.sidecar.surface.root.id,
            view: {
              collapsedNodeIds: Array.isArray(body.sidecar.view?.collapsedNodeIds)
                ? body.sidecar.view.collapsedNodeIds.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : [],
              densityByNodeId:
                typeof body.sidecar.view?.densityByNodeId === 'object' &&
                body.sidecar.view.densityByNodeId !== null
                  ? (body.sidecar.view.densityByNodeId as Record<
                      string,
                      'compact' | 'comfortable' | 'spacious'
                    >)
                  : {},
            },
          });
        }
      }

      // 4. 拦截门 + MessageProcessor(每轮重载重建,白名单随数据模型重建);
      // 实体取数经页面缓存:同 rel 跨 surface 零重复 fetch。
      const gate = createActionGate((input) => execAction({ ...input, scope: scopeParam }));
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
      const failedIssues: PresentationDiagnostic[] = [];
      const primaryFocus = requestedFocuses[0];
      const noteFailure = (nodeId: string, error: unknown): void => {
        // T35 F-02:主 focus 实体不可解析(404)走结构化空态——首屏只留中性
        // 措辞与恢复出口,机制细节进抽屉;其余失败维持通用口径。
        const message = error instanceof Error ? error.message : String(error);
        const missing = /^实体 "(.+)" 不存在$/.exec(message);
        if (primaryFocus !== undefined && missing !== null && missing[1] === primaryFocus) {
          setFocusUnavailable(true);
          failedIssues.push({
            code: 'focus-unavailable',
            nodeId,
            path: '/canvas',
            message,
          });
          return;
        }
        failed.push(SURFACE_LOAD_FAILED_PHRASE);
        failedIssues.push({
          code: 'surface-load-failed',
          nodeId,
          path: '/canvas',
          message,
        });
      };
      const planned: {
        surfaceId: string;
        concern: string;
        warnings: DerefWarning[];
        diagnostics: PresentationDiagnostic[];
      }[] = [];
      if (sidecarSurface !== undefined && requestedFocuses.length === 1) {
        const requestedFocus = requestedFocuses[0]!;
        try {
          const hydrationRels = sidecarHydrationRels;
          const roots: SirenEntity[] = [];
          for (const rel of hydrationRels) {
            const entity = await withAbort(cache.get(rel), controller.signal);
            if (entity === null) throw new Error(`实体 "${rel}" 不存在`);
            roots.push(entity);
          }
          const focusEntity = roots.find((entity) => entity.properties.rel === requestedFocus);
          if (focusEntity !== undefined) setFocusEntity(focusEntity);
          const plan = hydratePresentationSurface(requestedFocus, sidecarSurface, roots);
          for (const hydrated of plan.entities.values()) gate.register(hydrated);
          processor.processMessages(plan.bundle.messages);
          planned.push({
            surfaceId: plan.bundle.surfaceId,
            concern: `presentation:${requestedFocus}`,
            warnings: [],
            diagnostics: plan.bundle.issues,
          });
        } catch (error) {
          noteFailure(`presentation:${requestedFocus}`, error);
        }
      } else {
        for (const requestedFocus of requestedFocuses) {
          try {
            const entity = await withAbort(cache.get(requestedFocus), controller.signal);
            if (entity === null) throw new Error(`实体 "${requestedFocus}" 不存在`);
            // 主 focus(首项)的原始合同文本:load 已取得的实体直接序列化,
            // 零额外取数;只进抽屉,不进主区域渲染。
            if (requestedFocus === requestedFocuses[0]) setFocusEntity(entity);
            const plan = planGenericPresentationSurface(
              requestedFocus,
              entity,
              sitemap.version,
              'read',
            );
            for (const hydrated of plan.entities.values()) gate.register(hydrated);
            processor.processMessages(plan.bundle.messages);
            planned.push({
              surfaceId: plan.bundle.surfaceId,
              concern: `presentation:${requestedFocus}`,
              warnings: [],
              diagnostics: plan.bundle.issues,
            });
          } catch (error) {
            noteFailure(`presentation:${requestedFocus}`, error);
          }
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
            diagnostics: [],
          });
        } catch (error) {
          noteFailure(spec.concern, error);
        }
      }

      if (generation !== loadGenerationRef.current || controller.signal.aborted) return;
      setSurfaces(
        planned.flatMap(({ surfaceId, concern, warnings, diagnostics }) => {
          const surface = processor.model.surfacesMap.get(surfaceId);
          return surface === undefined
            ? []
            : [
                {
                  id: surfaceId,
                  generation,
                  concern,
                  // T35 F-24:data-active 只服务 ?concern= 回执锚点(S5);
                  // 常规 focus 页不得恒亮蓝框。
                  active: concernParam !== undefined && concern === activeConcern,
                  surface,
                  warnings,
                  diagnostics,
                },
              ];
        }),
      );
      // T35 F-03(前置):同文错误行聚合去重,不逐 surface 堆叠。
      setErrors([...new Set(failed)]);
      setLoadIssues(failedIssues);
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      if (reason instanceof Error && reason.name === 'AbortError') return;
      if (error instanceof SidecarLoadFailure) {
        // denied/unknown 专属人话 + 独立诊断条目(reasonCode 数据在抽屉可见)。
        setErrors([error.userPhrase]);
        setLoadIssues([error.diagnostic]);
        return;
      }
      // 首屏固定人话;机制细节(URL/HTTP 状态/原始 message)进抽屉诊断。
      setErrors([CANVAS_LOAD_FAILED_PHRASE]);
      setLoadIssues([
        {
          code: 'canvas-load-failed',
          nodeId: 'canvas',
          path: '/canvas',
          message: reason instanceof Error ? reason.message : String(reason),
        },
      ]);
    } finally {
      clearTimeout(timeout);
      if (generation === loadGenerationRef.current) {
        inFlightRef.current = null;
        setLoading(false);
      }
    }
  }, [
    cache,
    concernParam,
    focusParam,
    focusRefreshParam,
    rootsParam,
    scopeParam,
    setSidecarMeta,
    sidecarParam,
  ]);

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
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
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

      {/* T24:机制信息收口进抽屉(默认关闭,零机制词泄漏;数据全部来自
          内部状态与 sidecar 操作,能力与主区域控制条等价)。 */}
      <div className="flex flex-wrap gap-2">
        <CanvasWhyDrawer
          surfaceIds={surfaces.map((entry) => entry.id)}
          catalogId={catalogId}
          diagnostics={uniqueDiagnostics([
            ...surfaces.flatMap((entry) => entry.diagnostics),
            ...loadIssues,
          ])}
          sidecarMeta={sidecarMeta}
          promotionPending={promotionPending}
          explanation={explanation}
          mutateSidecar={mutateSidecar}
          patchSidecar={patchSidecar}
          explainSidecar={explainSidecar}
          promoteSidecar={promoteSidecar}
          cancelPromotion={() => setPromotionPending(false)}
        />
        <RawContractDrawer entity={focusEntity} />
      </div>

      {notice !== null && (
        <p
          role="status"
          data-testid="canvas-notice"
          className="mt-4 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}
      {/* T24 Phase A Task 4:Sidecar 控制条已从主区域移除,抽屉入口是唯一
          机制入口(能力等价:同一 CanvasSidecarToolbar 嵌在抽屉内)。 */}
      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-destructive" data-testid="canvas-errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      {/* T35 F-02:focus 不可解析的结构化空态(D51 中性口径);机制细节在抽屉。 */}
      {focusUnavailable && !loading && (
        <div
          data-testid="canvas-focus-unavailable"
          className="mt-6 rounded-lg border bg-card p-6 text-card-foreground"
        >
          <p className="text-sm font-medium">{SIDECAR_UNAVAILABLE_PHRASE}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            你声明的注视当前无法展开。可以用顶栏的「调整声明」更换注视，或回到首页。
          </p>
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <a href="/">返回首页</a>
            </Button>
          </div>
        </div>
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
              sidecarMeta?.view.densityByNodeId[sidecarMeta.rootNodeId] === 'compact' && 'p-2',
              sidecarMeta?.view.densityByNodeId[sidecarMeta.rootNodeId] === 'spacious' && 'p-8',
            )}
          >
            {threadParam !== undefined && (
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  data-nav={`local:thread-pin:${entry.concern}`}
                  aria-pressed={threadPins.includes(
                    entry.concern.startsWith('presentation:')
                      ? entry.concern.slice('presentation:'.length)
                      : entry.concern,
                  )}
                  title={
                    threadPins.includes(
                      entry.concern.startsWith('presentation:')
                        ? entry.concern.slice('presentation:'.length)
                        : entry.concern,
                    )
                      ? '取消钉住'
                      : '钉住到本线'
                  }
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    const rel = entry.concern.startsWith('presentation:')
                      ? entry.concern.slice('presentation:'.length)
                      : entry.concern;
                    const pinned = threadPins.includes(rel);
                    writeThreadPin(threadParam, rel, !pinned);
                  }}
                >
                  {threadPins.includes(
                    entry.concern.startsWith('presentation:')
                      ? entry.concern.slice('presentation:'.length)
                      : entry.concern,
                  )
                    ? '📌 已钉住本线'
                    : '📌 钉住到本线'}
                </button>
              </div>
            )}
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
            {sidecarMeta?.view.collapsedNodeIds.includes(sidecarMeta.rootNodeId) ? (
              <p className="text-sm text-muted-foreground">此视图已收起，可在上方重新展开。</p>
            ) : (
              <SurfaceErrorBoundary surfaceId={entry.id}>
                <ActionSubmitProvider submit={surfaceSubmit}>
                  <A2uiSurface surface={entry.surface} />
                </ActionSubmitProvider>
              </SurfaceErrorBoundary>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
