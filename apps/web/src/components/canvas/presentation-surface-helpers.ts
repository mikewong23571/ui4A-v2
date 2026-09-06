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

/**
 * 本线语境的画布合同导航出参(T56 P3.1 修复 F-P2.3-1,E-P2.3):
 * thread=T 页面里的 surface 成员卡/实体链接落点补 `thread=` 声明,使落点页
 * 常显「返回本线」(US07/FR7)。D78:投影 link 保持合同原样,导航上下文由
 * 客户端链接构建层负责——纯函数只认 /canvas 渲染器落点;已声明 thread、
 * 非 /canvas 路径、跨源链接诚实返回 null(零改写)。
 */
export function hrefWithThreadContext(href: string, threadId: string): string | null {
  if (threadId === '') return null;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname !== '/canvas') return null;
  const declared = url.searchParams.get('thread');
  if (declared !== null && declared !== '') return null;
  url.searchParams.set('thread', threadId);
  return `${url.pathname}${url.search}${url.hash}`;
}
