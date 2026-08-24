import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executorPath = 'deploy/keycloak/realm-bootstrap.ts';
const entrypointPath = 'scripts/t22-keycloak-realm-bootstrap.ts';
const contractPath = 'deploy/keycloak/realm-contract.json';
const keycloakOrigin = 'https://auth.ui4a.mothership.internal';
const publicOrigin = 'https://ui4a.mothership.internal';
const adminPassword = '__test_only_bootstrap_admin_password__';
const webClientSecret = '__test_only_web_client_secret__';
const agentClientSecret = '__test_only_agent_client_secret__';
const fixturePassword = '__test_only_fixture_user_password__';
const adminToken = '__test_only_admin_access_token__';

interface RealmContract {
  realm: { name: string; enabled: boolean };
  clientScopes: Array<{ name: string; kind: 'permission' | 'policy' }>;
  roles: Array<{ name: string; scopes: string[]; humanApprovalEligible: boolean }>;
  clients: Array<{
    clientId: string;
    clientKind: 'browser' | 'service-account' | 'resource-server';
    confidential: boolean;
    standardFlowEnabled: boolean;
    serviceAccountsEnabled: boolean;
    directAccessGrantsEnabled: boolean;
    pkceCodeChallengeMethod?: string;
    redirectUris?: string[];
    postLogoutRedirectUris?: string[];
    secretRef?: string;
    standardTokenExchangeEnabled?: boolean;
    audiences: string[];
    defaultScopes: string[];
    optionalScopes: string[];
  }>;
  fixtureUsers: Array<{ username: string; role: string; passwordSecretRef: string }>;
}

interface BootstrapResult {
  outcome: 'create' | 'noop' | 'update';
  operations: Array<{
    verb: 'create' | 'update';
    kind: 'realm' | 'client' | 'client-scope' | 'realm-role' | 'user';
    id: string;
    secretRef?: string;
    changedFields?: string[];
  }>;
  summary: string;
}

interface BootstrapModule {
  createKeycloakAdminClient(input: {
    baseUrl: string;
    adminUsername: string;
    adminPassword: string;
    fetch: typeof fetch;
    timeoutMs: number;
  }): unknown;
  reconcileKeycloakRealm(input: {
    admin: unknown;
    contract: RealmContract;
    publicOrigin: string;
    resolveSecret: (reference: string) => string;
    apply?: boolean;
  }): Promise<BootstrapResult>;
}

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
  headers: Headers;
  redirect?: RequestRedirect;
  signal?: AbortSignal | null;
}

interface StoredResource extends Record<string, unknown> {
  id: string;
}

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath))
    throw new Error(`missing T22 Keycloak bootstrap artifact: ${path}`);
  return readFileSync(absolutePath, 'utf8');
}

function contract(): RealmContract {
  return JSON.parse(requiredSource(contractPath)) as RealmContract;
}

async function bootstrapModule(): Promise<BootstrapModule> {
  const absolutePath = resolve(repositoryRoot, executorPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing T22 Keycloak realm bootstrap executor: ${executorPath}`);
  }
  return (await import(pathToFileURL(absolutePath).href)) as BootstrapModule;
}

function secret(reference: string): string {
  const values: Record<string, string> = {
    'oidc-client-secret': webClientSecret,
    'ui4a-agent-client-secret': agentClientSecret,
    'ui4a-experiment-human-password': fixturePassword,
  };
  const value = values[reference];
  if (value === undefined) throw new Error(`test has no Secret for ${reference}`);
  return value;
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  return '';
}

function resourceName(path: string, body: Record<string, unknown>): string {
  if (path.endsWith('/client-scopes')) return String(body.name);
  if (path.endsWith('/roles')) return String(body.name);
  if (path.endsWith('/clients')) return String(body.clientId);
  if (path.endsWith('/users')) return String(body.username);
  return '';
}

class StatefulKeycloakAdmin {
  readonly requests: RecordedRequest[] = [];
  readonly mutations: Array<{ kind: string; id: string; body: string }> = [];
  realm: Record<string, unknown> | undefined;
  clientScopes: StoredResource[] = [];
  roles: StoredResource[] = [];
  clients: StoredResource[] = [];
  users: StoredResource[] = [];
  failMutationNumber: number | undefined;

  readonly fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const body = requestBody(init);
    this.requests.push({
      method,
      url: url.toString(),
      body,
      headers,
      redirect: init?.redirect,
      signal: init?.signal,
    });

    if (url.pathname === '/realms/master/protocol/openid-connect/token') {
      return jsonResponse({ access_token: adminToken, token_type: 'Bearer', expires_in: 60 });
    }
    if (!url.pathname.startsWith('/admin/realms')) return jsonResponse({ error: 'not_found' }, 404);
    if (headers.get('authorization') !== `Bearer ${adminToken}`) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const realmPath = '/admin/realms/ui4a';
    if (method === 'GET' && url.pathname === realmPath) {
      return this.realm === undefined
        ? jsonResponse({ error: 'not_found' }, 404)
        : jsonResponse(this.realm);
    }
    if (method === 'POST' && url.pathname === '/admin/realms') {
      return this.mutate('realm', 'ui4a', body, () => {
        this.realm = JSON.parse(body) as Record<string, unknown>;
      });
    }
    if (method === 'PUT' && url.pathname === realmPath) {
      return this.mutate(
        'realm',
        'ui4a',
        body,
        () => {
          this.realm = JSON.parse(body) as Record<string, unknown>;
        },
        204,
      );
    }

    const collections: Array<[string, StoredResource[]]> = [
      [`${realmPath}/client-scopes`, this.clientScopes],
      [`${realmPath}/roles`, this.roles],
      [`${realmPath}/clients`, this.clients],
      [`${realmPath}/users`, this.users],
    ];
    for (const [path, resources] of collections) {
      if (method === 'GET' && url.pathname === path) {
        const username = url.searchParams.get('username');
        const result =
          username === null ? resources : resources.filter((item) => item.username === username);
        return jsonResponse(result);
      }
      if (method === 'POST' && url.pathname === path) {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const name = resourceName(path, parsed);
        const kind = path.slice(path.lastIndexOf('/') + 1);
        return this.mutate(kind, name, body, () => {
          resources.push({ ...parsed, id: `${kind}-${name}` });
        });
      }
    }

    for (const [path, resources] of collections.slice(0, 3)) {
      if (method === 'PUT' && url.pathname.startsWith(`${path}/`)) {
        const identifier = decodeURIComponent(url.pathname.slice(path.length + 1));
        const index = resources.findIndex(
          (item) =>
            item.id === identifier || item.name === identifier || item.clientId === identifier,
        );
        if (index < 0) return jsonResponse({ error: 'not_found' }, 404);
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const kind = path.slice(path.lastIndexOf('/') + 1);
        return this.mutate(
          kind,
          String(parsed.name ?? parsed.clientId ?? identifier),
          body,
          () => {
            resources[index] = { ...resources[index], ...parsed } as StoredResource;
          },
          204,
        );
      }
    }
    return jsonResponse({ error: 'unexpected_admin_path', path: url.pathname }, 404);
  }) as typeof fetch;

  clearTraffic(): void {
    this.requests.length = 0;
    this.mutations.length = 0;
    this.fetch.mockClear();
  }

  private mutate(
    kind: string,
    id: string,
    body: string,
    apply: () => void,
    status = 201,
  ): Response {
    const mutationNumber = this.mutations.length + 1;
    this.mutations.push({ kind, id, body });
    if (this.failMutationNumber === mutationNumber) {
      return jsonResponse({ error: 'forced_failure', detail: fixturePassword }, 503);
    }
    apply();
    return new Response(null, { status });
  }
}

async function execute(fake: StatefulKeycloakAdmin, apply = true): Promise<BootstrapResult> {
  const module = await bootstrapModule();
  const admin = module.createKeycloakAdminClient({
    baseUrl: keycloakOrigin,
    adminUsername: 'ui4a-bootstrap-admin',
    adminPassword,
    fetch: fake.fetch,
    timeoutMs: 100,
  });
  return module.reconcileKeycloakRealm({
    admin,
    contract: contract(),
    publicOrigin,
    resolveSecret: secret,
    apply,
  });
}

describe('T22 executable Keycloak realm bootstrap', () => {
  it('uses only injected Admin credentials and never discloses credentials in URLs or results', async () => {
    const fake = new StatefulKeycloakAdmin();
    const result = await execute(fake, false);
    const login = fake.requests.find((request) => request.url.includes('/realms/master/'));

    expect(login).toBeDefined();
    expect(login?.method).toBe('POST');
    expect(login?.body).toContain('client_id=admin-cli');
    expect(login?.body).toContain('username=ui4a-bootstrap-admin');
    expect(login?.body).toContain(`password=${encodeURIComponent(adminPassword)}`);
    expect(login?.url).not.toMatch(/password|token|secret/i);
    expect(JSON.stringify(result)).not.toMatch(
      new RegExp(
        [adminPassword, webClientSecret, agentClientSecret, fixturePassword, adminToken].join('|'),
      ),
    );
    expect(fake.mutations).toHaveLength(0);
  });

  it('creates an absent realm in planner order and resolves Secret material only for its Admin request', async () => {
    const fake = new StatefulKeycloakAdmin();
    const input = contract();
    const result = await execute(fake);

    expect(result.outcome).toBe('create');
    expect(fake.mutations.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'realm:ui4a',
      ...input.clientScopes.map((scope) => `client-scopes:${scope.name}`),
      ...input.roles.map((role) => `roles:${role.name}`),
      ...input.clients.map((client) => `clients:${client.clientId}`),
      ...input.fixtureUsers.map((user) => `users:${user.username}`),
    ]);

    const mutationWith = (material: string) =>
      fake.mutations.filter((mutation) => mutation.body.includes(material));
    expect(mutationWith(webClientSecret).map(({ id }) => id)).toEqual(['ui4a-web']);
    expect(mutationWith(agentClientSecret).map(({ id }) => id)).toEqual(['ui4a-agent']);
    expect(mutationWith(fixturePassword).map(({ id }) => id)).toEqual(['ui4a-experiment-human']);
    expect(fake.requests.filter((request) => request.body.includes(adminPassword))).toHaveLength(1);
    expect(fake.requests.every((request) => !request.url.includes(adminPassword))).toBe(true);

    const web = fake.clients.find((client) => client.clientId === 'ui4a-web');
    expect(JSON.stringify(web)).toContain(`${publicOrigin}/api/auth/callback`);
    expect(JSON.stringify(web)).toContain(`${publicOrigin}/`);
    expect(JSON.stringify(web)).not.toContain('{{UI4A_ORIGIN}}');
    expect(JSON.stringify(result)).not.toMatch(/__test_only_|access_token/i);
  });

  it('observes a matching realm as noop and performs no mutation', async () => {
    const fake = new StatefulKeycloakAdmin();
    await execute(fake);
    fake.clearTraffic();

    const result = await execute(fake);

    expect(result).toMatchObject({ outcome: 'noop', operations: [] });
    expect(fake.mutations).toHaveLength(0);
    expect(fake.requests.some((request) => request.url.endsWith('/admin/realms/ui4a'))).toBe(true);
  });

  it('updates only managed client/scope drift and never mutates an existing fixture user', async () => {
    const fake = new StatefulKeycloakAdmin();
    await execute(fake);
    const web = fake.clients.find((client) => client.clientId === 'ui4a-web');
    if (web === undefined) throw new Error('stateful fake is missing ui4a-web');
    web.redirectUris = ['https://drift.invalid/callback'];
    fake.clientScopes = fake.clientScopes.filter((scope) => scope.name !== 'governance');
    const user = fake.users[0];
    if (user === undefined) throw new Error('stateful fake is missing fixture user');
    Object.assign(user, {
      firstName: 'Operator',
      lastName: 'Owned',
      email: 'operator-owned@ui4a.invalid',
      credentials: [{ type: 'password', value: '__operator_owned_password__' }],
      realmRoles: ['operator-owned-role'],
    });
    fake.clearTraffic();

    const result = await execute(fake);

    expect(result.outcome).toBe('update');
    expect(fake.mutations.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'client-scopes:governance',
      'clients:ui4a-web',
    ]);
    expect(fake.mutations.every((mutation) => mutation.kind !== 'users')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Operator|operator-owned|password/i);
  });

  it('is idempotent across two consecutive runs against one stateful Admin API', async () => {
    const fake = new StatefulKeycloakAdmin();

    const first = await execute(fake);
    const firstMutationCount = fake.mutations.length;
    fake.clearTraffic();
    const second = await execute(fake);

    expect(first.outcome).toBe('create');
    expect(firstMutationCount).toBeGreaterThan(0);
    expect(second).toMatchObject({ outcome: 'noop', operations: [] });
    expect(fake.mutations).toHaveLength(0);
  });

  it('stops on partial failure with a stable redacted code and never reports success', async () => {
    const fake = new StatefulKeycloakAdmin();
    fake.failMutationNumber = 2;

    let failure: unknown;
    try {
      await execute(fake);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: 'KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED' });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(fixturePassword);
    expect(JSON.stringify(failure)).not.toMatch(/__test_only_|password|token/i);
    expect(fake.mutations).toHaveLength(2);
  });
});

describe('T22 Keycloak Admin network boundary', () => {
  it('uses same-origin Admin paths, rejects redirects, and attaches a timeout signal', async () => {
    const fake = new StatefulKeycloakAdmin();
    await execute(fake, false);

    expect(fake.requests.length).toBeGreaterThan(1);
    for (const request of fake.requests) {
      expect(new URL(request.url).origin).toBe(keycloakOrigin);
      expect(new URL(request.url).pathname).toMatch(
        /^\/(?:realms\/master\/protocol\/openid-connect\/token|admin\/realms(?:\/|$))/,
      );
      expect(request.redirect).toBe('error');
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('maps timeout, non-success status, and malformed JSON to stable non-secret errors', async () => {
    const module = await bootstrapModule();
    const timeoutFetch = vi.fn(
      (_: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as typeof fetch;
    const timedAdmin = module.createKeycloakAdminClient({
      baseUrl: keycloakOrigin,
      adminUsername: 'ui4a-bootstrap-admin',
      adminPassword,
      fetch: timeoutFetch,
      timeoutMs: 5,
    });
    await expect(
      module.reconcileKeycloakRealm({
        admin: timedAdmin,
        contract: contract(),
        publicOrigin,
        resolveSecret: secret,
        apply: false,
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_BOOTSTRAP_TIMEOUT' });

    const invalidJsonFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: adminToken }))
      .mockResolvedValueOnce(
        new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
      ) as typeof fetch;
    const invalidAdmin = module.createKeycloakAdminClient({
      baseUrl: keycloakOrigin,
      adminUsername: 'ui4a-bootstrap-admin',
      adminPassword,
      fetch: invalidJsonFetch,
      timeoutMs: 100,
    });
    await expect(
      module.reconcileKeycloakRealm({
        admin: invalidAdmin,
        contract: contract(),
        publicOrigin,
        resolveSecret: secret,
        apply: false,
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE' });
  });
});

describe('T22 Keycloak bootstrap executable entrypoint', () => {
  it('loads canonical production configuration and exposes explicit check/apply modes', () => {
    const source = requiredSource(entrypointPath);

    expect(source).toContain('preflightProductionDeploymentFromEnvironment');
    expect(source).toMatch(/settings\.auth\.oidc\.issuer/);
    expect(source).toMatch(/settings\.service\.publicOrigin/);
    expect(source).toMatch(/settings\.keycloak\.bootstrapAdminUser/);
    expect(source).toMatch(/settings\.keycloak\.bootstrapAdminPasswordRef/);
    expect(source).toMatch(/config\.secrets/);
    expect(source).toContain('deploy/keycloak/realm-contract.json');
    expect(source).toContain('--check');
    expect(source).toContain('--apply');
    expect(source).not.toMatch(/__test_only_|adminPassword\s*:\s*['"]|clientSecret\s*:\s*['"]/);
  });
});
