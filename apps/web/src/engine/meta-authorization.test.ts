import { describe, expect, it } from 'vitest';

import { resolveMetaRequestContext } from './meta-authorization';

const allowed = ['publishing', 'development', 'editorial', 'governance'];

describe('Meta request scope authorization', () => {
  it('uses a requested URL scope only when it is server-authorized', () => {
    expect(
      resolveMetaRequestContext({ requestedScope: 'governance', authorizedScopes: allowed }),
    ).toEqual(expect.objectContaining({ effectiveScope: 'governance', authorizedScopes: allowed }));
  });

  it('rejects a forged or unknown scope instead of widening it', () => {
    expect(() =>
      resolveMetaRequestContext({ requestedScope: 'root-admin', authorizedScopes: allowed }),
    ).toThrow(/not authorized/i);
  });

  it('defaults deterministically and rejects conflicting header/url scope claims', () => {
    expect(resolveMetaRequestContext({ authorizedScopes: allowed }).effectiveScope).toBe(
      'publishing',
    );
    expect(
      resolveMetaRequestContext({ authorizedScopes: allowed, defaultScope: 'development' })
        .effectiveScope,
    ).toBe('development');
    expect(() =>
      resolveMetaRequestContext({
        requestedScope: 'governance',
        headerScope: 'development',
        authorizedScopes: allowed,
      }),
    ).toThrow(/conflicting/i);
  });
});
