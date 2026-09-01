import { describe, expect, it } from 'vitest';

import {
  buildProductionRequestIdentity,
  type ProductionCredentialPolicy,
  type VerifiedCredential,
} from './request-identity';

const policy: ProductionCredentialPolicy = {
  issuer: 'https://auth.ui4a.example/realms/ui4a',
  audience: 'ui4a-api',
  algorithms: ['RS256'],
  humanClientIds: ['ui4a-web'],
  agentClientIds: ['ui4a-agent', 'ui4a-cli'],
  delegatedScopesByClient: {
    'ui4a-agent': ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
    'ui4a-cli': ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
  },
  agentCredentialSourcesByClient: {
    'ui4a-agent': 'token-exchange-sub-azp',
    'ui4a-cli': 'device-authorization-sub-azp',
  },
};

function credential(scope: string): VerifiedCredential {
  return {
    claims: {
      sub: 'user-mike-id',
      azp: 'ui4a-cli',
      scope,
    },
    header: { alg: 'RS256', kid: 'test-key' },
  };
}

describe('CLI Device credential identity', () => {
  it('projects a Device-authorized CLI token as an Agent with sub plus azp provenance', () => {
    expect(
      buildProductionRequestIdentity(
        credential('openid ui4a:read ui4a:write ui4a:policy:development offline_access'),
        { requiredScopes: ['ui4a:write'] },
        policy,
      ),
    ).toEqual({
      actor: 'agent',
      kind: 'agent',
      principal: 'user-mike-id',
      scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
      humanApprovalEligible: false,
      delegation: {
        subject: 'user-mike-id',
        actorClientId: 'ui4a-cli',
        source: 'device-authorization-sub-azp',
      },
    });
  });

  it('rejects approve even when a signed CLI token contains it', () => {
    expect(() =>
      buildProductionRequestIdentity(
        credential('ui4a:read ui4a:write ui4a:approve ui4a:policy:development'),
        { requiredScopes: ['ui4a:read'] },
        policy,
      ),
    ).toThrow(expect.objectContaining({ code: 'delegation_scope_exceeded' }));
  });
});
