import { beforeEach, describe, expect, it, vi } from 'vitest';

const preflight = vi.hoisted(() => vi.fn());

vi.mock('../../../production-deployment-preflight', () => ({
  runWebProductionDeploymentPreflight: preflight,
}));

describe('GET /auth/account', () => {
  beforeEach(() => {
    preflight.mockReset();
    preflight.mockReturnValue({
      settings: {
        auth: { oidc: { issuer: 'https://auth.ui4a.example/realms/ui4a' } },
      },
    });
  });

  it('redirects to the fixed realm account console without exposing an admin route', async () => {
    const route = await import('./route');
    const response = route.GET();

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://auth.ui4a.example/realms/ui4a/account/');
  });
});
