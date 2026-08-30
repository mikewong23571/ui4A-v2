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

  it('keeps local demo unlocated unless it explicitly selects an authorized lens', () => {
    const unlocated = resolveMetaRequestContext({ authorizedScopes: allowed });
    expect(unlocated.effectiveScope).toBeUndefined();
    expect(unlocated.requestedScope).toBeUndefined();

    expect(
      resolveMetaRequestContext({ requestedScope: 'development', authorizedScopes: allowed }),
    ).toEqual(
      expect.objectContaining({
        effectiveScope: 'development',
        requestedScope: 'development',
        authorizedScopes: allowed,
      }),
    );
  });

  it('rejects conflicting header/url lens claims', () => {
    expect(() =>
      resolveMetaRequestContext({
        requestedScope: 'governance',
        headerScope: 'development',
        authorizedScopes: allowed,
      }),
    ).toThrow(/conflicting/i);
  });
});
