import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureEventsTable, listEvents } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';

const auth = vi.hoisted(() => {
  const identities = {
    agent: {
      authorizationMode: 'credential',
      actor: 'agent',
      principal: 'human-alice',
      scopes: ['ui4a:write', 'ui4a:policy:publishing'],
      grantedApplications: ['publishing'],
      channel: 'oidc',
      humanApprovalEligible: false,
      delegation: {
        subject: 'human-alice',
        actorClientId: 'ui4a-agent',
        source: 'token-exchange-sub-azp',
      },
    },
    service: {
      authorizationMode: 'credential',
      actor: 'agent',
      principal: 'service-account-ui4a-agent',
      scopes: ['ui4a:write', 'ui4a:policy:publishing'],
      grantedApplications: ['publishing'],
      channel: 'oidc',
      humanApprovalEligible: false,
    },
    humanWithoutApproval: {
      authorizationMode: 'credential',
      actor: 'human',
      principal: 'human-alice',
      scopes: ['ui4a:write', 'ui4a:policy:publishing'],
      grantedApplications: ['publishing'],
      channel: 'oidc',
      humanApprovalEligible: true,
    },
  } as const;

  return {
    identities,
    resolve: vi.fn(async (request: Request, options: { requiredScopes: string[] }) => {
      const credential = request.headers.get('authorization')?.replace(/^Bearer /, '');
      const identity =
        credential === 'agent-fixture'
          ? identities.agent
          : credential === 'service-fixture'
            ? identities.service
            : identities.humanWithoutApproval;
      if (options.requiredScopes.some((scope) => !identity.scopes.includes(scope as never))) {
        throw Object.assign(new Error('scope_insufficient'), { code: 'scope_insufficient' });
      }
      return identity;
    }),
  };
});

vi.mock('../../../auth/request-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth/request-identity')>();
  return {
    ...actual,
    resolveTrustedRequestIdentity: auth.resolve,
    authenticationErrorResponse: (error: unknown) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : undefined;
      return code === 'scope_insufficient'
        ? Response.json({ error: { code } }, { status: 403 })
        : undefined;
    },
  };
});

import { POST } from './route';

const pool = getPool(process.env.DATABASE_URL!);

type CredentialKind = keyof typeof auth.identities;

function post(credential: CredentialKind, body: Record<string, unknown>): Request {
  return new Request('https://ui4a.internal/api/exec', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential === 'humanWithoutApproval' ? 'human-fixture' : `${credential}-fixture`}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function suspendArchive(credential: 'agent' | 'service'): Promise<void> {
  const response = await POST(
    post(credential, {
      rel: 'post:post-welcome',
      action: 'archive',
      params: {},
      actor: 'human',
      principal: 'forged-root',
    }),
  );
  expect(response.status).toBe(202);
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
  auth.resolve.mockClear();
});

describe('production business confirmation approval rejection audit (Red)', () => {
  it.each([
    ['agent', 'approve'],
    ['agent', 'reject'],
    ['service', 'approve'],
    ['service', 'reject'],
  ] as const)(
    'persists a credential-derived rejection when %s attempts confirmation %s',
    async (credential, action) => {
      await suspendArchive(credential);
      const response = await POST(
        post(credential, {
          rel: 'confirmation:c1',
          action,
          params: action === 'reject' ? { reason: 'service cannot decide' } : {},
          actor: 'human',
          principal: 'forged-root',
        }),
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        layer: 'guard-failed',
        reason: expect.stringContaining('actor-is-human'),
      });

      const rejected = (await listEvents(pool)).findLast(
        (event) =>
          event.kind === 'action-rejected' &&
          event.rel === 'confirmation:c1' &&
          event.action === action,
      );
      const expected = auth.identities[credential];
      const expectedDelegation =
        credential === 'agent' ? auth.identities.agent.delegation : undefined;
      expect(rejected).toMatchObject({
        kind: 'action-rejected',
        rel: 'confirmation:c1',
        action,
        actor: 'agent',
        principal: expected.principal,
        channel: 'oidc',
        detail: {
          layer: 'guard-failed',
          identity: {
            authorizationMode: 'credential',
            scopes: expected.scopes,
            // D51:audit identity 不再携带会话冻结 scope;policy 授予在 scopes 内可见。
            humanApprovalEligible: false,
            ...(expectedDelegation === undefined ? {} : { delegation: expectedDelegation }),
          },
        },
      });
    },
  );

  it('rejects a human lacking ui4a:approve before mutating the pending confirmation', async () => {
    await suspendArchive('agent');
    const before = await listEvents(pool);
    const response = await POST(
      post('humanWithoutApproval', {
        rel: 'confirmation:c1',
        action: 'approve',
        params: {},
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'scope_insufficient' },
    });
    expect(await listEvents(pool)).toEqual(before);
  });
});
