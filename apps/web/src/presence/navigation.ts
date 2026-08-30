import type { RenderSubject } from '@ui4a/shared';

export type LocationQueryChanges = Readonly<Record<string, string | null>>;

export interface CrossSiteFlowBridge {
  label: '在 meta 中编辑此定义' | '查看活实例';
  href: string;
}

const FLOW_PREFIX = 'flow:';
const META_FLOW_PREFIX = 'meta/flow:';

function relativeLocation(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function nonEmptySuffix(value: string, prefix: string): string | null {
  if (!value.startsWith(prefix)) return null;
  const suffix = value.slice(prefix.length);
  return suffix.trim() === '' ? null : suffix;
}

function optionalDeclaration(url: URL, key: 'scope' | 'thread'): string | null {
  const value = url.searchParams.get(key);
  return value === null || value === '' ? null : value;
}

function appendSituationDeclarations(params: URLSearchParams, source: URL): void {
  for (const key of ['scope', 'thread'] as const) {
    const value = optionalDeclaration(source, key);
    if (value !== null) params.set(key, value);
  }
  const returnTo = source.searchParams.get('returnTo');
  if (returnTo !== null && safeRelativeReturnTo(returnTo)) params.set('returnTo', returnTo);
}

function safeRelativeReturnTo(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  try {
    return new URL(value, 'http://ui4a.local').origin === 'http://ui4a.local';
  } catch {
    return false;
  }
}

function workstationFlowBridge(source: URL, name: string): CrossSiteFlowBridge {
  const params = new URLSearchParams({ rel: `${META_FLOW_PREFIX}${name}` });
  appendSituationDeclarations(params, source);
  return {
    label: '在 meta 中编辑此定义',
    href: `/meta/entity?${params.toString()}`,
  };
}

function metaFlowBridge(source: URL, name: string): CrossSiteFlowBridge {
  const params = new URLSearchParams({ focus: `${FLOW_PREFIX}${name}` });
  appendSituationDeclarations(params, source);
  return { label: '查看活实例', href: `/canvas?${params.toString()}` };
}

/**
 * Build the two flow-definition bridges from canonical URL/rel naming only.
 * This deliberately performs no entity lookup or instance-count resolution.
 */
export function crossSiteFlowBridge(
  route: string,
  focus: RenderSubject | null,
): CrossSiteFlowBridge | null {
  const source = new URL(route, 'http://ui4a.local');
  if (source.pathname === '/meta/entity') {
    const routeRel = source.searchParams.get('rel');
    const routeName = routeRel === null ? null : nonEmptySuffix(routeRel, META_FLOW_PREFIX);
    if (routeName !== null) return metaFlowBridge(source, routeName);
  }

  if (typeof focus !== 'string') return null;
  const metaName = nonEmptySuffix(focus, META_FLOW_PREFIX);
  if (source.pathname === '/meta/entity' && metaName !== null) {
    return metaFlowBridge(source, metaName);
  }

  const onMetaSite = source.pathname === '/meta' || source.pathname.startsWith('/meta/');
  const workstationName = onMetaSite ? null : nonEmptySuffix(focus, FLOW_PREFIX);
  return workstationName === null ? null : workstationFlowBridge(source, workstationName);
}

/** Change only named URL declarations and preserve all unrelated query fields. */
export function locationHrefWithChanges(route: string, changes: LocationQueryChanges): string {
  const url = new URL(route, 'http://ui4a.local');
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return relativeLocation(url);
}

function threadIdForTarget(rel: string): string | null {
  if (!rel.startsWith('thread:')) return null;
  const threadId = rel.slice('thread:'.length);
  return threadId === '' ? null : threadId;
}

/** A thread entity target also declares that thread in the destination URL. */
export function withThreadTarget(href: string, rel: string): string {
  const threadId = threadIdForTarget(rel);
  return threadId === null ? href : locationHrefWithChanges(href, { thread: threadId });
}

/** Renderer page destination derived only from canonical rel naming. */
export function entityPageHref(rel: string, scope?: string): string {
  const page = rel.startsWith('meta/') || rel.startsWith('draft:') ? '/meta/entity' : '/entity';
  const href = `${page}?rel=${encodeURIComponent(rel)}${
    scope === undefined ? '' : `&scope=${encodeURIComponent(scope)}`
  }`;
  return withThreadTarget(href, rel);
}

/** Presentation member destination with the same generic thread-target rule. */
export function canvasEntityHref(rel: string): string {
  return withThreadTarget(`/canvas?focus=${encodeURIComponent(rel)}`, rel);
}

/** Focus one cited rel while carrying only explicit scope/thread declarations. */
export function citationCanvasHref(route: string, rel: string): string {
  const source = new URL(route, 'http://ui4a.local');
  const params = new URLSearchParams({ focus: rel });
  appendSituationDeclarations(params, source);
  return withThreadTarget(`/canvas?${params.toString()}`, rel);
}
