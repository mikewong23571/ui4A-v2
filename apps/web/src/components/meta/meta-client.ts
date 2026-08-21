'use client';
/**
 * BIOS(定义平面)的合同客户端(T4 Phase C):读 /_meta/api/entity、写 /_meta/api/exec。
 *
 * 与业务 renderer(exec-client)同一 HTTP 合同形态,仅三点不同:
 * - 端点在 /_meta 站点(canonical API;业务面 sitemap 不携带 _meta 入口,
 *   进入定义层必须显式意图——arch-brief §10 A.7 跨站规则);
 * - 身份 channel=bios(人类经 BIOS 面的显式操作;actor 恒 human——铁律 5
 *   "审批不委托":renderer 只能以人类身份提交,agent 侧 approve 在引擎层被拒);
 * - 渲染零 AI:本模块与使用它的 BIOS 组件不引入任何 AI/LLM 依赖(源级测试断言)。
 */
import type { SirenEntity } from '@ui4a/engine';
import { useEffect, useState } from 'react';

import type { ExecClientResult } from '../exec-client';

/** BIOS 人类操作者的固定身份(actor=human;与 e2e 断言的日志口径一致)。 */
export const BIOS_CHANNEL = {
  actor: 'human',
  principal: 'local-user',
  channel: 'bios',
} as const;

/** 提交一个已声明的 meta 动作(POST /_meta/api/exec);空 params 不上送。 */
export async function execMetaAction(input: {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
}): Promise<ExecClientResult> {
  let response: Response;
  try {
    const params =
      input.params !== undefined && Object.keys(input.params).length > 0
        ? { params: input.params }
        : {};
    response = await fetch('/_meta/api/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: input.rel, action: input.action, ...params, ...BIOS_CHANNEL }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      layer: 'network',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok && body.entity !== undefined) {
    return { ok: true, entity: body.entity as SirenEntity };
  }
  return {
    ok: false,
    status: response.status,
    layer: typeof body.layer === 'string' ? body.layer : `http-${response.status}`,
    reason:
      typeof body.reason === 'string'
        ? body.reason
        : typeof body.error === 'string'
          ? body.error
          : '未知错误',
    ...(body.detail !== undefined ? { detail: body.detail } : {}),
  };
}

/** GET /_meta/api/entity?rel=…;404 → null(实体不存在),其余非 200 → 抛错。 */
export async function fetchMetaEntity(rel: string): Promise<SirenEntity | null> {
  const response = await fetch(`/_meta/api/entity?rel=${encodeURIComponent(rel)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET /_meta/api/entity?rel=${rel} → HTTP ${response.status}`);
  }
  return (await response.json()) as SirenEntity;
}

/**
 * meta 实体取数状态机(BIOS 页主体共用):加载 → ready/missing/error;
 * refresh 在动作 exec 成功后重拉(事件溯源口径:投影总能由日志重算)。
 */
export interface MetaEntityState {
  entity: SirenEntity | null;
  state: 'loading' | 'ready' | 'missing' | 'error';
  refresh: () => void;
}

export function useMetaEntity(rel: string): MetaEntityState {
  const [tick, setTick] = useState(0);
  const [entity, setEntity] = useState<SirenEntity | null>(null);
  const [state, setState] = useState<MetaEntityState['state']>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchMetaEntity(rel);
        if (cancelled) return;
        setEntity(next);
        setState(next === null ? 'missing' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [rel, tick]);

  return { entity, state, refresh: () => setTick((n) => n + 1) };
}
