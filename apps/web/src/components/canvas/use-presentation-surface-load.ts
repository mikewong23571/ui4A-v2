'use client';
/**
 * Presentation Surface 载入编排 hook(T36 A1 自 presentation-surface-host 提取;
 * 职责边界见该组件头注,渲染流步骤 1–5 的执行体在本 hook)。
 *
 * 拥有:目录协商、凝固 spec 读取、sidecar 解析(含 F-31 烙版)、focus/roots
 * 规划(hydrate/generic)、拦截门与 MessageProcessor 装配、取消域(超时/代次/
 * supersede)、sidecar 个人视图操作接线与词汇 surfaceSubmit(F-01 executed
 * 协议:精确失效 → 合同广播 → 整面 reload)。
 *
 * 宿主(presentation-surface-host)只消费状态与动作做装配+渲染。
 */
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { SirenEntity, SurfaceTree } from '@ui4a/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createActionGate, type CanvasClientAction } from '@/render/canvas/action-gate';
import { planSurface } from '@/render/canvas/surface-flow';
import { ui4aRenderCatalog } from '@/render/canvas/word-catalog';
import { CATALOG_ID, catalogUrl } from '@/render/registry';
import type { DerefWarning } from '@/render/deref';
import {
  hydratePresentationSurface,
  planGenericPresentationSurface,
} from '@/render/presentation/generic';
import { collectionReadQueryResolver } from '@/render/canvas/collection-query';
import { createCanvasActionHandler } from './canvas-action-handler';
import type { PresentationDiagnostic } from './canvas-why-drawer';
import { createSurfaceActionSubmit } from '../actions/action-submit';
import { useEntityCache } from '../entity-cache-provider';
import { execAction, fetchEntity, withPolicyScope } from '../exec-client';
import { useSidecarActions } from './use-sidecar-actions';
import {
  sidecarLoadFailure,
  SURFACE_LOAD_FAILED_PHRASE,
  SidecarLoadFailure,
} from './presentation-sidecar-failure';
import { frozenSpecsOf, withAbort } from './presentation-surface-helpers';
import { notifyThreadUpdated } from './thread-desk-shared';

/** 渲染中的 surface 条目(surface 模型进 state:渲染只读 state,不读 ref)。 */
export interface SurfaceEntry {
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
  /**
   * T38 FR5:集合读面查询的规范串(offset + filter.*,URL 声明)。在场的
   * focus 取数携带同一参数(人机同门,与声明 next/prev/self 链接同参语义),
   * 实体缓存按参数隔离;仅作用于单 focus 的 generic 面,sidecar/多根/规格
   * 路径零机制介入。
   */
  collectionQuery?: string;
}

const CANVAS_LOAD_TIMEOUT_MS = 15_000;

// T32 Q5(D47 第 5 问口径):载入失败首屏只显示固定人话,零机制标识
// (URL/HTTP 状态/sidecar id 不上首屏);结构化细节作为诊断进 why 抽屉。
// T33/D51 denied/unknown 分流的短语、错误类型与解析单点在
// ./presentation-sidecar-failure(B4),本 hook 只消费。
const CANVAS_LOAD_FAILED_PHRASE = '画布内容暂时无法载入，请稍后重试';

/** 载入编排:一次 load 完成目录/spec/sidecar 前置协商到 surfaces 落 state 的全过程。 */
export function usePresentationSurfaceLoad(parameters: PresentationSurfaceParameters) {
  const cache = useEntityCache();
  const concernParam = parameters.concern;
  const focusParam = parameters.focus;
  const rootsParam = parameters.roots;
  const scopeParam = parameters.scope;
  const sidecarParam = parameters.sidecar;
  const focusRefreshParam = parameters.refresh;
  const collectionQueryParam = parameters.collectionQuery;
  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  // T35 F-02:主 focus 解析失败(404)的结构化空态——中性措辞(D51 存在性隐藏)
  // + 恢复出口;实体名等机制细节只进 why 抽屉。
  const [focusUnavailable, setFocusUnavailable] = useState(false);
  const [loadIssues, setLoadIssues] = useState<PresentationDiagnostic[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
        cache.invalidateAfterExec(input.rel, result.entity, result.subject);
        // §十:广播合同执行(书桌等轨上组件据此放弃本地快照重读);detail=实际
        // 执行的 rel,线面消费方自行过滤。
        notifyThreadUpdated(input.rel);
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
      const sitemap = (await sitemapResponse.json()) as {
        version?: unknown;
        surfaces?: unknown;
      };
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
      // T35 F-31:sidecar 活跃版本(surfaces 的 SDK store 身份烙版用)。
      let resolvedSidecarVersion = 0;
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
          // T35 F-31:sidecar 是会话内可变面(重规划 bump 版本)——禁 HTTP 缓存,
          // 否则 in-place reload 拿到旧树(批准退场卡残留实测根因)。
          { signal: controller.signal, cache: 'no-store' },
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
        // T35 F-31:活跃版本入 scope——根身份与 surfaceId 都烙版(见 planned 段):
        // A2UI SDK 的组件状态按面身份存活,版本更替(重规划)必须换店,否则同身份
        // 增量消息不回收被移除节点(批准退场卡残留实测)。分隔符用 '-v'(原 id 不含
        // 该尾缀);根改名先于 hydrate,树内编译引用一致;视图里的旧根 id 重映射。
        if (typeof body.sidecar.version === 'number') {
          resolvedSidecarVersion = body.sidecar.version;
        }
        const originalRootId = sidecarSurface.root.id;
        const versionedRootId = `${originalRootId}-v${resolvedSidecarVersion}`;
        sidecarSurface.root.id = versionedRootId;
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
            rootNodeId: versionedRootId,
            view: {
              collapsedNodeIds: Array.isArray(body.sidecar.view?.collapsedNodeIds)
                ? body.sidecar.view.collapsedNodeIds
                    .filter((value): value is string => typeof value === 'string')
                    .map((value) => (value === originalRootId ? versionedRootId : value))
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
          // T38 Phase C:集合区域初始读携带声明读面参数(repeat 来源 ∧ sitemap
          // collection 面 → offset=0,服务端定页大小;URL 参数只作用于注视集合
          // 且优先;实体区域与平台视图零参数)。
          const readQueryOf = collectionReadQueryResolver({
            focus: requestedFocus,
            surface: sidecarSurface,
            sitemapSurfaces: sitemap.surfaces,
            urlQuery: collectionQueryParam,
            // 组合面(subject 是 workspace,无 focus):URL 读面参数就地作用于
            // 可分页集合区域——翻页/过滤不离开组合语境(Phase C 实测缺陷修)。
            applyUrlToPageable: true,
          });
          const roots: SirenEntity[] = [];
          for (const rel of hydrationRels) {
            const entity = await withAbort(cache.get(rel, readQueryOf(rel)), controller.signal);
            if (entity === null) throw new Error(`实体 "${rel}" 不存在`);
            roots.push(entity);
          }
          const focusEntity = roots.find((entity) => entity.properties.rel === requestedFocus);
          if (focusEntity !== undefined) setFocusEntity(focusEntity);
          // T37:依赖请求 rel 与根一一对应,供 hydrate 为 flow 别名实体补键。
          const plan = hydratePresentationSurface(
            requestedFocus,
            sidecarSurface,
            roots,
            hydrationRels,
          );
          // T35 F-31:surfaceId 烙 sidecar 版本——SDK store 按 surfaceId 增量
          // upsert 组件、不回收移除节点;版本更替(重规划)落新 store,整树重建。
          // 消息体的 surfaceId 在 createSurface/updateDataModel/updateComponents
          // 载荷内,逐载荷重写。
          const versionedSurfaceId = `${plan.bundle.surfaceId}-v${resolvedSidecarVersion}`;
          const baseSurfaceId = plan.bundle.surfaceId;
          plan.bundle.surfaceId = versionedSurfaceId;
          for (const message of plan.bundle.messages) {
            for (const payload of Object.values(message)) {
              if (
                payload !== null &&
                typeof payload === 'object' &&
                (payload as { surfaceId?: unknown }).surfaceId === baseSurfaceId
              ) {
                (payload as { surfaceId: string }).surfaceId = versionedSurfaceId;
              }
            }
          }
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
        // T38:读面参数只跟单 focus 视图(roots 多根视图是上一代机械,不混用);
        // generic 兜底按 sitemap collection 声明给集合 focus 初始游标 offset=0。
        const readQueryOf = collectionReadQueryResolver({
          focus: requestedFocuses[0],
          sitemapSurfaces: sitemap.surfaces,
          urlQuery: collectionQueryParam,
        });
        for (const requestedFocus of requestedFocuses) {
          try {
            const readQuery = rootsParam === undefined ? readQueryOf(requestedFocus) : undefined;
            const entity = await withAbort(cache.get(requestedFocus, readQuery), controller.signal);
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
    collectionQueryParam,
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

  return {
    surfaces,
    errors,
    focusUnavailable,
    loadIssues,
    notice,
    loading,
    catalogId,
    focusEntity,
    sidecarMeta,
    promotionPending,
    setPromotionPending,
    explanation,
    mutateSidecar,
    patchSidecar,
    explainSidecar,
    promoteSidecar,
    load,
    surfaceSubmit,
  };
}
