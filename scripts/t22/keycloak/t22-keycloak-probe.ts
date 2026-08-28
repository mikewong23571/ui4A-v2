import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { chromium } from 'playwright';

const baseUrl = process.env.KEYCLOAK_PROBE_BASE_URL ?? 'http://127.0.0.1:18080';
const adminUsername = process.env.KEYCLOAK_PROBE_ADMIN_USERNAME ?? 'probe-admin';
const adminPassword = process.env.KEYCLOAK_PROBE_ADMIN_PASSWORD;
if (adminPassword === undefined || adminPassword === '') {
  throw new Error('KEYCLOAK_PROBE_ADMIN_PASSWORD is required');
}
const realm = 'ui4a-t22-probe';
const humanUsername = 'probe-human';
const humanPassword = randomUUID() + randomUUID();
const actorUsername = 'probe-actor';
const agentClientId = 'ui4a-agent';
const agentClientSecret = randomUUID() + randomUUID();
const actorPassword = randomUUID() + randomUUID();
const webClientId = 'ui4a-web';
const callbackPort = 18181;
const callbackUrl = 'http://127.0.0.1:' + callbackPort + '/callback';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  issued_token_type?: string;
}

interface JwtClaims {
  sub?: string;
  aud?: string | string[];
  azp?: string;
  preferred_username?: string;
  scope?: string;
  act?: unknown;
  may_act?: { sub?: string };
}

function decodeJwt(token: string): JwtClaims {
  const payload = token.split('.')[1];
  if (payload === undefined) throw new Error('JWT payload is missing');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtClaims;
}

async function formRequest(
  url: string,
  values: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

function requireToken(
  result: { status: number; body: Record<string, unknown> },
  label: string,
): TokenResponse {
  if (result.status !== 200 || typeof result.body.access_token !== 'string') {
    throw new Error(
      label + ' failed with HTTP ' + result.status + ': ' + JSON.stringify(result.body),
    );
  }
  return result.body as unknown as TokenResponse;
}

async function adminToken(): Promise<string> {
  const result = await formRequest(baseUrl + '/realms/master/protocol/openid-connect/token', {
    grant_type: 'password',
    client_id: 'admin-cli',
    username: adminUsername,
    password: adminPassword,
  });
  return requireToken(result, 'admin login').access_token;
}

async function adminRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(baseUrl + '/admin' + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + token,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });
}

async function jsonAdmin<T>(token: string, path: string): Promise<T> {
  const response = await adminRequest(token, path);
  if (!response.ok) throw new Error('admin GET ' + path + ' failed with HTTP ' + response.status);
  return (await response.json()) as T;
}

async function configureRealm(token: string): Promise<void> {
  const previous = await adminRequest(token, '/realms/' + realm, { method: 'DELETE' });
  if (previous.status !== 204 && previous.status !== 404) {
    throw new Error('probe realm cleanup failed with HTTP ' + previous.status);
  }

  const response = await adminRequest(token, '/realms', {
    method: 'POST',
    body: JSON.stringify({
      realm,
      enabled: true,
      registrationAllowed: false,
      resetPasswordAllowed: false,
      accessTokenLifespan: 300,
      clients: [
        {
          clientId: webClientId,
          name: 'UI4A browser probe',
          protocol: 'openid-connect',
          publicClient: true,
          standardFlowEnabled: true,
          directAccessGrantsEnabled: true,
          consentRequired: true,
          redirectUris: [callbackUrl],
          webOrigins: ['http://127.0.0.1:' + callbackPort],
          attributes: {
            'pkce.code.challenge.method': 'S256',
          },
          protocolMappers: [
            {
              name: 'ui4a-agent-audience',
              protocol: 'openid-connect',
              protocolMapper: 'oidc-audience-mapper',
              consentRequired: false,
              config: {
                'included.client.audience': agentClientId,
                'id.token.claim': 'false',
                'access.token.claim': 'true',
              },
            },
          ],
        },
        {
          clientId: agentClientId,
          name: 'UI4A agent probe',
          protocol: 'openid-connect',
          publicClient: false,
          secret: agentClientSecret,
          serviceAccountsEnabled: true,
          standardFlowEnabled: false,
          directAccessGrantsEnabled: false,
          attributes: {
            'standard.token.exchange.enabled': 'true',
          },
        },
        {
          clientId: 'ui4a-api',
          name: 'UI4A resource probe',
          protocol: 'openid-connect',
          publicClient: false,
          bearerOnly: true,
        },
      ],
      users: [
        {
          username: humanUsername,
          enabled: true,
          emailVerified: true,
          firstName: 'Probe',
          lastName: 'Human',
          email: 'probe-human@ui4a.invalid',
          credentials: [{ type: 'password', value: humanPassword, temporary: false }],
        },
        {
          username: actorUsername,
          enabled: true,
          emailVerified: true,
          firstName: 'Probe',
          lastName: 'Actor',
          email: 'probe-actor@ui4a.invalid',
          credentials: [{ type: 'password', value: actorPassword, temporary: false }],
        },
      ],
    }),
  });
  if (response.status !== 201) {
    throw new Error(
      'realm creation failed with HTTP ' + response.status + ': ' + (await response.text()),
    );
  }

  const clients = await jsonAdmin<Array<{ id: string; clientId: string }>>(
    token,
    '/realms/' + realm + '/clients',
  );
  const webClient = clients.find((client) => client.clientId === webClientId);
  const realmManagement = clients.find((client) => client.clientId === 'realm-management');
  if (webClient === undefined || realmManagement === undefined) {
    throw new Error('probe clients were not materialized');
  }

  const scopes = await jsonAdmin<Array<{ id: string; name: string }>>(
    token,
    '/realms/' + realm + '/client-scopes',
  );
  const delegationScope = scopes.find((scope) => scope.name === 'delegation');
  if (delegationScope === undefined) throw new Error('delegation client scope was not created');
  const scopeResponse = await adminRequest(
    token,
    '/realms/' +
      realm +
      '/clients/' +
      webClient.id +
      '/optional-client-scopes/' +
      delegationScope.id,
    { method: 'PUT' },
  );
  if (scopeResponse.status !== 204) {
    throw new Error('adding delegation scope failed with HTTP ' + scopeResponse.status);
  }

  const users = await jsonAdmin<Array<{ id: string; username: string }>>(
    token,
    '/realms/' + realm + '/users?username=' + encodeURIComponent(actorUsername) + '&exact=true',
  );
  const actor = users.find((user) => user.username === actorUsername);
  if (actor === undefined) throw new Error('probe actor was not materialized');
  const impersonationRole = await jsonAdmin<Record<string, unknown>>(
    token,
    '/realms/' + realm + '/clients/' + realmManagement.id + '/roles/impersonation',
  );
  const roleResponse = await adminRequest(
    token,
    '/realms/' + realm + '/users/' + actor.id + '/role-mappings/clients/' + realmManagement.id,
    { method: 'POST', body: JSON.stringify([impersonationRole]) },
  );
  if (roleResponse.status !== 204) {
    throw new Error('actor impersonation role failed with HTTP ' + roleResponse.status);
  }
}

async function browserAuthorization(scope: string): Promise<TokenResponse> {
  const verifier =
    createHash('sha256').update(randomUUID()).digest('base64url') +
    createHash('sha256')
      .update(randomUUID() + randomUUID())
      .digest('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomUUID();

  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveCode = resolvePromise;
    rejectCode = rejectPromise;
  });
  void codePromise.catch(() => undefined);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', callbackUrl);
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('T22 Keycloak probe callback received');
    if (error !== null) {
      rejectCode(new Error('authorization failed: ' + error));
    } else if (code === null || returnedState !== state) {
      rejectCode(new Error('authorization callback is missing code or has invalid state'));
    } else {
      resolveCode(code);
    }
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(callbackPort, '127.0.0.1', resolvePromise);
  });

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const authorizationUrl = new URL(
      baseUrl + '/realms/' + realm + '/protocol/openid-connect/auth',
    );
    for (const [name, value] of Object.entries({
      client_id: webClientId,
      response_type: 'code',
      redirect_uri: callbackUrl,
      scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })) {
      authorizationUrl.searchParams.set(name, value);
    }

    await page.goto(authorizationUrl.toString());
    if (page.url().startsWith(callbackUrl)) await codePromise;
    await page.locator('#username').fill(humanUsername);
    await page.locator('#password').fill(humanPassword);
    await page.locator('#kc-login').click();
    await page.waitForTimeout(500);
    const consent = page.locator('button[name="accept"], input[name="accept"]');
    if ((await consent.count()) > 0) await consent.first().click();

    let code: string;
    try {
      code = await Promise.race([
        codePromise,
        new Promise<never>((_, rejectPromise) =>
          setTimeout(() => rejectPromise(new Error('authorization callback timed out')), 15_000),
        ),
      ]);
    } catch (error) {
      const buttons = await page.locator('button, input[type="submit"]').evaluateAll((elements) =>
        elements.map((element) => ({
          id: element.id,
          name: element.getAttribute('name'),
          value: element.getAttribute('value'),
        })),
      );
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message +
          '; url=' +
          page.url() +
          '; title=' +
          (await page.title()) +
          '; buttons=' +
          JSON.stringify(buttons),
      );
    }
    const result = await formRequest(
      baseUrl + '/realms/' + realm + '/protocol/openid-connect/token',
      {
        grant_type: 'authorization_code',
        client_id: webClientId,
        redirect_uri: callbackUrl,
        code,
        code_verifier: verifier,
      },
    );
    return requireToken(result, 'authorization code exchange');
  } finally {
    await browser.close();
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

async function run(): Promise<void> {
  const token = await adminToken();
  await configureRealm(token);
  try {
    const humanToken = await browserAuthorization('openid profile');
    const humanClaims = decodeJwt(humanToken.access_token);
    if (humanClaims.preferred_username !== humanUsername) {
      throw new Error('PKCE token subject does not match the browser user');
    }
    const audience = Array.isArray(humanClaims.aud) ? humanClaims.aud : [humanClaims.aud];
    if (!audience.includes(agentClientId)) throw new Error('PKCE token lacks agent audience');

    const serviceResult = await formRequest(
      baseUrl + '/realms/' + realm + '/protocol/openid-connect/token',
      {
        grant_type: 'client_credentials',
        client_id: agentClientId,
        client_secret: agentClientSecret,
      },
    );
    const serviceToken = requireToken(serviceResult, 'client credentials');
    const serviceClaims = decodeJwt(serviceToken.access_token);
    if (serviceClaims.azp !== agentClientId) throw new Error('service token azp is incorrect');

    const exchangeResult = await formRequest(
      baseUrl + '/realms/' + realm + '/protocol/openid-connect/token',
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: agentClientId,
        client_secret: agentClientSecret,
        subject_token: humanToken.access_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      },
    );
    const exchangedToken = requireToken(exchangeResult, 'standard token exchange');
    const exchangedClaims = decodeJwt(exchangedToken.access_token);
    if (exchangedClaims.sub !== humanClaims.sub || exchangedClaims.azp !== agentClientId) {
      throw new Error('standard exchange lost subject or requester identity');
    }

    const publicExchange = await formRequest(
      baseUrl + '/realms/' + realm + '/protocol/openid-connect/token',
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: webClientId,
        subject_token: humanToken.access_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      },
    );
    if (publicExchange.status < 400) throw new Error('public client token exchange was accepted');

    let delegation: { status: 'passed' | 'blocked'; stability: 'experimental'; detail: string };
    try {
      const delegatedToken = await browserAuthorization('openid delegation:' + actorUsername);
      const delegatedClaims = decodeJwt(delegatedToken.access_token);
      if (delegatedClaims.may_act?.sub === undefined) {
        delegation = {
          status: 'blocked',
          stability: 'experimental',
          detail: 'authorization completed but access token did not contain may_act.sub',
        };
      } else {
        const delegatedExchangeResult = await formRequest(
          baseUrl + '/realms/' + realm + '/protocol/openid-connect/token',
          {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            client_id: agentClientId,
            client_secret: agentClientSecret,
            subject_token: delegatedToken.access_token,
            subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          },
        );
        const delegatedExchange = requireToken(
          delegatedExchangeResult,
          'delegated standard token exchange',
        );
        const delegatedExchangeClaims = decodeJwt(delegatedExchange.access_token);
        if (
          delegatedExchangeClaims.sub !== delegatedClaims.sub ||
          delegatedExchangeClaims.azp !== agentClientId
        ) {
          throw new Error('delegated exchange lost subject or requester identity');
        }
        delegation = {
          status: 'passed',
          stability: 'experimental',
          detail:
            'may_act pre-authorization present; exchanged act=' +
            String(delegatedExchangeClaims.act !== undefined) +
            '; exchanged may_act=' +
            String(delegatedExchangeClaims.may_act !== undefined),
        };
      }
    } catch (error) {
      delegation = {
        status: 'blocked',
        stability: 'experimental',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const result = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      keycloak: {
        version: '26.7.1',
        imageDigest: 'sha256:f1f1f01e472c8a78df40d8f2a49a925274eda4d3d80d5f6edbb5c880ee3c01c6',
        distributionSha256: 'd3bb3da0e4bf574db0c857f92b272da90575dc97aa26c41329c9d4399200974c',
        mode: 'disposable-start-dev',
      },
      flows: {
        authorizationCodePkce: { status: 'passed', codeChallengeMethod: 'S256' },
        clientCredentials: { status: 'passed' },
        standardTokenExchange: {
          status: 'passed',
          standard: 'RFC 8693 internal-to-internal',
        },
        actDelegation: delegation,
        publicClientExchange: { status: 'passed', expectedRejection: true },
      },
      boundary: {
        istio: ['issuer-signature-audience', 'coarse-route-policy'],
        application: [
          'actor-principal-scope-derivation',
          'delegation-chain-validation',
          'human-only-approval',
          'action-guard-schema',
          'event-audit',
        ],
      },
      sources: [
        'https://www.keycloak.org/downloads',
        'https://www.keycloak.org/server/containers',
        'https://www.keycloak.org/securing-apps/token-exchange',
        'https://www.keycloak.org/securing-apps/specifications',
      ],
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    const cleanupToken = await adminToken();
    const cleanup = await adminRequest(cleanupToken, '/realms/' + realm, { method: 'DELETE' });
    if (cleanup.status !== 204 && cleanup.status !== 404) {
      throw new Error('probe realm final cleanup failed with HTTP ' + cleanup.status);
    }
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('T22 Keycloak probe failed: ' + message + '\n');
  process.exitCode = 1;
});
