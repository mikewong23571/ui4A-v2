'use client';
/**
 * 舞台动作组:线被注视时呈现生命周期操作。
 *
 * - 推进/危险分组由 ActionGroup 按合同 requires-confirmation 通用分层(§十:
 *   不可逆操作不与普通操作同级);
 * - 书桌覆盖的材料操作(attach/detach,经「＋选择器」与条目 hover 移出供项)
 *   不在舞台重复渲染表单形态——D47.4 不破:同一合同动作在本工作台内仍可达;
 * - exec 成功 → 页面缓存精确失效 + 广播线程更新事件(书桌据此重读)。
 */
import { useCallback, useEffect, useState } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { ActionGroup } from '../actions/action-group';
import type { ActionSubmit, ActionSubmitInput } from '../actions/action-submit';
import { useEntityCache } from '../entity-cache-provider';
import { execAction } from '../exec-client';
import {
  THREAD_UPDATED_EVENT,
  notifyThreadUpdated,
  type ThreadDeskProps,
} from './thread-desk-shared';

/** 书桌已用更优供项覆盖的材料操作;舞台不再重复其表单形态。 */
export const DESK_COVERED_ACTIONS: ReadonlySet<string> = new Set(['attach', 'detach']);

export function ThreadStageActions({ threadId, scope }: ThreadDeskProps) {
  const cache = useEntityCache();
  const threadRel = `thread:${threadId}`;
  const [thread, setThread] = useState<SirenEntity | null>(null);

  const reload = useCallback(async () => {
    const entity = await cache.get(threadRel).catch(() => null);
    setThread(entity);
  }, [cache, threadRel]);

  // 挂载首读:setState 置于 then 回调(effect 体内不直呼含 setState 的函数);
  // reload 供线程更新事件回调使用。
  useEffect(() => {
    let cancelled = false;
    cache
      .get(threadRel)
      .then((entity) => {
        if (!cancelled) setThread(entity);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cache, threadRel]);

  useEffect(() => {
    const sync = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === threadRel) void reload();
    };
    window.addEventListener(THREAD_UPDATED_EVENT, sync);
    return () => window.removeEventListener(THREAD_UPDATED_EVENT, sync);
  }, [threadRel, reload]);

  const submit = useCallback<ActionSubmit>(
    async ({ rel, action, params }: ActionSubmitInput) => {
      const result = await execAction({ rel, action: action.name, params, scope });
      if (result.ok) {
        cache.invalidateAfterExec(rel, result.entity, result.subject);
        notifyThreadUpdated(rel);
      }
      return result;
    },
    [cache, scope],
  );

  if (thread === null) return null;
  const lifecycle: SirenEntity = {
    ...thread,
    actions: thread.actions.filter((action) => !DESK_COVERED_ACTIONS.has(action.name)),
  };
  if (lifecycle.actions.length === 0) return null;
  return (
    <section
      aria-label="这条线的操作"
      data-testid="stage-thread-actions"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <ActionGroup entity={lifecycle} submit={submit} />
    </section>
  );
}
