import type { FetchLike } from '../types';

export interface BoundedBearerFetchOptions {
  origin: string;
  authorizationHeader: string;
  allowedPaths: readonly string[];
  fetch: FetchLike;
}

function configurationError(reason: string): never {
  throw new Error(`bounded bearer fetch configuration invalid: ${reason}`);
}

/**
 * Seals an Agent HTTP client to one HTTPS UI4A origin and an exact path allow-list.
 * Caller headers cannot replace the server-owned credential and redirects never carry it onward.
 */
export function createBoundedBearerFetch(options: BoundedBearerFetchOptions): FetchLike {
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    return configurationError('origin must be an absolute HTTPS origin');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    configurationError('origin must be a credential-free HTTPS origin');
  }
  if (!/^Bearer \S+$/.test(options.authorizationHeader)) {
    configurationError('authorization must be one Bearer credential');
  }
  if (
    !Array.isArray(options.allowedPaths) ||
    options.allowedPaths.length === 0 ||
    options.allowedPaths.some(
      (path) =>
        typeof path !== 'string' ||
        !path.startsWith('/') ||
        path.includes('?') ||
        path.includes('#'),
    ) ||
    new Set(options.allowedPaths).size !== options.allowedPaths.length
  ) {
    configurationError('allowedPaths must contain unique exact absolute paths');
  }

  const allowedPaths = new Set(options.allowedPaths);
  const expectedOrigin = origin.origin;
  const authorizationHeader = options.authorizationHeader;
  const fetchImpl = options.fetch;

  return async (url, init) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new Error('bounded bearer request rejected');
    }
    if (
      target.protocol !== 'https:' ||
      target.username !== '' ||
      target.password !== '' ||
      target.hash !== '' ||
      target.origin !== expectedOrigin ||
      !allowedPaths.has(target.pathname)
    ) {
      throw new Error('bounded bearer request rejected');
    }

    const headers = new Headers(init?.headers);
    headers.set('authorization', authorizationHeader);
    return fetchImpl(target.toString(), {
      ...init,
      headers,
      redirect: 'error',
    });
  };
}
