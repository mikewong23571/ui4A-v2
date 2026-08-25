/**
 * 画布动作处理(T23 Phase D 自 canvas-body.tsx 拆出):action 拦截门与页面级
 * 实体缓存之间的接线(T12 Phase B Task 3 / spec 架构决定 3、验收 5)。
 */
import type { ActionGate, CanvasClientAction } from '@/render/canvas/action-gate';

import type { EntityCacheHandle } from './entity-cache-provider';

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
