import { describe, expect, it } from 'vitest';

import {
  computeEffectiveAgentGrants,
  decideRunGrantApproval,
  resolveAgentRuntimeProfile,
  type AgentGrantSet,
  type AgentRuntimeProfile,
} from './runtime-policy';

const profiles: AgentRuntimeProfile[] = [
  {
    ref: 'runtime:general-prod',
    version: 3,
    runtimeClass: 'general-agent',
    features: ['streaming', 'structured-output'],
    tools: ['read', 'write'],
    resourceBackends: ['entity', 'document'],
    providerAdapterRef: 'adapter:codex@1',
    available: true,
  },
  {
    ref: 'runtime:workspace-prod',
    version: 1,
    runtimeClass: 'workspace-agent',
    features: ['shell'],
    tools: ['shell'],
    resourceBackends: ['repository'],
    providerAdapterRef: 'adapter:workspace@1',
    available: true,
  },
];

describe('Agent Runtime Profile policy', () => {
  it('resolves only the exact server-selected profile with feature provenance', () => {
    expect(
      resolveAgentRuntimeProfile({
        requirement: { runtimeClass: 'general-agent', requiredFeatures: ['streaming'] },
        policyProfile: { ref: 'runtime:general-prod', version: 3 },
        profiles,
      }),
    ).toEqual({
      ok: true,
      profile: profiles[0],
      provenance: {
        profileRef: 'runtime:general-prod',
        profileVersion: 3,
        runtimeClass: 'general-agent',
        providerAdapterRef: 'adapter:codex@1',
        negotiatedFeatures: ['streaming'],
      },
    });
  });

  it('has no class/feature/version fallback', () => {
    expect(
      resolveAgentRuntimeProfile({
        requirement: { runtimeClass: 'general-agent', requiredFeatures: ['browser'] },
        policyProfile: { ref: 'runtime:general-prod', version: 3 },
        profiles,
      }),
    ).toMatchObject({ ok: false, code: 'runtime-feature-mismatch' });
    expect(
      resolveAgentRuntimeProfile({
        requirement: { runtimeClass: 'general-agent', requiredFeatures: [] },
        policyProfile: { ref: 'runtime:general-prod', version: 99 },
        profiles,
      }),
    ).toMatchObject({ ok: false, code: 'runtime-profile-missing' });
    expect(
      resolveAgentRuntimeProfile({
        requirement: { runtimeClass: 'general-agent', requiredFeatures: [] },
        policyProfile: { ref: 'runtime:workspace-prod', version: 1 },
        profiles,
      }),
    ).toMatchObject({ ok: false, code: 'runtime-class-mismatch' });
  });

  it.each(['provider', 'profile', 'model', 'sandbox', 'cwd', 'tools'])(
    'rejects the request-side %s override before resolution',
    (key) => {
      expect(
        resolveAgentRuntimeProfile({
          requirement: { runtimeClass: 'general-agent', requiredFeatures: [] },
          policyProfile: { ref: 'runtime:general-prod', version: 3 },
          profiles,
          requestOverrides: { [key]: 'attacker-choice' },
        }),
      ).toMatchObject({ ok: false, code: 'runtime-request-override-forbidden' });
    },
  );
});

const application: AgentGrantSet = {
  tools: ['read', 'write'],
  resources: [
    { category: 'entity', resourceRef: 'post:first', permissions: ['read', 'write'] },
    { category: 'document', resourceRef: 'doc:brief', permissions: ['read'] },
  ],
  contextSources: ['entity', 'document'],
  artifactMediaTypes: ['text/plain', 'text/markdown'],
};

const principal: AgentGrantSet = {
  tools: ['read'],
  resources: [
    { category: 'entity', resourceRef: 'post:first', permissions: ['read'] },
    { category: 'entity', resourceRef: 'post:other', permissions: ['read'] },
  ],
  contextSources: ['entity'],
  artifactMediaTypes: ['text/plain'],
};

describe('effective Agent grants', () => {
  it('allows a run grant only when it is a subset of every upper policy layer', () => {
    expect(
      decideRunGrantApproval({
        requested: {
          tools: ['write'],
          resources: [],
          contextSources: [],
          artifactMediaTypes: [],
        },
        definition: {
          tools: ['read', 'write'],
          resourceCategories: ['entity'],
          contextSources: ['entity'],
          artifactMediaTypes: ['text/plain'],
        },
        application,
        principal,
      }),
    ).toEqual({ allowed: false, reason: 'tools exceed the effective upper grant ceiling: write' });
  });

  it('intersects definition, application, principal, and active run approval exactly', () => {
    const result = computeEffectiveAgentGrants({
      definition: {
        tools: ['read', 'write', 'shell'],
        resourceCategories: ['entity', 'document'],
        contextSources: ['entity', 'document'],
        artifactMediaTypes: ['text/plain', 'text/markdown'],
      },
      application,
      principal,
      nowEpochMs: 100,
      approvalEvents: [
        {
          type: 'approved',
          grantId: 'grant:1',
          atEpochMs: 10,
          expiresAtEpochMs: 200,
          grants: {
            tools: ['read', 'write'],
            resources: [
              { category: 'entity', resourceRef: 'post:first', permissions: ['read', 'write'] },
            ],
            contextSources: ['entity', 'document'],
            artifactMediaTypes: ['text/plain', 'text/markdown'],
          },
        },
      ],
    });

    expect(result.grants).toEqual({
      tools: ['read'],
      resources: [{ category: 'entity', resourceRef: 'post:first', permissions: ['read'] }],
      contextSources: ['entity'],
      artifactMediaTypes: ['text/plain'],
    });
    expect(result.activeGrantIds).toEqual(['grant:1']);
  });

  it('replays revocation and expiry so withdrawn grants project no tools or resources', () => {
    const approved = {
      type: 'approved' as const,
      grantId: 'grant:1',
      atEpochMs: 10,
      expiresAtEpochMs: 200,
      grants: principal,
    };
    const revoked = computeEffectiveAgentGrants({
      definition: {
        tools: ['read'],
        resourceCategories: ['entity'],
        contextSources: ['entity'],
        artifactMediaTypes: ['text/plain'],
      },
      application,
      principal,
      nowEpochMs: 100,
      approvalEvents: [approved, { type: 'revoked', grantId: 'grant:1', atEpochMs: 50 }],
    });
    const expired = computeEffectiveAgentGrants({
      definition: {
        tools: ['read'],
        resourceCategories: ['entity'],
        contextSources: ['entity'],
        artifactMediaTypes: ['text/plain'],
      },
      application,
      principal,
      nowEpochMs: 201,
      approvalEvents: [approved],
    });

    expect(revoked).toMatchObject({ activeGrantIds: [], grants: { tools: [], resources: [] } });
    expect(expired).toMatchObject({ activeGrantIds: [], grants: { tools: [], resources: [] } });
  });

  it('takes the narrowest quantitative ceiling and does not replay future approvals', () => {
    const result = computeEffectiveAgentGrants({
      definition: {
        tools: ['read'],
        resourceCategories: ['entity'],
        contextSources: ['entity'],
        artifactMediaTypes: ['text/plain'],
        limits: { contextMaxItems: 20, artifactMaxCount: 10, artifactMaxBytes: 10_000 },
      },
      application: {
        ...application,
        limits: { contextMaxItems: 8, artifactMaxCount: 6, artifactMaxBytes: 8_000 },
      },
      principal: {
        ...principal,
        limits: { contextMaxItems: 5, artifactMaxCount: 4, artifactMaxBytes: 6_000 },
      },
      nowEpochMs: 100,
      approvalEvents: [
        {
          type: 'approved',
          grantId: 'grant:future',
          atEpochMs: 101,
          grants: {
            ...principal,
            limits: { contextMaxItems: 3, artifactMaxCount: 2, artifactMaxBytes: 4_000 },
          },
        },
      ],
    });
    expect(result.activeGrantIds).toEqual([]);
    expect(result.grants).toEqual({
      tools: [],
      resources: [],
      contextSources: [],
      artifactMediaTypes: [],
      limits: { contextMaxItems: 5, artifactMaxCount: 4, artifactMaxBytes: 6_000 },
    });
  });
});
