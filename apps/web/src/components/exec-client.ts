/**
 * renderer 的合同客户端(T2 Phase F):/api/entity 读 + /api/exec 写。
 *
 * 人类路径与 agent 走同一 HTTP 合同、同一日志,仅身份不同(spec FR8):
 * 固定 actor=human、principal=local-user、channel=renderer(无登录,T2 口径)。
 * 拒绝(4xx + layer/reason/detail)如实上抛——"失败也是合同的一部分"。
 */
import type { SirenEntity } from '@ui4a/engine';

/** 人类执行者的固定身份(与 e2e 断言的日志口径一致)。 */
export const HUMAN_CHANNEL = {
  actor: 'human',
  principal: 'local-user',
  channel: 'renderer',
} as const;

export type ExecClientResult =
  | { ok: true; entity: SirenEntity }
  | { ok: false; status: number; layer: string; reason: string; detail?: unknown };

function contractPrefix(rel: string): '' | '/_meta' {
  return rel.startsWith('meta/') || rel.startsWith('draft:') ? '/_meta' : '';
}

/** 提交一个已声明动作；meta rel 留在定义合同站，业务 rel 留在业务站。 */
export async function execAction(input: {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
  scope?: string;
}): Promise<ExecClientResult> {
  let response: Response;
  try {
    const params =
      input.params !== undefined && Object.keys(input.params).length > 0
        ? { params: input.params }
        : {};
    response = await fetch(
      `${contractPrefix(input.rel)}/api/exec${
        input.scope === undefined ? '' : `?scope=${encodeURIComponent(input.scope)}`
      }`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rel: input.rel, action: input.action, ...params, ...HUMAN_CHANNEL }),
      },
    );
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

/** GET 合同实体；meta rel 留在定义合同站。404 → null，其余非 200 → 抛错。 */
export async function fetchEntity(
  rel: string,
  signal?: AbortSignal,
  scope?: string,
): Promise<SirenEntity | null> {
  const endpoint = `${contractPrefix(rel)}/api/entity?rel=${encodeURIComponent(rel)}${
    scope === undefined ? '' : `&scope=${encodeURIComponent(scope)}`
  }`;
  const response = await fetch(endpoint, { signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET ${endpoint} → HTTP ${response.status}`);
  }
  return (await response.json()) as SirenEntity;
}
