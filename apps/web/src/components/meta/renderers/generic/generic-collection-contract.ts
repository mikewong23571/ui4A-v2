import type { SirenEntity, SirenFieldPresentation, SirenLink } from '@ui4a/engine';

import { asOptionalFilterDeclarations, asOptionalPresentations } from '@/render/words/shared';

import { withMetaNavigationContext, type MetaNavigationContext } from '../meta-navigation';

export interface CollectionSummary {
  returned: number;
  total?: number;
  truncated: boolean;
}

export interface CollectionFacet {
  field: string;
  title: string;
  values: Array<{ value: string; title: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function presentationOf(entity: SirenEntity): Record<string, unknown> | undefined {
  return asRecord(entity.properties.presentation);
}

/** Consume the existing T38 field-presentation wire; malformed hints fail closed. */
export function overviewFieldsOf(entity: SirenEntity): SirenFieldPresentation[] {
  try {
    return asOptionalPresentations(
      presentationOf(entity)?.fields,
      'generic-meta-collection',
      'properties.presentation.fields',
    ).filter((field) => field.overview === true);
  } catch {
    return [];
  }
}

/** Resolve a declared binding path against the embedded Siren member without copying facts. */
export function valueAtPresentationPath(entity: SirenEntity, path: string): unknown {
  let value: unknown = entity;
  for (const segment of path.split('.')) {
    const record = asRecord(value);
    if (record === undefined || !Object.prototype.hasOwnProperty.call(record, segment))
      return undefined;
    value = record[segment];
  }
  return value;
}

/** Facets exist only when the collection publishes the existing T38 filter declaration wire. */
export function collectionFacetsOf(entity: SirenEntity): CollectionFacet[] {
  try {
    return asOptionalFilterDeclarations(
      presentationOf(entity)?.filters,
      'generic-meta-collection',
      'properties.presentation.filters',
    );
  } catch {
    return [];
  }
}

export function collectionSummaryOf(entity: SirenEntity): CollectionSummary {
  const membersReturned = entity.entities?.length ?? 0;
  const truncation = asRecord(entity.properties.truncation);
  const declaredReturned = asCount(entity.properties.returned) ?? asCount(truncation?.returned);
  const total = asCount(entity.properties.total) ?? asCount(truncation?.total);
  const returned = declaredReturned ?? membersReturned;
  const hasNext = entity.links.some((link) => link.rel.includes('next'));
  const explicitlyTruncated = truncation !== undefined;
  return {
    returned,
    ...(total === undefined ? {} : { total }),
    truncated: explicitlyTruncated || hasNext || (total !== undefined && returned < total),
  };
}

/**
 * Convert only an exact same-origin Meta entity contract href. Unknown query parameters are
 * intentionally retained because cursors and future read traits are server-owned opaque values.
 */
export function canonicalMetaEntityHref(
  href: string,
  navigation: MetaNavigationContext = {},
): string | null {
  const params = canonicalMetaEntityParams(href);
  return params === null
    ? null
    : withMetaNavigationContext(`/meta/entity?${params.toString()}`, navigation);
}

function canonicalMetaEntityParams(href: string): URLSearchParams | null {
  if (!href.startsWith('/')) return null;
  const url = new URL(href, 'http://ui4a.local');
  if (url.origin !== 'http://ui4a.local' || url.pathname !== '/_meta/api/entity') return null;
  if (url.searchParams.getAll('rel').length !== 1 || url.searchParams.get('rel') === '')
    return null;
  const params = new URLSearchParams(url.searchParams);
  params.delete('scope');
  params.delete('thread');
  params.delete('returnTo');
  return params;
}

export function collectionPageLinks(
  links: readonly SirenLink[],
  navigation: MetaNavigationContext = {},
): Array<{ rel: 'prev' | 'next'; title: string; href: string }> {
  return links.flatMap((link) => {
    const rel = link.rel.includes('prev') ? 'prev' : link.rel.includes('next') ? 'next' : null;
    if (rel === null) return [];
    const href = canonicalMetaEntityHref(link.href, navigation);
    return href === null ? [] : [{ rel, title: link.title ?? rel, href }];
  });
}

/** Build one declared facet navigation target from the collection self link, without filtering. */
export function collectionFacetHref(
  selfHref: string,
  field: string,
  value: string,
  navigation: MetaNavigationContext = {},
): string | null {
  const params = canonicalMetaEntityParams(selfHref);
  if (params === null) return null;
  const key = `filter.${field}`;
  params.delete(key);
  if (value !== '') params.set(key, value);
  return withMetaNavigationContext(`/meta/entity?${params.toString()}`, navigation);
}

export function collectionFacetValue(selfHref: string, field: string): string {
  const params = canonicalMetaEntityParams(selfHref);
  return params?.get(`filter.${field}`) ?? '';
}
