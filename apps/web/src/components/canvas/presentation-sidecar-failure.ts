/**
 * T33 Phase B(B4/D51):sidecar GET 失败的诚实分支——denied(403 结构化)
 * 与 unknown(404 存在性隐藏)各自的首屏人话和 why 抽屉诊断在此单点定义,
 * 避免主宿主组件承载协议解析。[data-testid] 契约不变。
 */
import { PRESENTATION_SIDECAR_DENIED } from '@ui4a/shared';

import type { PresentationDiagnostic } from '../canvas-why-drawer';

/** T32 Q5 口径延续:denied 用「部分内容」级人话,机制细节只进抽屉。 */
export const SURFACE_LOAD_FAILED_PHRASE = '部分内容暂时无法显示，详情见「为什么这样展示」';

/** D51 存在性隐藏口径:不区分「不存在」与「不可见」,首屏零机制标识。 */
export const SIDECAR_UNAVAILABLE_PHRASE = '内容不存在或不可见';

/** 携带首屏人话与抽屉诊断的 sidecar 取数失败;AbortError 不走此类型。 */
export class SidecarLoadFailure extends Error {
  constructor(
    readonly userPhrase: string,
    readonly diagnostic: PresentationDiagnostic,
  ) {
    super(diagnostic.message);
  }
}

/** 识别 /api/presentation/sidecar 的结构化 denied body;返回 reasonCode 数据。 */
function structuredDenial(status: number, body: unknown): string | undefined {
  if (status !== 403 || body === null || typeof body !== 'object') return undefined;
  const error = (body as { error?: unknown }).error;
  if (
    error === null ||
    typeof error !== 'object' ||
    (error as { code?: unknown }).code !== PRESENTATION_SIDECAR_DENIED
  ) {
    return undefined;
  }
  const detail = (error as { detail?: unknown }).detail;
  return typeof detail === 'string' && detail !== '' ? detail : 'unknown-reason';
}

/** 非 200 响应到诚实失败实例的单点映射;未覆盖状态返回 undefined(走通用口径)。 */
export function sidecarLoadFailure(
  status: number,
  body: unknown,
  sidecarId: string,
): SidecarLoadFailure | undefined {
  const denial = structuredDenial(status, body);
  if (denial !== undefined) {
    return new SidecarLoadFailure(SURFACE_LOAD_FAILED_PHRASE, {
      code: PRESENTATION_SIDECAR_DENIED,
      nodeId: sidecarId,
      path: '/canvas',
      message: `sidecar-denied · reasonCode=${denial}`,
    });
  }
  if (status === 404) {
    return new SidecarLoadFailure(SIDECAR_UNAVAILABLE_PHRASE, {
      code: 'sidecar-unknown',
      nodeId: sidecarId,
      path: '/canvas',
      message: `Sidecar ${sidecarId} → HTTP 404`,
    });
  }
  return undefined;
}
