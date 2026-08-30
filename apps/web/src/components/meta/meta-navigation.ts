export interface MetaNavigationContext {
  scope?: string;
  thread?: string;
  returnTo?: string;
}

type MetaNavigationSearchParams = Readonly<{
  scope?: string;
  thread?: string;
  returnTo?: string;
}>;

const LOCAL_ORIGIN = 'http://ui4a.local';

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

function safeReturnTo(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) return undefined;
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

/** Parse only the attention and same-origin return fields carried by Meta navigation. */
export function metaNavigationContext(
  params: MetaNavigationSearchParams = {},
): MetaNavigationContext {
  const scope = nonEmpty(params.scope);
  const thread = nonEmpty(params.thread);
  const returnTo = safeReturnTo(params.returnTo);
  return {
    ...(scope === undefined ? {} : { scope }),
    ...(thread === undefined ? {} : { thread }),
    ...(returnTo === undefined ? {} : { returnTo }),
  };
}

/** Append the closed Meta navigation field set to an already-authorized local destination. */
export function withMetaNavigationContext(
  href: string,
  context: MetaNavigationContext,
): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  try {
    const url = new URL(href, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return null;
    const safeContext = metaNavigationContext(context);
    for (const key of ['scope', 'thread', 'returnTo'] as const) {
      const value = safeContext[key];
      if (value === undefined || value.length === 0) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function metaEntityHref(rel: string, context: MetaNavigationContext): string {
  return (
    withMetaNavigationContext(`/meta/entity?rel=${encodeURIComponent(rel)}`, context) ??
    '/meta/entity'
  );
}
