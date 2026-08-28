/**
 * Sidecar 个人呈现工具条(T23 Phase D 自 canvas-body.tsx 拆出):pin/revert、
 * 收起/疏密、explain、设为团队默认(预览→确认)的按钮排。全部经 props 回调
 * 触发 use-sidecar-actions 的 /api/presentation/sidecar 调用,自身零状态。
 */
import { Button } from '../ui/button';
import type { SidecarMeta } from './use-sidecar-actions';

interface CanvasSidecarToolbarProps {
  sidecarMeta: SidecarMeta;
  promotionPending: boolean;
  mutateSidecar: (action: 'pin' | 'revert') => Promise<void>;
  patchSidecar: (kind: 'collapse' | 'density') => Promise<void>;
  explainSidecar: () => Promise<void>;
  promoteSidecar: (confirm: boolean) => Promise<void>;
  cancelPromotion: () => void;
}

export function CanvasSidecarToolbar({
  sidecarMeta,
  promotionPending,
  mutateSidecar,
  patchSidecar,
  explainSidecar,
  promoteSidecar,
  cancelPromotion,
}: CanvasSidecarToolbarProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <span>
        个人呈现 · v{sidecarMeta.version} · {sidecarMeta.retention === 'pinned' ? '已固定' : '缓存'}
      </span>
      {sidecarMeta.retention === 'cache' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-presentation-action="pin-sidecar"
          data-nav="presentation:pin-sidecar"
          onClick={() => void mutateSidecar('pin')}
        >
          以后都这样看
        </Button>
      )}
      {sidecarMeta.version > 1 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-presentation-action="revert-sidecar"
          data-nav="presentation:revert-sidecar"
          onClick={() => void mutateSidecar('revert')}
        >
          恢复上一版本
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={sidecarMeta.view.collapsedNodeIds.includes(sidecarMeta.rootNodeId)}
        data-presentation-action="collapse-sidecar"
        data-nav="presentation:collapse-sidecar"
        onClick={() => void patchSidecar('collapse')}
      >
        {sidecarMeta.view.collapsedNodeIds.includes(sidecarMeta.rootNodeId)
          ? '展开视图'
          : '收起视图'}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-presentation-action="density-sidecar"
        data-nav="presentation:density-sidecar"
        onClick={() => void patchSidecar('density')}
      >
        切换疏密
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-nav="presentation:explain-sidecar"
        onClick={() => void explainSidecar()}
      >
        为什么这样展示
      </Button>
      {!promotionPending ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-nav="presentation:preview-promotion"
          onClick={() => void promoteSidecar(false)}
        >
          设为团队默认
        </Button>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            data-nav="presentation:confirm-promotion"
            onClick={() => void promoteSidecar(true)}
          >
            确认团队默认
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-presentation-action="cancel-promotion"
            data-nav="presentation:cancel-promotion"
            onClick={cancelPromotion}
          >
            取消
          </Button>
        </>
      )}
    </div>
  );
}
