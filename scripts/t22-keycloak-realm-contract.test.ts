import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realmImportPath = 'deploy/keycloak/realm-import.json';
const deploymentBindingsPath = 'deploy/keycloak/deployment-bindings.json';

interface RealmClientRepresentation {
  clientId: string;
  enabled: boolean;
  publicClient: boolean;
  bearerOnly?: boolean;
  standardFlowEnabled: boolean;
  serviceAccountsEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  redirectUris?: string[];
  attributes?: Record<string, string>;
  secret?: string;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
  protocolMappers?: Array<{
    name: string;
    protocol: string;
    protocolMapper: string;
    config: Record<string, string>;
  }>;
}

interface RealmImportRepresentation {
  realm: string;
  enabled: boolean;
  attributes?: Record<string, string>;
  clients: RealmClientRepresentation[];
  clientScopes?: Array<{
    name: string;
    protocol: string;
    attributes: Record<string, string>;
  }>;
  users?: Array<{
    username: string;
    enabled: boolean;
    credentials: Array<{ type: 'password'; value: string; temporary: boolean }>;
  }>;
  [key: string]: unknown;
}

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing T22 Keycloak realm import artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

function requiredJson<T>(path: string): T {
  return JSON.parse(requiredSource(path)) as T;
}

function client(input: RealmImportRepresentation, clientId: string): RealmClientRepresentation {
  const match = input.clients.find((candidate) => candidate.clientId === clientId);
  if (match === undefined) throw new Error(`realm import is missing ${clientId}`);
  return match;
}

describe('T22 experimental Keycloak realm import contract', () => {
  const policyScopes = [
    'ui4a:policy:community',
    'ui4a:policy:default',
    'ui4a:policy:development',
    'ui4a:policy:editorial',
    'ui4a:policy:governance',
    'ui4a:policy:publishing',
  ];

  it('uses one direct realm import artifact for Compose and Kubernetes', () => {
    const input = requiredJson<RealmImportRepresentation>(realmImportPath);
    const bindings = requiredJson<{
      schemaVersion: number;
      consumers: Record<'compose' | 'kubernetes', { realmImportRef: string }>;
    }>(deploymentBindingsPath);

    expect(input).toMatchObject({
      realm: 'ui4a',
      enabled: true,
      attributes: { 'ui4a.experimental.contract.version': '1' },
    });
    expect(bindings.schemaVersion).toBe(1);
    expect(bindings.consumers.compose.realmImportRef).toBe(realmImportPath);
    expect(bindings.consumers.kubernetes.realmImportRef).toBe(realmImportPath);
  });

  it('contains exactly Web, Agent, and API clients', () => {
    const input = requiredJson<RealmImportRepresentation>(realmImportPath);

    expect(input.clients.map(({ clientId }) => clientId).sort()).toEqual([
      'ui4a-agent',
      'ui4a-api',
      'ui4a-web',
    ]);
    expect(input.clients.every((candidate) => !candidate.directAccessGrantsEnabled)).toBe(true);
  });

  it('configures Web for confidential Authorization Code with S256 PKCE', () => {
    const input = requiredJson<RealmImportRepresentation>(realmImportPath);
    const web = client(input, 'ui4a-web');

    expect(web).toMatchObject({
      enabled: true,
      publicClient: false,
      standardFlowEnabled: true,
      serviceAccountsEnabled: false,
      directAccessGrantsEnabled: false,
      attributes: expect.objectContaining({ 'pkce.code.challenge.method': 'S256' }),
    });
    expect(web.redirectUris).toEqual(['{{UI4A_ORIGIN}}/api/auth/callback']);
    expect(web.attributes?.['post.logout.redirect.uris']).toBe('{{UI4A_ORIGIN}}/*');
    expect(web.secret).toBe('{{secret:oidc-client-secret}}');
    expect(web.defaultClientScopes).toEqual([
      'profile',
      'email',
      'ui4a:read',
      'ui4a:write',
      'ui4a:approve',
    ]);
    expect(web.optionalClientScopes?.toSorted()).toEqual(policyScopes);
    expect(
      web.protocolMappers
        ?.filter(
          ({ protocol, protocolMapper, config }) =>
            protocol === 'openid-connect' &&
            protocolMapper === 'oidc-audience-mapper' &&
            config['access.token.claim'] === 'true' &&
            config['id.token.claim'] === 'false',
        )
        .map(({ config }) => config['included.client.audience'])
        .sort(),
    ).toEqual(['ui4a-agent', 'ui4a-api']);
  });

  it('configures Agent client credentials, Standard Token Exchange, and API audience', () => {
    const input = requiredJson<RealmImportRepresentation>(realmImportPath);
    const agent = client(input, 'ui4a-agent');
    const api = client(input, 'ui4a-api');

    expect(agent).toMatchObject({
      enabled: true,
      publicClient: false,
      standardFlowEnabled: false,
      serviceAccountsEnabled: true,
      directAccessGrantsEnabled: false,
      secret: '{{secret:ui4a-agent-client-secret}}',
      attributes: expect.objectContaining({ 'standard.token.exchange.enabled': 'true' }),
    });
    expect(agent.protocolMappers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: 'openid-connect',
          protocolMapper: 'oidc-audience-mapper',
          config: expect.objectContaining({
            'included.client.audience': 'ui4a-api',
            'access.token.claim': 'true',
          }),
        }),
      ]),
    );
    expect(agent.defaultClientScopes).toEqual(['ui4a:read', 'ui4a:write']);
    expect(agent.optionalClientScopes?.toSorted()).toEqual(policyScopes);
    expect(api).toMatchObject({
      enabled: true,
      publicClient: false,
      bearerOnly: true,
      standardFlowEnabled: false,
      serviceAccountsEnabled: false,
      directAccessGrantsEnabled: false,
    });
    expect(api.defaultClientScopes).toEqual(['ui4a:read']);
    expect(api.optionalClientScopes?.toSorted()).toEqual(
      [...policyScopes, 'ui4a:approve', 'ui4a:write'].toSorted(),
    );
  });

  it('defines only the fixed permission and policy client scopes emitted in access tokens', () => {
    const input = requiredJson<RealmImportRepresentation>(realmImportPath);

    expect(input.clientScopes?.map(({ name }) => name).toSorted()).toEqual([
      'ui4a:approve',
      'ui4a:policy:community',
      'ui4a:policy:default',
      'ui4a:policy:development',
      'ui4a:policy:editorial',
      'ui4a:policy:governance',
      'ui4a:policy:publishing',
      'ui4a:read',
      'ui4a:write',
    ]);
    expect(input.clientScopes).toEqual(
      expect.arrayContaining(
        input.clientScopes!.map(({ name }) => ({
          name,
          protocol: 'openid-connect',
          attributes: { 'include.in.token.scope': 'true' },
        })),
      ),
    );
  });

  it('keeps CLI as an external Bearer consumer and delegation as standard sub plus azp', () => {
    const source = requiredSource(realmImportPath);
    const input = requiredJson<RealmImportRepresentation>(realmImportPath);

    expect(input.clients).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ clientId: 'ui4a-cli' })]),
    );
    expect(source).not.toMatch(/password-grant|direct-access-grant/i);
    expect(source).not.toMatch(/"act"|act-claim|delegation-chain/i);
  });

  it('imports one experimental human but no role-sync or rotation machinery', () => {
    const input = requiredJson<RealmImportRepresentation>(realmImportPath);
    const source = requiredSource(realmImportPath);

    expect(input.users).toEqual([
      {
        username: 'ui4a-experiment-human',
        enabled: true,
        credentials: [
          {
            type: 'password',
            value: '{{secret:ui4a-experiment-human-password}}',
            temporary: false,
          },
        ],
      },
    ]);
    expect(input).not.toHaveProperty('roles');
    expect(source).not.toMatch(/fixtureUsers|passwordSecretRef|secretRotation|managedFields/);
    expect(source).not.toContain('__test_only_secret_material__');
  });
});
