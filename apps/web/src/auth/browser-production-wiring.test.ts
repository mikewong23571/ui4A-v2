import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserAuthentication } from './browser-session';
import {
  ProductionIdentityError,
  type ProductionCredentialDependencies,
  type ProductionCredentialPolicy,
} from './production-request-identity';

const credentialMocks = vi.hoisted(() => ({
  verify: vi.fn(),
  build: vi.fn(),
}));

vi.mock('./production-request-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./production-request-identity')>();
  return {
    ...actual,
    verifyProductionCredential: credentialMocks.verify,
    buildProductionRequestIdentity: credentialMocks.build,
  };
});

const routeAuthentication = vi.hoisted(() => ({
  beginLogin: vi.fn(),
  completeCallback: vi.fn(),
  resolveSession: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('./production-browser-authentication', () => ({
  getProductionBrowserAuthentication: () => routeAuthentication,
}));

import {
  resolveTrustedRequestIdentity,
  type ResolveRequestIdentityOptions,
} from './request-identity';

const ORIGIN = 'https://ui4a.mothership.internal';
const SESSION_COOKIE = '__Host-ui4a_session';
const verifiedCredential = {
  header: { alg: 'RS256' as const, kid: 'browser-fixture' },
  claims: {
    sub: 'human-alice',
    azp: 'ui4a-web',
    scope: 'ui4a:read ui4a:write ui4a:approve development governance',
    ui4a_policy_scope: ['development', 'governance'],
  },
};

const productionPolicy: ProductionCredentialPolicy = {
  issuer: 'https://auth.ui4a.mothership.internal/realms/ui4a',
  audience: 'ui4a-api',
  algorithms: ['RS256'],
  humanClientIds: ['ui4a-web'],
  agentClientIds: ['ui4a-agent'],
  delegatedScopesByClient: { 'ui4a-agent': ['ui4a:read'] },
};

const productionDependencies: ProductionCredentialDependencies = {
  clock: () => 1_788_739_200_000,
  jwks: {
    load: async () => ({ keys: [], fetchedAtMs: 0, expiresAtMs: 0 }),
  },
};

function identityOptions(
  plane: 'business' | 'meta',
  defaultPolicyScope: string,
  browserAuthentication: Pick<BrowserAuthentication, 'resolveSession'>,
): ResolveRequestIdentityOptions {
  return {
    profile: 'production',
    plane,
    requiredScopes: ['ui4a:read'],
    authorizedPolicyScopes: ['development', 'governance'],
    defaultPolicyScope,
    productionPolicy,
    productionDependencies,
    browserAuthentication,
  } as ResolveRequestIdentityOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  credentialMocks.verify.mockImplementation(async (authorizationHeader: string | null) => {
    if (authorizationHeader === null) throw new ProductionIdentityError('credential_missing');
    if (authorizationHeader !== 'Bearer browser-access-token') {
      throw new ProductionIdentityError('credential_malformed');
    }
    return verifiedCredential;
  });
  credentialMocks.build.mockReturnValue({
    actor: 'human',
    kind: 'human',
    principal: 'human-alice',
    scopes: ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'development', 'governance'],
    humanApprovalEligible: true,
  });
});

describe('production browser Route Handler wiring', () => {
  it.each([
    ['login GET', '../app/auth/login/route', 'GET', 'beginLogin'],
    ['callback GET', '../app/api/auth/callback/route', 'GET', 'completeCallback'],
    ['logout POST', '../app/auth/logout/route', 'POST', 'logout'],
  ] as const)(
    '%s delegates the real request to browser authentication',
    async (_name, path, verb, method) => {
      const expected = new Response(null, { status: 204 });
      routeAuthentication[method].mockResolvedValueOnce(expected);
      const route = (await import(path)) as Record<string, (request: Request) => Promise<Response>>;
      const request = new Request(`${ORIGIN}/${method}`, { method: verb });

      await expect(route[verb]!(request)).resolves.toBe(expected);
      expect(routeAuthentication[method]).toHaveBeenCalledOnce();
      expect(routeAuthentication[method]).toHaveBeenCalledWith(request);
    },
  );
});

describe('production browser credential composition', () => {
  it.each([
    ['business', '/api/entity?rel=applications', 'development'],
    ['meta', '/_meta/api/entity?rel=meta%2Fflows', 'governance'],
  ] as const)(
    'resolves a session-cookie-only %s request through the shared trusted identity adapter',
    async (plane, path, defaultPolicyScope) => {
      const browserAuthentication = {
        resolveSession: vi.fn(async () => ({
          authorizationHeader: 'Bearer browser-access-token',
          expiresAtMs: 1_788_739_500_000,
        })),
      };
      const request = new Request(`${ORIGIN}${path}`, {
        headers: { cookie: `${SESSION_COOKIE}=opaque.mac` },
      });

      const identity = await resolveTrustedRequestIdentity(
        request,
        identityOptions(plane, defaultPolicyScope, browserAuthentication),
      );

      expect(browserAuthentication.resolveSession).toHaveBeenCalledWith(request);
      expect(credentialMocks.verify).toHaveBeenCalledWith(
        'Bearer browser-access-token',
        productionPolicy,
        productionDependencies,
      );
      expect(identity).toMatchObject({
        authorizationMode: 'credential',
        actor: 'human',
        principal: 'human-alice',
        policyScope: defaultPolicyScope,
        channel: 'oidc',
        humanApprovalEligible: true,
      });
    },
  );

  it('uses a lone Authorization credential without consulting browser session state', async () => {
    const browserAuthentication = { resolveSession: vi.fn() };
    const request = new Request(`${ORIGIN}/api/entity?rel=applications`, {
      headers: { authorization: 'Bearer browser-access-token' },
    });

    await expect(
      resolveTrustedRequestIdentity(
        request,
        identityOptions('business', 'development', browserAuthentication),
      ),
    ).resolves.toMatchObject({ principal: 'human-alice', policyScope: 'development' });
    expect(browserAuthentication.resolveSession).not.toHaveBeenCalled();
  });

  it('fails closed instead of choosing between Authorization and a browser session cookie', async () => {
    const browserAuthentication = {
      resolveSession: vi.fn(async () => ({
        authorizationHeader: 'Bearer browser-access-token',
        expiresAtMs: 1_788_739_500_000,
      })),
    };
    const request = new Request(`${ORIGIN}/api/entity?rel=applications`, {
      headers: {
        authorization: 'Bearer browser-access-token',
        cookie: `${SESSION_COOKIE}=opaque.mac`,
      },
    });

    await expect(
      resolveTrustedRequestIdentity(
        request,
        identityOptions('business', 'development', browserAuthentication),
      ),
    ).rejects.toMatchObject({ code: 'credential_source_conflict' });
    expect(browserAuthentication.resolveSession).not.toHaveBeenCalled();
    expect(credentialMocks.verify).not.toHaveBeenCalled();
  });
});
