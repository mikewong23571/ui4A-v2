'use client';
/**
 * 「为什么这样展示」抽屉(T24 Phase A Task 3):机制信息与 Sidecar 生命
 * 周期操作的收口。canvas 主区域只保留语义呈现;以下信息只在本抽屉出现
 * (机制词表允许且仅允许出现在这里,见 lib/mechanism-words):
 * a. surface 与目录信息(当前渲染的 surface ID 列表 + 目录协商结果);
 * b. Sidecar 元数据与生命周期——复用(嵌入)CanvasSidecarToolbar,同一
 *    组件、同一回调(useSidecarActions 的返回经 canvas-body 平铺传入,
 *    能力零删减);元信息「个人呈现 · v…」由工具条自带的首个 span 呈现;
 * c. Provenance 解释——「解释这次呈现」调用 explainSidecar,结果
 *    (provenance kind/ref、依赖数)结构化展示在抽屉内(notify 告示现状
 *    由画布告示条保留);
 * d. Presentation diagnostics——首屏只保留人话状态;code/node/message
 *    在这里审计。region-unavailable 仅披露声明 region 与固定状态/code。
 *
 * 自持开合状态;关闭即卸载(零机制词泄漏,首屏口径可断言)。全部区块
 * 来自 props 数据,零硬编码页面内容、零每应用/每实体分支。
 */
import { useState } from 'react';

import { CanvasSidecarToolbar } from './canvas-sidecar-toolbar';
import { Button } from '../ui/button';
import type { SidecarExplanation, SidecarMeta } from './use-sidecar-actions';

const PANEL_ID = 'canvas-why-drawer-panel';

interface CanvasWhyDrawerProps {
  /** 当前渲染中的 surface ID(canvas 主区域不再展示;抽屉内如实列出)。 */
  surfaceIds: readonly string[];
  /** 目录协商结果(与本地词汇表同源才到达渲染;未协商时 undefined)。 */
  catalogId: string | undefined;
  /** Compiler/validator issues. Raw contracts use the sibling verification lens. */
  diagnostics: readonly PresentationDiagnostic[];
  /** Sidecar 元信息(useSidecarActions 状态;无 Sidecar 时 undefined)。 */
  sidecarMeta: SidecarMeta | undefined;
  /** promote 预览后的确认态(嵌入控制条按条件渲染确认/取消)。 */
  promotionPending: boolean;
  /** explain 的结构化结果(useSidecarActions 状态;未解释时 undefined)。 */
  explanation: SidecarExplanation | undefined;
  /** 以下回调与主区域控制条同源(useSidecarActions 返回,平铺传入)。 */
  mutateSidecar: (action: 'pin' | 'revert') => Promise<void>;
  patchSidecar: (kind: 'collapse' | 'density') => Promise<void>;
  explainSidecar: () => Promise<void>;
  promoteSidecar: (confirm: boolean) => Promise<void>;
  cancelPromotion: () => void;
}

export interface PresentationDiagnostic {
  code: string;
  nodeId: string;
  path: string;
  message: string;
  region?: string;
}

export function CanvasWhyDrawer({
  surfaceIds,
  catalogId,
  diagnostics,
  sidecarMeta,
  promotionPending,
  explanation,
  mutateSidecar,
  patchSidecar,
  explainSidecar,
  promoteSidecar,
  cancelPromotion,
}: CanvasWhyDrawerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-nav="local:canvas-why"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((current) => !current)}
      >
        为什么这样展示
      </Button>
      {open && (
        <aside
          id={PANEL_ID}
          aria-label="为什么这样展示"
          data-testid="canvas-why-drawer"
          className="mt-3 space-y-4 rounded-md border bg-muted/20 p-4 text-xs text-muted-foreground"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">为什么这样展示</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </div>
          <section aria-label="surface 与目录">
            <h3 className="mb-1 font-medium text-foreground">Surface 与目录</h3>
            <p data-testid="canvas-why-catalog">目录协商:{catalogId ?? '未协商'}</p>
            {surfaceIds.length === 0 ? (
              <p>当前没有渲染中的 surface。</p>
            ) : (
              <ul data-testid="canvas-why-surfaces" className="list-disc pl-4">
                {surfaceIds.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="sidecar 个人呈现">
            <h3 className="mb-1 font-medium text-foreground">Sidecar 个人呈现</h3>
            {sidecarMeta === undefined ? (
              <p>当前没有 Sidecar 个人呈现。</p>
            ) : (
              <CanvasSidecarToolbar
                sidecarMeta={sidecarMeta}
                promotionPending={promotionPending}
                mutateSidecar={mutateSidecar}
                patchSidecar={patchSidecar}
                explainSidecar={explainSidecar}
                promoteSidecar={promoteSidecar}
                cancelPromotion={cancelPromotion}
              />
            )}
          </section>
          <section aria-label="呈现来源">
            <h3 className="mb-1 font-medium text-foreground">呈现来源</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="canvas-why-explain"
              disabled={sidecarMeta === undefined}
              onClick={() => void explainSidecar()}
            >
              解释这次呈现
            </Button>
            {explanation !== undefined && (
              <div data-testid="canvas-why-explanation" className="mt-2 space-y-2">
                <ul className="space-y-1">
                  <li>
                    来源类型:
                    <code data-testid="canvas-why-provenance-kind">
                      {explanation.provenance.kind}
                    </code>
                  </li>
                  <li>
                    来源引用:
                    <code data-testid="canvas-why-provenance-ref">
                      {explanation.provenance.ref}
                    </code>
                  </li>
                  <li>
                    依赖:
                    <span data-testid="canvas-why-dependency-count">
                      {explanation.dependencyCount} 项
                    </span>
                  </li>
                </ul>
                {explanation.composition !== undefined && (
                  <section aria-label="组合声明" className="space-y-1">
                    <p data-testid="canvas-why-composition-declaration">
                      组合声明 {explanation.composition.id} · v{explanation.composition.version}
                    </p>
                    <p data-testid="canvas-why-composition-provenance">
                      声明来源:
                      <code>{explanation.composition.declarationProvenance.ref}</code>
                    </p>
                    <ol data-testid="canvas-why-composition-regions" className="list-decimal pl-4">
                      {explanation.composition.regions.map((region) => (
                        <li key={region.region}>
                          {region.region} ·{region.availability === 'available' ? '可用' : '不可用'}
                          {region.diagnosticCode === undefined ? '' : ` · ${region.diagnosticCode}`}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </div>
            )}
          </section>
          {diagnostics.length > 0 && (
            <section aria-label="呈现诊断">
              <h3 className="mb-1 font-medium text-foreground">呈现诊断</h3>
              <ul data-testid="canvas-why-diagnostics" className="space-y-1">
                {diagnostics.map((diagnostic) => (
                  <li
                    key={`${diagnostic.code}:${diagnostic.nodeId}:${diagnostic.path}:${diagnostic.region ?? ''}`}
                  >
                    {diagnostic.code === 'region-unavailable'
                      ? `${diagnostic.region ?? '未命名区域'} · 不可用 · region-unavailable`
                      : `${diagnostic.code} · ${diagnostic.nodeId}: ${diagnostic.message}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      )}
    </div>
  );
}
