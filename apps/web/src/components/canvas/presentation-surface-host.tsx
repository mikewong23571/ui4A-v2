'use client';
/**
 * 共享 Presentation Surface 宿主(T7/T12 Canvas 链路;T27 D46 提炼)。
 *
 * 调用方只提供结构化呈现参数;本组件唯一拥有取数、Sidecar、
 * hydrate、action gate、单树渲染与 why 状态链。调用树必须提供 EntityCacheProvider。
 *
 * T36 A1 拆分:取数/装配编排(目录协商、spec 凝固、sidecar 解析、hydrate、
 * 拦截门装配、取消域)提取为 ./use-presentation-surface-load;本组件保留
 * 装配 + 渲染(钉住控件、why/raw 抽屉、空态与错误面、surface 单树渲染)。
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
 * T24 Phase A Task 4:主区域不渲染机制控制条;T56 D78(P2.2):机制标题与
 * raw/why/reload 收进次要工具入口(./page-tools,最多两步可达)——业务
 * H1 唯一,取授权实体身份/本线目标,由 surface 内容自携;机制细节默认
 * 关闭,零机制词上首屏。审批证据不在工具面板(责任在声明动作区)。
 */
import { A2uiSurface } from '@a2ui/react/v0_9';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { DerefWarning } from '@/render/deref';
import {
  collectionQueryNavigation,
  mergeCollectionReadQueryHref,
} from '@/render/canvas/collection-query';
import {
  CollectionReadNavigationProvider,
  type CollectionReadNavigation,
} from '@/render/canvas/collection-read-navigation';
import { PresentationDensityProvider } from '@/render/presentation-density';
import { ActionSubmitProvider } from '../actions/action-submit';
import { Button } from '../ui/button';
import { readThreadPins, writeThreadPin } from './desk/thread-desk';
import { SurfaceErrorBoundary } from './surface-error-boundary';
import { CanvasPageTools } from './page-tools';
import { SIDECAR_UNAVAILABLE_PHRASE } from './presentation-sidecar-failure';
import { uniqueDiagnostics } from './presentation-surface-helpers';
import {
  usePresentationSurfaceLoad,
  type PresentationSurfaceParameters,
} from './use-presentation-surface-load';

// 注:@a2ui/react 0.10.2 声明的 ./styles/structural.css 在包内缺失(打包缺口);
// basic 原语样式经 useBasicCatalogStyles 运行时注入(adoptedStyleSheets),
// 词条样式走本站 tailwind——无需额外 CSS 引入。

export type { PresentationSurfaceParameters } from './use-presentation-surface-load';

export interface PresentationSurfaceHostProps {
  /** Structured Presentation inputs; no value is inferred from presentation state. */
  parameters: PresentationSurfaceParameters;
}

/** 成员缺字段诊断的人类可读机械投影。 */
function warningText(warning: DerefWarning): string {
  return `${warning.skipped} 条成员因缺字段 ${warning.fieldPath} 未纳入：${warning.members.join(
    '、',
  )}。请补齐该字段后重新载入。`;
}

/** Shared binding-only Presentation host for URL-driven and fixed-subject mounts. */
export function PresentationSurfaceHost({ parameters }: PresentationSurfaceHostProps) {
  const threadParam = parameters.thread;
  const rootsParam = parameters.roots;
  const {
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
  } = usePresentationSurfaceLoad(parameters);
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
  // T38 Phase C 修复 2:宿主注入集合读面导航——翻页/过滤就地合并读面参数
  // (subject 状态保留,组合面语境不再 focus 落点替换单主体面);词条在宿主
  // 外的纯用法仍回退 focus 落点。
  const hostReadNavigate = useCallback<CollectionReadNavigation>((read) => {
    collectionQueryNavigation.assign(mergeCollectionReadQueryHref(window.location.href, read));
  }, []);

  return (
    <CollectionReadNavigationProvider navigate={hostReadNavigate}>
      <div>
        {/* D78/design §1:重新载入/为什么/原始合同收进次要工具入口,默认
          收起;业务标题唯一 H1 由 surface 内容自携,机制标题退场。 */}
        <div className="flex justify-end">
          <CanvasPageTools
            loading={loading}
            onReload={() => void load()}
            rawEntity={focusEntity}
            why={{
              surfaceIds: surfaces.map((entry) => entry.id),
              catalogId,
              diagnostics: uniqueDiagnostics([
                ...surfaces.flatMap((entry) => entry.diagnostics),
                ...loadIssues,
              ]),
              sidecarMeta,
              promotionPending,
              explanation,
              mutateSidecar,
              patchSidecar,
              explainSidecar,
              promoteSidecar,
              cancelPromotion: () => setPromotionPending(false),
            }}
          />
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
        {/* T24/D78:Sidecar 控制条不在主区域;抽屉入口在页面工具面板内
          (能力等价:同一 CanvasSidecarToolbar 嵌在抽屉内)。 */}
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
          className={cn(
            'mt-6 gap-6',
            rootsParam === undefined ? 'space-y-8' : 'grid lg:grid-cols-2',
          )}
        >
          {surfaces.map((entry) => (
            <div
              key={`${entry.generation}:${entry.id}`}
              data-surface={entry.id.replace(/-v\d+$/, '')}
              data-generation={String(entry.generation)}
              data-concern={entry.concern}
              data-surface-embedded="true"
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
                        ? '取消挂进本线'
                        : '挂进本线工作集(左侧书桌可见)'
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
                      ? '📌 已挂进本线'
                      : '📌 挂进本线'}
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
                    <PresentationDensityProvider
                      density={
                        sidecarMeta?.view.densityByNodeId[sidecarMeta.rootNodeId] ?? 'comfortable'
                      }
                    >
                      <A2uiSurface surface={entry.surface} />
                    </PresentationDensityProvider>
                  </ActionSubmitProvider>
                </SurfaceErrorBoundary>
              )}
            </div>
          ))}
        </section>
      </div>
    </CollectionReadNavigationProvider>
  );
}
