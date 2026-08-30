export interface MetaSitemapSurface {
  rel: string;
  title: string;
  collection?: boolean;
}

export interface MetaSitemapDocument {
  protocolVersion: string;
  version: string;
  site: 'meta';
  surfaces: MetaSitemapSurface[];
  effectiveScope?: string;
  authorizedScopes: string[];
  authorizationMode: 'self-reported-local-demo' | 'credential';
}

export interface MetaSurfaceDescriptor extends MetaSitemapSurface {
  kind: 'self' | 'collection';
  href: string;
}

/** Canonical human route for a Meta Siren rel. */
export function browserHrefForMetaRel(rel: string, scope?: string): string {
  const query = new URLSearchParams({ rel });
  if (scope !== undefined && scope.length > 0) query.set('scope', scope);
  return `/meta/entity?${query.toString()}`;
}

/** Same-origin Meta API href to rel; external and malformed links fail closed. */
export function relFromMetaApiHref(href: string): string | null {
  if (!href.startsWith('/')) return null;
  const url = new URL(href, 'http://ui4a.local');
  if (url.origin !== 'http://ui4a.local' || url.pathname !== '/_meta/api/entity') return null;
  const rel = url.searchParams.get('rel');
  return rel === null || rel.length === 0 ? null : rel;
}

/** Pure top-level inventory. Exact children stay discoverable through collections and links. */
export function projectMetaSurfaceDescriptors(
  sitemap: MetaSitemapDocument,
): MetaSurfaceDescriptor[] {
  return sitemap.surfaces.flatMap((surface) => {
    const kind = surface.rel === 'meta/self' ? 'self' : surface.collection ? 'collection' : null;
    return kind === null
      ? []
      : [
          {
            ...surface,
            kind,
            href: browserHrefForMetaRel(surface.rel, sitemap.effectiveScope),
          },
        ];
  });
}
