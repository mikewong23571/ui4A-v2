import type { ProductionDeploymentConfig } from '@ui4a/shared';
import { describe, expect, it } from 'vitest';

import {
  browserLoginPolicyScopes,
  computeActivationDisclosure,
  type ActivationDisclosureInput,
} from './activation-disclosure';

const GOVERNANCE_SCOPE = 'ui4a:policy:governance';

function input(overrides: Partial<ActivationDisclosureInput> = {}): ActivationDisclosureInput {
  return {
    newApplications: ['todo'],
    grantedApplications: ['development'],
    tokenScopes: ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
    browserLoginScopes: undefined,
    ...overrides,
  };
}

describe('computeActivationDisclosure', () => {
  it('returns undefined when no new applications were installed', () => {
    expect(computeActivationDisclosure(input({ newApplications: [] }))).toBeUndefined();
  });

  it('marks applications already in the effective grant set as immediately visible', () => {
    const disclosure = computeActivationDisclosure(input({ grantedApplications: ['development', 'todo'] }));
    expect(disclosure).toBeDefined();
    expect(disclosure!.applications).toEqual([{ application: 'todo', outcome: 'immediately-visible' }]);
    // 立即可见分支无恢复需求;授予集合原样回显供面板对照。
    expect(disclosure!.grantedApplications).toEqual(['development', 'todo']);
    expect(disclosure!.governanceExpansion).toBe(false);
    expect(disclosure!.browserLoginScopes).toBeUndefined();
  });

  it('marks governance-expanded sessions as immediately visible with expansion provenance', () => {
    const disclosure = computeActivationDisclosure(
      input({
        grantedApplications: ['development', 'governance', 'todo'],
        tokenScopes: ['ui4a:write', 'ui4a:approve', 'ui4a:policy:development', GOVERNANCE_SCOPE],
      }),
    );
    expect(disclosure!.applications).toEqual([{ application: 'todo', outcome: 'immediately-visible' }]);
    expect(disclosure!.governanceExpansion).toBe(true);
  });

  it('recommends relogin when governance is in the runtime browser login scopes', () => {
    const disclosure = computeActivationDisclosure(
      input({
        browserLoginScopes: ['openid', 'ui4a:read', 'ui4a:write', 'ui4a:approve', GOVERNANCE_SCOPE],
      }),
    );
    expect(disclosure!.applications).toEqual([{ application: 'todo', outcome: 'visible-after-relogin' }]);
    expect(disclosure!.browserLoginScopes).toEqual([
      'openid',
      'ui4a:read',
      'ui4a:write',
      'ui4a:approve',
      GOVERNANCE_SCOPE,
    ]);
    expect(disclosure!.governanceExpansion).toBe(false);
  });

  it('requires an IdP grant when governance is absent from the browser login scopes', () => {
    const disclosure = computeActivationDisclosure(
      input({
        browserLoginScopes: ['openid', 'ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
      }),
    );
    expect(disclosure!.applications).toEqual([{ application: 'todo', outcome: 'requires-idp-grant' }]);
  });

  it('classifies a mixed installation per application in deterministic order', () => {
    const disclosure = computeActivationDisclosure(
      input({
        newApplications: ['ideas', 'todo'],
        grantedApplications: ['development', 'ideas'],
        browserLoginScopes: ['openid', 'ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
      }),
    );
    expect(disclosure!.applications).toEqual([
      { application: 'ideas', outcome: 'immediately-visible' },
      { application: 'todo', outcome: 'requires-idp-grant' },
    ]);
  });

  it('deduplicates grant echoes and keeps disclosure stable', () => {
    const disclosure = computeActivationDisclosure(
      input({ grantedApplications: ['development', 'development', 'todo'] }),
    );
    expect(disclosure!.grantedApplications).toEqual(['development', 'todo']);
  });

  it('falls back to requires-idp-grant outside credential mode when an app is unreachable', () => {
    // local 模式授予集合=已安装全集,该分支防御性存在:不可达即无重登可修路径。
    const disclosure = computeActivationDisclosure(
      input({ grantedApplications: [], tokenScopes: [] }),
    );
    expect(disclosure!.applications).toEqual([{ application: 'todo', outcome: 'requires-idp-grant' }]);
  });
});

describe('browserLoginPolicyScopes', () => {
  it('returns undefined outside the production profile', () => {
    expect(
      browserLoginPolicyScopes({ environment: { UI4A_DEPLOYMENT_PROFILE: 'local' } as NodeJS.ProcessEnv }),
    ).toBeUndefined();
  });

  it('returns the configured browser login scopes in production', () => {
    const config = {
      settings: { auth: { oidc: { scopes: ['openid', 'ui4a:read', GOVERNANCE_SCOPE] } } },
    } as unknown as ProductionDeploymentConfig;
    const scopes = browserLoginPolicyScopes({
      environment: { UI4A_DEPLOYMENT_PROFILE: 'production' } as NodeJS.ProcessEnv,
      productionConfig: config,
    });
    expect(scopes).toEqual(['openid', 'ui4a:read', GOVERNANCE_SCOPE]);
  });
});
