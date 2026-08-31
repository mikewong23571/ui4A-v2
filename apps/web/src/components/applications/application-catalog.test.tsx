// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applicationEntries, useApplicationCatalog } from './application-catalog';
import { redirectToLoginOnAuthError } from '@/components/auth-redirect';

vi.mock('@/components/auth-redirect', () => ({ redirectToLoginOnAuthError: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('shared application discovery', () => {
  it('rejects malformed envelopes instead of pretending the authorized catalog is empty', () => {
    for (const body of [null, {}, { applications: null }, []]) {
      expect(() => applicationEntries(body)).toThrow();
    }
    expect(applicationEntries({ applications: [] })).toEqual([]);
    expect(applicationEntries({ applications: [null, {}, { name: 'bad' }] })).toEqual([]);
  });

  it('uses credential login handling and never passes attention as an authorization filter', async () => {
    const body = { error: { code: 'credential_expired' } };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(useApplicationCatalog);
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(redirectToLoginOnAuthError).toHaveBeenCalledWith(401, body);
    expect(fetchMock).toHaveBeenCalledWith('/.well-known/ui4a.json');
  });
});
