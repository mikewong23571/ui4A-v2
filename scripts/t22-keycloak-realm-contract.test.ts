import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realmContractPath = 'deploy/keycloak/realm-contract.json';
const deploymentBindingsPath = 'deploy/keycloak/deployment-bindings.json';
const reconcilerPath = 'deploy/keycloak/realm-reconciler.ts';

interface RealmClientContract {
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
}

interface RealmContract {
  schemaVersion: number;
  keycloakVersion: string;
  realm: { name: string; enabled: boolean };
  protocolScopes: string[];
  clientScopes: Array<{ name: string; kind: 'permission' | 'policy' }>;
  clients: RealmClientContract[];
  roles: Array<{
    name: 'ui4a-human' | 'ui4a-agent' | 'ui4a-service';
    scopes: string[];
    humanApprovalEligible: boolean;
  }>;
  fixtureUsers: Array<{
    username: string;
    role: 'ui4a-human' | 'ui4a-agent' | 'ui4a-service';
    passwordSecretRef: string;
  }>;
  bearerConsumers: {
    cli: { flow: 'externally-provisioned-bearer'; audience: string; dedicatedClient: false };
  };
}

interface ObservedRealm {
  realm: RealmContract['realm'];
  clients: Array<Omit<RealmClientContract, 'secretRef'>>;
  clientScopes: RealmContract['clientScopes'];
  roles: RealmContract['roles'];
  users: Array<{
    username: string;
    role: string;
    profile: Record<string, string>;
    credentialsConfigured: boolean;
  }>;
  unmanaged: Record<string, unknown>;
}

interface ReconcileOperation {
  verb: 'create' | 'update';
  kind: 'realm' | 'client' | 'client-scope' | 'realm-role' | 'user';
  id: string;
  secretRef?: string;
  changedFields?: string[];
}

interface ReconcilePlan {
  outcome: 'create' | 'noop' | 'update';
  operations: ReconcileOperation[];
  summary: string;
}

interface RealmReconcilerModule {
  parseKeycloakRealmContract(input: unknown): RealmContract;
  planKeycloakRealmReconciliation(input: {
    contract: RealmContract;
    observed?: ObservedRealm;
  }): ReconcilePlan;
}

function requiredJson<T>(path: string): T {
  return JSON.parse(requiredSource(path)) as T;
}

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing T22 Keycloak realm artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

async function reconciler(): Promise<RealmReconcilerModule> {
  const absolutePath = resolve(repositoryRoot, reconcilerPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing T22 Keycloak realm reconciler: ${reconcilerPath}`);
  }
  return (await import(pathToFileURL(absolutePath).href)) as RealmReconcilerModule;
}

async function contract(): Promise<RealmContract> {
  const module = await reconciler();
  return module.parseKeycloakRealmContract(requiredJson(realmContractPath));
}

function observedFromContract(input: RealmContract): ObservedRealm {
  return {
    realm: structuredClone(input.realm),
    clients: input.clients.map((client) => {
      const observedClient = structuredClone(client) as Partial<RealmClientContract>;
      delete observedClient.secretRef;
      return observedClient as Omit<RealmClientContract, 'secretRef'>;
    }),
    clientScopes: structuredClone(input.clientScopes),
    roles: structuredClone(input.roles),
    users: input.fixtureUsers.map((user) => ({
      username: user.username,
      role: user.role,
      profile: { displayName: `Existing ${user.username}` },
      credentialsConfigured: true,
    })),
    unmanaged: {
      clients: [{ clientId: 'operator-owned-client', enabled: false }],
      realmAttributes: { operatorAnnotation: 'preserve-me' },
    },
  };
}

describe('T22 shared Keycloak 26 realm contract', () => {
  it('defines the ui4a realm and one canonical artifact for Compose and Kubernetes', () => {
    const input = requiredJson<RealmContract>(realmContractPath);
    const bindings = requiredJson<{
      schemaVersion: number;
      consumers: Record<'compose' | 'kubernetes', { realmContractRef: string }>;
    }>(deploymentBindingsPath);

    expect(input).toMatchObject({
      schemaVersion: 1,
      keycloakVersion: '26.7.1',
      realm: { name: 'ui4a', enabled: true },
    });
    expect(bindings.schemaVersion).toBe(1);
    expect(bindings.consumers.compose.realmContractRef).toBe(realmContractPath);
    expect(bindings.consumers.kubernetes.realmContractRef).toBe(realmContractPath);
  });

  it('defines a confidential server Web client with Authorization Code and S256 PKCE', () => {
    const input = requiredJson<RealmContract>(realmContractPath);
    const web = input.clients.find((client) => client.clientId === 'ui4a-web');

    expect(web).toMatchObject({
      clientKind: 'browser',
      confidential: true,
      standardFlowEnabled: true,
      serviceAccountsEnabled: false,
      directAccessGrantsEnabled: false,
      pkceCodeChallengeMethod: 'S256',
      secretRef: 'oidc-client-secret',
    });
    expect(web?.redirectUris).toEqual(['{{UI4A_ORIGIN}}/api/auth/callback']);
    expect(web?.postLogoutRedirectUris).toEqual(['{{UI4A_ORIGIN}}/']);
  });

  it('defines the service-account Agent, Standard Token Exchange, and API audience', () => {
    const input = requiredJson<RealmContract>(realmContractPath);
    const agent = input.clients.find((client) => client.clientId === 'ui4a-agent');
    const api = input.clients.find((client) => client.clientId === 'ui4a-api');

    expect(agent).toMatchObject({
      clientKind: 'service-account',
      confidential: true,
      standardFlowEnabled: false,
      serviceAccountsEnabled: true,
      directAccessGrantsEnabled: false,
      standardTokenExchangeEnabled: true,
      secretRef: 'ui4a-agent-client-secret',
    });
    expect(agent?.audiences).toContain('ui4a-api');
    expect(api).toMatchObject({
      clientKind: 'resource-server',
      confidential: true,
      standardFlowEnabled: false,
      serviceAccountsEnabled: false,
      audiences: ['ui4a-api'],
    });
  });

  it('keeps CLI as a Bearer consumer without adding a password-grant client', () => {
    const input = requiredJson<RealmContract>(realmContractPath);

    expect(input.bearerConsumers.cli).toEqual({
      flow: 'externally-provisioned-bearer',
      audience: 'ui4a-api',
      dedicatedClient: false,
    });
    expect(input.clients).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ clientId: 'ui4a-cli' })]),
    );
    expect(input.clients.every((client) => !client.directAccessGrantsEnabled)).toBe(true);
  });

  it('separates protocol, permission, policy, and human-only approval grants', () => {
    const input = requiredJson<RealmContract>(realmContractPath);
    const scopes = new Map(input.clientScopes.map((scope) => [scope.name, scope.kind]));
    const roles = new Map(input.roles.map((role) => [role.name, role]));

    expect(input.protocolScopes).toContain('openid');
    expect(Object.fromEntries(scopes)).toEqual(
      expect.objectContaining({
        'ui4a:read': 'permission',
        'ui4a:write': 'permission',
        'ui4a:approve': 'permission',
        default: 'policy',
        publishing: 'policy',
        community: 'policy',
        development: 'policy',
        editorial: 'policy',
        governance: 'policy',
      }),
    );
    expect(roles.get('ui4a-human')).toMatchObject({ humanApprovalEligible: true });
    expect(roles.get('ui4a-human')?.scopes).toContain('ui4a:approve');
    for (const roleName of ['ui4a-agent', 'ui4a-service'] as const) {
      expect(roles.get(roleName)).toMatchObject({ humanApprovalEligible: false });
      expect(roles.get(roleName)?.scopes).not.toContain('ui4a:approve');
    }
  });

  it('initializes fixture users only from Secret references and stores no credential material', () => {
    const source = requiredSource(realmContractPath);
    const input = requiredJson<RealmContract>(realmContractPath);

    expect(input.fixtureUsers.length).toBeGreaterThan(0);
    expect(input.fixtureUsers.every((user) => user.passwordSecretRef.endsWith('-password'))).toBe(
      true,
    );
    expect(source).not.toMatch(/"(?:password|secret|token)"\s*:/i);
    expect(source).not.toContain('__test_only_secret_material__');
  });
});

describe('T22 Keycloak realm reconciliation semantics', () => {
  it('plans create for an absent realm and carries only Secret references', async () => {
    const module = await reconciler();
    const input = await contract();
    const plan = module.planKeycloakRealmReconciliation({ contract: input });

    expect(plan.outcome).toBe('create');
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ verb: 'create', kind: 'realm', id: 'ui4a' }),
        expect.objectContaining({
          verb: 'create',
          kind: 'client',
          id: 'ui4a-web',
          secretRef: 'oidc-client-secret',
        }),
      ]),
    );
    expect(JSON.stringify(plan)).not.toContain('__test_only_secret_material__');
  });

  it('plans noop when all managed realm resources already match', async () => {
    const module = await reconciler();
    const input = await contract();
    const observed = observedFromContract(input);

    expect(module.planKeycloakRealmReconciliation({ contract: input, observed })).toEqual(
      expect.objectContaining({ outcome: 'noop', operations: [] }),
    );
  });

  it('updates drifted managed clients and scopes without touching operator-owned data', async () => {
    const module = await reconciler();
    const input = await contract();
    const observed = observedFromContract(input);
    const web = observed.clients.find((client) => client.clientId === 'ui4a-web');
    if (web === undefined) throw new Error('test fixture is missing ui4a-web');
    web.redirectUris = ['https://drift.invalid/callback'];
    observed.clientScopes = observed.clientScopes.filter((scope) => scope.name !== 'governance');

    const plan = module.planKeycloakRealmReconciliation({ contract: input, observed });

    expect(plan.outcome).toBe('update');
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ verb: 'update', kind: 'client', id: 'ui4a-web' }),
        expect.objectContaining({ verb: 'create', kind: 'client-scope', id: 'governance' }),
      ]),
    );
    expect(plan.operations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'operator-owned-client' })]),
    );
    expect(JSON.stringify(plan)).not.toContain('preserve-me');
  });

  it('never overwrites an existing fixture user password, profile, or unmanaged realm data', async () => {
    const module = await reconciler();
    const input = await contract();
    const observed = observedFromContract(input);
    observed.users[0] = {
      username: input.fixtureUsers[0]!.username,
      role: 'operator-changed-role',
      profile: { displayName: 'Operator Owned', email: 'kept@ui4a.invalid' },
      credentialsConfigured: true,
    };
    observed.unmanaged.serverOnlySecretCanary = '__test_only_secret_material__';

    const plan = module.planKeycloakRealmReconciliation({ contract: input, observed });

    expect(plan.operations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'user' })]),
    );
    expect(JSON.stringify(plan)).not.toMatch(/Operator Owned|kept@ui4a\.invalid|secret_material/);
    expect(plan.summary).not.toMatch(/password|secret|token/i);
  });
});
