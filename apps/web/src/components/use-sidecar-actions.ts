/**
 * Sidecar 个人视图操作(T23 Phase D 自 canvas-body.tsx 拆出):pin/revert、
 * 视图 patch(收起/疏密)、explain、promote(团队默认预览/确认)四个
 * /api/presentation/sidecar 调用,与 sidecarMeta/promotionPending 状态同住。
 * 纯接线搬运,请求形状与告示口径不变。
 *
 * T24 Phase A Task 3 最小扩展:explain 成功后把结果(provenance kind/ref、
 * 依赖数)结构化记录进 explanation 状态,供「为什么这样展示」抽屉内结构化
 * 展示;请求形状与 notify 告示行为不变。
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/** 画布侧记录的 Sidecar 元信息(个人呈现横幅与视图操作的状态源)。 */
export interface SidecarMeta {
  id: string;
  version: number;
  retention: 'cache' | 'pinned';
  rootNodeId: string;
  view: {
    collapsedNodeIds: string[];
    densityByNodeId: Record<string, 'compact' | 'comfortable' | 'spacious'>;
  };
}

/** explain 的结构化结果(抽屉内结构化展示;口径见文件头 T24 注)。 */
export interface SidecarExplanation {
  provenance: { kind: string; ref: string };
  dependencyCount: number;
  composition?: {
    id: string;
    version: string;
    regions: Array<{
      region: string;
      availability: 'available' | 'unavailable';
      diagnosticCode?: 'region-unavailable';
    }>;
    declarationProvenance: { kind: 'composition-declaration'; ref: string };
  };
}

export interface SidecarActions {
  sidecarMeta: SidecarMeta | undefined;
  setSidecarMeta: Dispatch<SetStateAction<SidecarMeta | undefined>>;
  promotionPending: boolean;
  setPromotionPending: Dispatch<SetStateAction<boolean>>;
  explanation: SidecarExplanation | undefined;
  mutateSidecar: (action: 'pin' | 'revert') => Promise<void>;
  patchSidecar: (kind: 'collapse' | 'density') => Promise<void>;
  explainSidecar: () => Promise<void>;
  promoteSidecar: (confirm: boolean) => Promise<void>;
}

/**
 * Sidecar 操作集合。reload 为整面重载入口(revert 后重建 surface);
 * notify 为画布告示条(诚实失败:错误如实进告示,不抛)。
 */
export function useSidecarActions(deps: {
  notify: (message: string) => void;
  reload: () => void;
}): SidecarActions {
  const { notify, reload } = deps;
  const [sidecarMeta, setSidecarMeta] = useState<SidecarMeta>();
  const [promotionPending, setPromotionPending] = useState(false);
  const [explanation, setExplanation] = useState<SidecarExplanation>();

  const mutateSidecar = useCallback(
    async (action: 'pin' | 'revert'): Promise<void> => {
      if (sidecarMeta === undefined) return;
      const response = await fetch('/api/presentation/sidecar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sidecarId: sidecarMeta.id,
          action,
          actor: 'human',
          ...(action === 'revert' ? { targetVersion: sidecarMeta.version - 1 } : {}),
        }),
      });
      const body = (await response.json()) as {
        sidecar?: { id: string; version: number; retention: 'cache' | 'pinned' };
        error?: string;
      };
      if (!response.ok || body.sidecar === undefined) {
        notify(`Sidecar ${action} 失败:${body.error ?? `HTTP ${response.status}`}`);
        return;
      }
      setSidecarMeta((current) =>
        current === undefined ? undefined : { ...current, ...body.sidecar },
      );
      notify(
        action === 'pin'
          ? `已保存为个人视图 · v${body.sidecar.version}`
          : `已恢复 Sidecar v${body.sidecar.version}`,
      );
      if (action === 'revert') reload();
    },
    [notify, reload, sidecarMeta],
  );

  const patchSidecar = useCallback(
    async (kind: 'collapse' | 'density'): Promise<void> => {
      if (sidecarMeta === undefined) return;
      const collapsed = sidecarMeta.view.collapsedNodeIds.includes(sidecarMeta.rootNodeId);
      const currentDensity = sidecarMeta.view.densityByNodeId[sidecarMeta.rootNodeId];
      const operations =
        kind === 'collapse'
          ? [{ kind, nodeId: sidecarMeta.rootNodeId, collapsed: !collapsed }]
          : [
              {
                kind,
                nodeId: sidecarMeta.rootNodeId,
                density: currentDensity === 'compact' ? 'spacious' : 'compact',
              },
            ];
      const response = await fetch('/api/presentation/sidecar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sidecarId: sidecarMeta.id,
          action: 'patch',
          actor: 'human',
          interactionId: `canvas:${kind}:${crypto.randomUUID()}`,
          operations,
        }),
      });
      const body = (await response.json()) as {
        sidecar?: SidecarMeta;
        error?: string;
      };
      if (!response.ok || body.sidecar === undefined) {
        notify(`视图调整失败:${body.error ?? `HTTP ${response.status}`}`);
        return;
      }
      setSidecarMeta(body.sidecar);
      notify(`视图已调整 · v${body.sidecar.version} · 可恢复上一版本`);
    },
    [notify, sidecarMeta],
  );

  const explainSidecar = useCallback(async (): Promise<void> => {
    if (sidecarMeta === undefined) return;
    const response = await fetch(
      `/api/presentation/sidecar?sidecarId=${encodeURIComponent(sidecarMeta.id)}&explain=1`,
    );
    const body = (await response.json()) as {
      explanation?: {
        provenance?: { kind?: string; ref?: string };
        dependencyIds?: string[];
        composition?: SidecarExplanation['composition'];
      };
      error?: string;
    };
    if (!response.ok || body.explanation === undefined) {
      notify(`无法解释当前呈现:${body.error ?? `HTTP ${response.status}`}`);
      return;
    }
    // T24:结构化结果进状态(抽屉内结构化展示);下方 notify 告示不变。
    setExplanation({
      provenance: {
        kind: body.explanation.provenance?.kind ?? 'unknown',
        ref: body.explanation.provenance?.ref ?? 'unknown',
      },
      dependencyCount: body.explanation.dependencyIds?.length ?? 0,
      ...(body.explanation.composition === undefined
        ? {}
        : { composition: body.explanation.composition }),
    });
    notify(
      `这样展示是因为 ${body.explanation.provenance?.kind ?? 'unknown'}:${
        body.explanation.provenance?.ref ?? 'unknown'
      }，依赖 ${body.explanation.dependencyIds?.length ?? 0} 项。`,
    );
  }, [notify, sidecarMeta]);

  const promoteSidecar = useCallback(
    async (confirm: boolean): Promise<void> => {
      if (sidecarMeta === undefined) return;
      const response = await fetch('/api/presentation/sidecar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sidecarId: sidecarMeta.id,
          action: confirm ? 'promote' : 'promotion-preview',
          actor: 'human',
        }),
      });
      const body = (await response.json()) as {
        diff?: { fromSidecarVersion?: number };
        recipe?: { id?: string; version?: number };
        error?: string;
      };
      if (!response.ok) {
        notify(`团队默认处理失败:${body.error ?? `HTTP ${response.status}`}`);
        return;
      }
      if (!confirm) {
        setPromotionPending(true);
        notify(`将把个人视图 v${body.diff?.fromSidecarVersion ?? '?'} 参数化为团队默认，请确认。`);
      } else {
        setPromotionPending(false);
        notify(`已设为团队默认 · ${body.recipe?.id ?? 'recipe'} v${body.recipe?.version ?? 1}`);
      }
    },
    [notify, sidecarMeta],
  );

  return {
    sidecarMeta,
    setSidecarMeta,
    promotionPending,
    setPromotionPending,
    explanation,
    mutateSidecar,
    patchSidecar,
    explainSidecar,
    promoteSidecar,
  };
}
