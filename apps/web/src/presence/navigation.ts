export type LocationQueryChanges = Readonly<Record<string, string | null>>;

function relativeLocation(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
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
