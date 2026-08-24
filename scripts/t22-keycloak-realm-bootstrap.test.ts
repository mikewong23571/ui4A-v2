import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executorPath = 'deploy/keycloak/realm-bootstrap.ts';
const entrypointPath = 'scripts/t22-keycloak-realm-bootstrap.ts';
const realmImportPath = 'deploy/keycloak/realm-import.json';
const keycloakOrigin = 'https://auth.ui4a.mothership.internal';
const publicOrigin = 'https://ui4a.mothership.internal';
const adminPassword = '__test_only_bootstrap_admin_password__';
const webClientSecret = '__test_only_web_client_secret__';
const agentClientSecret = '__test_only_agent_client_secret__';
const fixturePassword = '__test_only_fixture_user_password__';
const adminToken = '__test_only_admin_access_token__';

interface RealmClientRepresentation extends Record<string, unknown> {
  id?: string;
  clientId: string;
  attributes?: Record<string, string>;
  protocolMappers?: Array<{ config?: Record<string, string> }>;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
}

interface RealmImportRepresentation extends Record<string, unknown> {
  realm: string;
  enabled: boolean;
  attributes?: Record<string, string>;
  clients: RealmClientRepresentation[];
}

interface BootstrapResult {
  outcome: 'imported' | 'skip' | 'absent';
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
  bootstrapKeycloakRealm(input: {
    admin: unknown;
    realmImport: RealmImportRepresentation;
    publicOrigin: string;
    resolveSecret: (reference: string) => string;
    mode: 'check' | 'apply';
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

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing T22 Keycloak bootstrap artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

function realmImport(): RealmImportRepresentation {
  return JSON.parse(requiredSource(realmImportPath)) as RealmImportRepresentation;
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  return '';
}

class ImportOrSkipKeycloakAdmin {
  readonly requests: RecordedRequest[] = [];
  readonly mutations: Array<{ path: string; body: string }> = [];
  realm: Record<string, unknown> | undefined;
  clients: RealmClientRepresentation[] = [];
  failImport = false;

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

    if (method === 'GET' && url.pathname === '/admin/realms/ui4a') {
      return this.realm === undefined
        ? jsonResponse({ error: 'not_found' }, 404)
        : jsonResponse(this.realm);
    }
    if (method === 'GET' && url.pathname === '/admin/realms/ui4a/clients') {
      const requested = url.searchParams.get('clientId');
      const clients =
        requested === null
          ? this.clients
          : this.clients.filter((candidate) => candidate.clientId === requested);
      return jsonResponse(clients);
    }
    if (method === 'POST' && url.pathname === '/admin/realms') {
      this.mutations.push({ path: url.pathname, body });
      if (this.failImport) {
        return jsonResponse({ error: 'forced_failure', detail: webClientSecret }, 503);
      }
      const imported = JSON.parse(body) as RealmImportRepresentation;
      this.realm = {
        realm: imported.realm,
        enabled: imported.enabled,
        attributes: structuredClone(imported.attributes),
      };
      this.clients = imported.clients.map((candidate, index) => ({
        ...structuredClone(candidate),
        id: `client-${index + 1}`,
      }));
      return new Response(null, { status: 201 });
    }

    return jsonResponse({ error: 'unexpected_admin_path', path: url.pathname }, 404);
  }) as typeof fetch & { mockClear(): void };

  clearTraffic(): void {
    this.requests.length = 0;
    this.mutations.length = 0;
    this.fetch.mockClear();
  }
}

async function execute(
  fake: ImportOrSkipKeycloakAdmin,
  mode: 'check' | 'apply' = 'apply',
  resolveSecret: (reference: string) => string = secret,
): Promise<BootstrapResult> {
  const module = await bootstrapModule();
  const admin = module.createKeycloakAdminClient({
    baseUrl: keycloakOrigin,
    adminUsername: 'ui4a-bootstrap-admin',
    adminPassword,
    fetch: fake.fetch,
    timeoutMs: 100,
  });
  return module.bootstrapKeycloakRealm({
    admin,
    realmImport: realmImport(),
    publicOrigin,
    resolveSecret,
    mode,
  });
}

function mutationRequests(fake: ImportOrSkipKeycloakAdmin): RecordedRequest[] {
  return fake.requests.filter((request) =>
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method),
  );
}

describe('T22 experimental Keycloak import-or-check-skip bootstrap', () => {
  it('uses injected Admin credentials and never discloses credentials in URLs or results', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    const result = await execute(fake, 'check');
    const login = fake.requests.find((request) => request.url.includes('/realms/master/'));

    expect(login).toBeDefined();
    expect(login?.method).toBe('POST');
    expect(login?.body).toContain('client_id=admin-cli');
    expect(login?.body).toContain('username=ui4a-bootstrap-admin');
    expect(login?.body).toContain(`password=${encodeURIComponent(adminPassword)}`);
    expect(new URL(login!.url).search).toBe('');
    for (const material of [
      'ui4a-bootstrap-admin',
      adminPassword,
      webClientSecret,
      agentClientSecret,
      fixturePassword,
      adminToken,
    ]) {
      expect(login?.url).not.toContain(material);
    }
    expect(JSON.stringify(result)).not.toMatch(
      new RegExp([adminPassword, webClientSecret, agentClientSecret, adminToken].join('|')),
    );
    expect(fake.mutations).toHaveLength(0);
  });

  it('--check reports an absent realm without importing it', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    const resolveSecret = vi.fn(secret);

    await expect(execute(fake, 'check', resolveSecret)).resolves.toMatchObject({
      outcome: 'absent',
    });
    expect(fake.realm).toBeUndefined();
    expect(fake.mutations).toHaveLength(0);
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it('--apply imports an absent realm with one full RealmRepresentation POST', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    const resolveSecret = vi.fn(secret);
    const result = await execute(fake, 'apply', resolveSecret);

    expect(result).toMatchObject({ outcome: 'imported' });
    expect(fake.mutations).toHaveLength(1);
    expect(fake.mutations[0]?.path).toBe('/admin/realms');
    const imported = JSON.parse(fake.mutations[0]!.body) as RealmImportRepresentation;
    expect(imported).toMatchObject({ realm: 'ui4a', enabled: true });
    expect(imported.clients.map(({ clientId }) => clientId).sort()).toEqual([
      'ui4a-agent',
      'ui4a-api',
      'ui4a-web',
    ]);
    expect(
      imported.clients.find(({ clientId }) => clientId === 'ui4a-web')?.defaultClientScopes,
    ).toEqual(['ui4a:read', 'ui4a:write', 'ui4a:approve']);
    expect(JSON.stringify(imported)).toContain(`${publicOrigin}/api/auth/callback`);
    expect(JSON.stringify(imported)).toContain(webClientSecret);
    expect(JSON.stringify(imported)).toContain(agentClientSecret);
    expect(JSON.stringify(imported)).toContain(fixturePassword);
    expect(JSON.stringify(imported)).not.toMatch(/\{\{UI4A_ORIGIN\}\}|\{\{secret:/);
    expect(JSON.stringify(result)).not.toMatch(/__test_only_|access_token/i);
    expect(resolveSecret.mock.calls.map(([reference]) => reference).sort()).toEqual([
      'oidc-client-secret',
      'ui4a-agent-client-secret',
      'ui4a-experiment-human-password',
    ]);
  });

  it('checks an existing compatible realm and skips without mutation', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    await execute(fake, 'apply');
    fake.clearTraffic();
    const resolveSecret = vi.fn(secret);

    const result = await execute(fake, 'apply', resolveSecret);

    expect(result).toMatchObject({ outcome: 'skip' });
    expect(fake.mutations).toHaveLength(0);
    expect(fake.requests.some((request) => request.url.endsWith('/admin/realms/ui4a'))).toBe(true);
    expect(
      fake.requests.some((request) => new URL(request.url).pathname.endsWith('/clients')),
    ).toBe(true);
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it('is idempotent: the second run checks and skips', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();

    await expect(execute(fake, 'apply')).resolves.toMatchObject({ outcome: 'imported' });
    fake.clearTraffic();
    await expect(execute(fake, 'apply')).resolves.toMatchObject({ outcome: 'skip' });
    expect(mutationRequests(fake)).toHaveLength(1); // Admin token request only.
    expect(fake.mutations).toHaveLength(0);
  });

  it.each([
    [
      'disabled realm',
      (fake: ImportOrSkipKeycloakAdmin) => Object.assign(fake.realm!, { enabled: false }),
    ],
    [
      'realm contract version drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        fake.realm!.attributes = { 'ui4a.experimental.contract.version': '0' };
      },
    ],
    [
      'missing managed client',
      (fake: ImportOrSkipKeycloakAdmin) => {
        fake.clients = fake.clients.filter(({ clientId }) => clientId !== 'ui4a-api');
      },
    ],
    [
      'Web PKCE drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const web = fake.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
        web.attributes = { ...web.attributes, 'pkce.code.challenge.method': 'plain' };
      },
    ],
    [
      'Web service-account drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const web = fake.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
        web.serviceAccountsEnabled = true;
      },
    ],
    [
      'Web audience drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const web = fake.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
        web.protocolMappers = web.protocolMappers?.filter(
          ({ config }) => config?.['included.client.audience'] !== 'ui4a-agent',
        );
      },
    ],
    [
      'Agent exchange drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const agent = fake.clients.find(({ clientId }) => clientId === 'ui4a-agent')!;
        agent.attributes = { ...agent.attributes, 'standard.token.exchange.enabled': 'false' };
      },
    ],
    [
      'Agent standard-flow drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const agent = fake.clients.find(({ clientId }) => clientId === 'ui4a-agent')!;
        agent.standardFlowEnabled = true;
      },
    ],
    [
      'Agent audience drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const agent = fake.clients.find(({ clientId }) => clientId === 'ui4a-agent')!;
        agent.protocolMappers = [];
      },
    ],
    [
      'Web default scope drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const web = fake.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
        web.defaultClientScopes = web.defaultClientScopes?.filter(
          (scope) => scope !== 'ui4a:approve',
        );
      },
    ],
    [
      'Web built-in default scope drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const web = fake.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
        web.defaultClientScopes = [...(web.defaultClientScopes ?? []), 'profile'];
      },
    ],
    [
      'Agent optional policy scope drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const agent = fake.clients.find(({ clientId }) => clientId === 'ui4a-agent')!;
        agent.optionalClientScopes = agent.optionalClientScopes?.filter(
          (scope) => scope !== 'ui4a:policy:governance',
        );
      },
    ],
    [
      'API optional permission scope drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const api = fake.clients.find(({ clientId }) => clientId === 'ui4a-api')!;
        api.optionalClientScopes = api.optionalClientScopes?.filter(
          (scope) => scope !== 'ui4a:write',
        );
      },
    ],
    [
      'API bearer-only drift',
      (fake: ImportOrSkipKeycloakAdmin) => {
        const api = fake.clients.find(({ clientId }) => clientId === 'ui4a-api')!;
        api.bearerOnly = false;
      },
    ],
  ])('fails closed on %s without attempting repair', async (_label, drift) => {
    const fake = new ImportOrSkipKeycloakAdmin();
    await execute(fake, 'apply');
    drift(fake);
    fake.clearTraffic();
    const resolveSecret = vi.fn(secret);

    await expect(execute(fake, 'apply', resolveSecret)).rejects.toMatchObject({
      code: 'KEYCLOAK_REALM_INCOMPATIBLE',
    });
    expect(fake.mutations).toHaveLength(0);
    expect(mutationRequests(fake)).toHaveLength(1); // Admin token request only.
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it('ignores non-managed Keycloak clients while checking the three UI4A clients', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    await execute(fake, 'apply');
    fake.clients.push({ clientId: 'account', enabled: true });
    fake.clearTraffic();

    await expect(execute(fake, 'check')).resolves.toMatchObject({ outcome: 'skip' });
    expect(fake.mutations).toHaveLength(0);
  });

  it('never reads or mutates users, profiles, passwords, roles, or client scopes', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    await execute(fake, 'apply');
    fake.clearTraffic();
    await execute(fake, 'check');

    const paths = fake.requests.map((request) => new URL(request.url).pathname);
    expect(paths).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/users(?:\/|$)/),
        expect.stringMatching(/\/roles(?:\/|$)/),
        expect.stringMatching(/\/client-scopes(?:\/|$)/),
      ]),
    );
    expect(fake.mutations).toHaveLength(0);
  });

  it('reports one failed import with a stable redacted error', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    fake.failImport = true;

    let failure: unknown;
    try {
      await execute(fake, 'apply');
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: 'KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED' });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toMatch(/__test_only_|password|token/i);
    expect(JSON.stringify(failure)).not.toMatch(/__test_only_|password|token/i);
    expect(fake.mutations).toHaveLength(1);
  });
});

describe('T22 Keycloak Admin network boundary', () => {
  it('rejects non-HTTPS Keycloak and public origins before network access', async () => {
    const module = await bootstrapModule();
    const fake = new ImportOrSkipKeycloakAdmin();

    expect(() =>
      module.createKeycloakAdminClient({
        baseUrl: 'http://auth.ui4a.mothership.internal',
        adminUsername: 'ui4a-bootstrap-admin',
        adminPassword,
        fetch: fake.fetch,
        timeoutMs: 100,
      }),
    ).toThrowError(expect.objectContaining({ code: 'KEYCLOAK_REALM_IMPORT_INVALID' }));

    const admin = module.createKeycloakAdminClient({
      baseUrl: keycloakOrigin,
      adminUsername: 'ui4a-bootstrap-admin',
      adminPassword,
      fetch: fake.fetch,
      timeoutMs: 100,
    });
    await expect(
      module.bootstrapKeycloakRealm({
        admin,
        realmImport: realmImport(),
        publicOrigin: 'http://ui4a.mothership.internal',
        resolveSecret: secret,
        mode: 'check',
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_REALM_IMPORT_INVALID' });
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it('uses same-origin Admin paths, rejects redirects, and attaches a timeout signal', async () => {
    const fake = new ImportOrSkipKeycloakAdmin();
    await execute(fake, 'check');

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

  it('maps timeout and malformed Admin responses to stable non-secret errors', async () => {
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
      module.bootstrapKeycloakRealm({
        admin: timedAdmin,
        realmImport: realmImport(),
        publicOrigin,
        resolveSecret: secret,
        mode: 'check',
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
      module.bootstrapKeycloakRealm({
        admin: invalidAdmin,
        realmImport: realmImport(),
        publicOrigin,
        resolveSecret: secret,
        mode: 'check',
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE' });
  });
});

describe('T22 Keycloak bootstrap executable entrypoint', () => {
  it('loads canonical production configuration and exposes check/apply import modes', () => {
    const source = requiredSource(entrypointPath);

    expect(source).toContain('preflightProductionDeploymentFromEnvironment');
    expect(source).toMatch(/settings\.auth\.oidc\.issuer/);
    expect(source).toContain('UI4A_KEYCLOAK_ADMIN_ORIGIN');
    expect(source).toMatch(/adminOrigin\.hostname.*settings\.keycloak\.host/s);
    expect(source).toMatch(/settings\.service\.publicOrigin/);
    expect(source).toMatch(/settings\.keycloak\.bootstrapAdminUser/);
    expect(source).toMatch(/settings\.keycloak\.bootstrapAdminPasswordRef/);
    expect(source).toContain("'oidc-client-secret': settings.auth.oidc.clientSecretRef");
    expect(source).toContain("'ui4a-agent-client-secret': settings.auth.oidc.agentClientSecretRef");
    expect(source).toContain(
      "'ui4a-experiment-human-password': settings.keycloak.experimentHumanPasswordRef",
    );
    expect(source).toContain('config.secrets[configuredReference]');
    expect(source).not.toContain('config.secrets[reference]');
    expect(source).toMatch(/config\.secrets/);
    expect(source).toContain('deploy/keycloak/realm-import.json');
    expect(source).toContain('UI4A_REALM_IMPORT_FILE');
    expect(source).toMatch(/isAbsolute\(path\)/);
    expect(source).toMatch(/O_NOFOLLOW/);
    expect(source).toMatch(/status\.isFile\(\)/);
    expect(source).toContain('--check');
    expect(source).toContain('--apply');
    expect(source).toContain('bootstrapKeycloakRealm');
    expect(source).not.toContain('planKeycloakRealmReconciliation');
    expect(source).not.toMatch(/__test_only_|adminPassword\s*:\s*['"]|clientSecret\s*:\s*['"]/);
  });
});
