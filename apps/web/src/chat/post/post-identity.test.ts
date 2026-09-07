// T55/D75 四段提取:鉴权身份段(post-identity)的模块级测试。
// 深生产链路(exchange/canonical 校验的 HTTP 侧)由 route.production-auth.test.ts
// 与 route.delegated.test.ts 端到端覆盖;本文件钉住段内纯决策语义。
import { describe, expect, it, vi } from 'vitest';

import {
  agentAuthorizationErrorResponse,
  agentCredentialErrorResponse,
  bearerToken,
  buildTurnFetch,
  isCanonicalDelegatedIdentity,
  resolveProductionIdentity,
} from './post-identity';

const HUMAN = {
  actor: 'human' as const,
  principal: 'human-alice',
  humanApprovalEligible: true,
};

async function jsonOf(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

describe('bearerToken', () => {
  it('extracts a Bearer token and rejects other schemes', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken('')).toBeUndefined();
  });
});

describe('agent credential/authorization error responses', () => {
  it('keeps agent_* codes and falls back to a stable endpoint-unavailable code', async () => {
    const kept = agentCredentialErrorResponse({ code: 'agent_token_exchange_failed' });
    expect(kept.status).toBe(503);
    expect(await jsonOf(kept)).toEqual({ error: { code: 'agent_token_exchange_failed' } });

    const fallback = agentCredentialErrorResponse(new Error('boom'));
    expect(await jsonOf(fallback)).toEqual({ error: { code: 'agent_token_endpoint_unavailable' } });

    const denied = agentAuthorizationErrorResponse('agent_scope_exceeded');
    expect(denied.status).toBe(403);
    expect(await jsonOf(denied)).toEqual({ error: { code: 'agent_scope_exceeded' } });
  });
});

describe('isCanonicalDelegatedIdentity', () => {
  const delegatedBase = {
    actor: 'agent' as const,
    humanApprovalEligible: false,
    principal: 'human-alice',
    delegation: {
      subject: 'human-alice',
      actorClientId: 'ui4a-agent',
      source: 'token-exchange-sub-azp',
    },
    scopes: ['ui4a:read', 'ui4a:policy:development'],
  };

  const input = (overrides: Partial<Parameters<typeof isCanonicalDelegatedIdentity>[0]>) =>
    ({
      human: { ...HUMAN },
      delegated: delegatedBase,
      agentClientId: 'ui4a-agent',
      requestedScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
      ...overrides,
    }) as Parameters<typeof isCanonicalDelegatedIdentity>[0];

  it('accepts the canonical token-exchange delegated identity', () => {
    expect(isCanonicalDelegatedIdentity(input({}))).toBe(true);
  });

  it('rejects drifted principal, subject, client, or narrowed requested scopes', () => {
    expect(
      isCanonicalDelegatedIdentity(
        input({ delegated: { ...delegatedBase, principal: 'someone-else' } as never }),
      ),
    ).toBe(false);
    expect(
      isCanonicalDelegatedIdentity(
        input({
          delegated: {
            ...delegatedBase,
            delegation: { ...delegatedBase.delegation, subject: 'x' },
          } as never,
        }),
      ),
    ).toBe(false);
    expect(isCanonicalDelegatedIdentity(input({ agentClientId: 'other-client' }))).toBe(false);
    expect(
      isCanonicalDelegatedIdentity(input({ requestedScopes: ['ui4a:read', 'ui4a:write'] })),
    ).toBe(false);
  });
});

describe('resolveProductionIdentity (local demo profile)', () => {
  it('returns undefined identity for non-production profiles', async () => {
    vi.stubEnv('UI4A_DEPLOYMENT_PROFILE', '');
    const result = await resolveProductionIdentity(new Request('http://localhost:3100/api/chat'));
    expect(result).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe('buildTurnFetch (local demo)', () => {
  it('uses the same local principal for contract reads and writes', async () => {
    const ambient = vi.fn();
    vi.stubGlobal('fetch', ambient);
    const turnFetch = await buildTurnFetch({
      request: new Request('http://localhost:3100/api/chat'),
      mode: 'inline',
      principal: 'user:s1',
    });
    expect(turnFetch).not.toBeInstanceOf(Response);
    if (!(turnFetch instanceof Response)) {
      await turnFetch('http://localhost:3100/api/entity', {});
      expect(ambient).toHaveBeenCalledWith('http://localhost:3100/api/entity', {
        headers: expect.any(Headers),
      });
      expect((ambient.mock.calls[0]?.[1]?.headers as Headers).get('x-ui4a-principal')).toBe(
        'user:s1',
      );
    }
    vi.unstubAllGlobals();
  });
});
