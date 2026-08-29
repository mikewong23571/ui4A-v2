import type { SirenEntity } from '@ui4a/engine';

import type { RenderSpec } from '@/render/spec';

import type { PresentationDiagnostic } from './canvas-why-drawer';

/**
 * 把不支持 signal 的缓存/规划 Promise 纳入本轮取消域,旧轮结果不得落 state
 * (自 use-presentation-surface-load 提取,GR3 沿功能边界分担行数)。
 */
export async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Extract frozen render specs from the ordinary Siren collection contract. */
export function frozenSpecsOf(collection: SirenEntity): RenderSpec[] {
  return (collection.entities ?? []).flatMap((member) => {
    const { concern, component, bind } = member.properties;
    if (typeof concern !== 'string' || typeof component !== 'string' || bind === undefined) {
      return [];
    }
    return [{ concern, component, bind: bind as RenderSpec['bind'] }];
  });
}

export function uniqueDiagnostics(
  entries: readonly PresentationDiagnostic[],
): PresentationDiagnostic[] {
  return [
    ...new Map(
      entries.map((entry) => [
        `${entry.code}:${entry.nodeId}:${entry.path}:${entry.message}:${entry.region ?? ''}`,
        entry,
      ]),
    ).values(),
  ];
}
