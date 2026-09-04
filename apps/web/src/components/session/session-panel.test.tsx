// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionPanel } from './session-panel';
import { redirectToLoginOnAuthError } from '@/components/auth-redirect';

vi.mock('@/components/auth-redirect', () => ({ redirectToLoginOnAuthError: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const CREDENTIAL_BODY = {
  authorizationMode: 'credential',
  actor: 'human',
  principal: 'session-subject',
  scopes: ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development', 'ui4a:policy:governance'],
  grantedApplications: ['development', 'governance', 'todo'],
  governanceExpansion: true,
  browserLoginScopes: ['openid', 'ui4a:read', 'ui4a:policy:governance'],
};

function stubSession(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SessionPanel authorization projection surface (D70.2/D70.3)', () => {
  it('renders the credential projection with governance provenance and the refresh action', async () => {
    stubSession(CREDENTIAL_BODY);

    render(<SessionPanel />);

    await waitFor(() => expect(screen.getByText('session-subject')).toBeTruthy());
    expect(screen.getByText(/治理展开/)).toBeTruthy();
    expect(screen.getByText('development')).toBeTruthy();
    expect(screen.getByText('todo')).toBeTruthy();
    const refresh = screen.getByRole('link', { name: '刷新授权' });
    expect(refresh.getAttribute('href')).toBe('/auth/login?returnTo=/session');
    expect(fetchMockedPath()).toBe('/api/auth/session');
  });

  it('renders the local self-reported projection without a refresh action', async () => {
    stubSession({
      authorizationMode: 'self-reported-local-demo',
      actor: 'human',
      principal: 'local-user',
      scopes: ['development', 'todo'],
      grantedApplications: ['development', 'todo'],
      governanceExpansion: false,
    });

    render(<SessionPanel />);

    await waitFor(() => expect(screen.getByText('local-user')).toBeTruthy());
    expect(screen.getByText('本地演示(自报身份)')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '刷新授权' })).toBeNull();
  });

  it('routes authentication failures to the shared login redirect', async () => {
    const body = { error: { code: 'session_not_found' } };
    stubSession(body, 401);

    render(<SessionPanel />);

    await waitFor(() =>
      expect(redirectToLoginOnAuthError).toHaveBeenCalledWith(401, body),
    );
  });

  it('shows a retryable error state instead of an empty projection', async () => {
    stubSession(undefined, 503);

    render(<SessionPanel />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/重试/)).toBeTruthy();
  });
});

function fetchMockedPath(): string {
  const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const input = calls[0]?.[0];
  return typeof input === 'string' ? input : String(input);
}
