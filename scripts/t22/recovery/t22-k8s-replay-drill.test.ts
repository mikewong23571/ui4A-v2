import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

interface Fingerprint {
  eventHighWaterMark: number;
  eventCount: number;
  eventDigest: string;
  payloadDigest: string;
  runEvidenceDigest: string;
  businessSnapshotHash: string;
  authoritativeHash: string;
  projectionHash: string;
  recomputedReplayHash: string;
}

interface ReplayDrillInput {
  namespace: string;
  webDeployment: { name: 'web'; uid: string; replicas: 1 };
  publicOrigin: string;
  identity: {
    actor: 'agent';
    authorizedParty: 'ui4a-agent';
    businessPolicyScope: 'community';
    draftPolicyScope: 'publishing';
  };
  businessRace: {
    rel: 'comment:c1';
    action: 'approve';
    expectedInitialNode: 'pending';
    expectedTerminalNode: 'approved';
  };
  draftRace: {
    catalogRel: 'meta/drafts';
    target: 'post-status';
    terminalAction: 'abandon';
  };
  preFingerprint: Fingerprint;
  preHwmProbeRef: string;
}

interface ReplayDrillModule {
  planKubernetesReplayDrill(input: ReplayDrillInput): {
    mode: 'single-web-restart-replay';
    destructive: false;
    mutations: {
      business: 'bounded-fixture';
      draft: 'bounded-fixture';
      deployment: 'rollout-restart-only';
    };
    steps: string[];
    rollout: { executable: 'kubectl'; args: string[] };
  };
  executeKubernetesReplayDrill(
    dependencies: {
      authorization(policyScope: string): Promise<string>;
      request(input: {
        url: string;
        method: 'GET' | 'POST';
        authorization: string;
        body?: Record<string, unknown>;
      }): Promise<{ status: number; body: Record<string, unknown> }>;
      captureFingerprint(stage: string): Promise<Fingerprint>;
      readEvents(afterSeq: number): Promise<Array<Record<string, unknown>>>;
      run(command: { executable: string; args: string[] }): Promise<{ exitCode: number }>;
      currentWebPodUid(): Promise<string>;
    },
    input: ReplayDrillInput,
  ): Promise<Record<string, unknown>>;
  buildKubernetesReplayEvidence(input: Record<string, unknown>): Record<string, unknown>;
}

const plannedModulePath = './t22-k8s-replay-drill';
const tokenCanary = '__replay_agent_token_must_not_escape__';
const SHA = `sha256:${'a'.repeat(64)}`;

async function plannedApi(): Promise<ReplayDrillModule> {
  return (await import(plannedModulePath)) as ReplayDrillModule;
}

function fingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    eventHighWaterMark: 100,
    eventCount: 100,
    eventDigest: SHA,
    payloadDigest: SHA,
    runEvidenceDigest: SHA,
    businessSnapshotHash: SHA,
    authoritativeHash: SHA,
    projectionHash: SHA,
    recomputedReplayHash: SHA,
    ...overrides,
  };
}

function drillInput(overrides: Partial<ReplayDrillInput> = {}): ReplayDrillInput {
  return {
    namespace: 'ui4a-system',
    webDeployment: { name: 'web', uid: 'web-deployment-current-uid', replicas: 1 },
    publicOrigin: 'https://ui4a.mothership.internal:32067',
    identity: {
      actor: 'agent',
      authorizedParty: 'ui4a-agent',
      businessPolicyScope: 'community',
      draftPolicyScope: 'publishing',
    },
    businessRace: {
      rel: 'comment:c1',
      action: 'approve',
      expectedInitialNode: 'pending',
      expectedTerminalNode: 'approved',
    },
    draftRace: {
      catalogRel: 'meta/drafts',
      target: 'post-status',
      terminalAction: 'abandon',
    },
    preFingerprint: fingerprint(),
    preHwmProbeRef: 'ui4a-recovery-hwm-before-race',
    ...overrides,
  };
}

function dependencies() {
  return {
    authorization: vi.fn(async () => `Bearer ${tokenCanary}`),
    request: vi.fn(async () => ({ status: 500, body: { error: 'unexpected' } })),
    captureFingerprint: vi.fn(async () => fingerprint()),
    readEvents: vi.fn(async () => []),
    run: vi.fn(async () => ({ exitCode: 0 })),
    currentWebPodUid: vi.fn(async () => 'web-pod-current-uid'),
  };
}

describe('T22 Kubernetes single-Web concurrency, restart and replay drill', () => {
  it('plans only the bounded business/Draft fixtures and exact Web rollout restart', async () => {
    const { planKubernetesReplayDrill } = await plannedApi();

    expect(planKubernetesReplayDrill(drillInput())).toEqual({
      mode: 'single-web-restart-replay',
      destructive: false,
      mutations: {
        business: 'bounded-fixture',
        draft: 'bounded-fixture',
        deployment: 'rollout-restart-only',
      },
      steps: [
        'capture-pre-fingerprint-and-hwm',
        'verify-business-fixture',
        'race-business-action',
        'verify-business-winner-and-audited-loser',
        'create-agent-owned-draft-fixture',
        'race-draft-terminal-action',
        'verify-draft-winner-and-audited-loser',
        'capture-before-restart-fingerprint',
        'rollout-restart-single-web',
        'wait-web-ready',
        'capture-after-restart-fingerprint',
        'verify-event-order-projection-and-replay',
      ],
      rollout: {
        executable: 'kubectl',
        args: ['--namespace', 'ui4a-system', 'rollout', 'restart', 'deployment/web'],
      },
    });
  });

  it('defines an agent-only business race with one 200 winner and one audited 400 loser', async () => {
    const { buildKubernetesReplayEvidence } = await plannedApi();

    expect(
      buildKubernetesReplayEvidence({
        plan: planFixture(),
        business: {
          rel: 'comment:c1',
          action: 'approve',
          statuses: [200, 400],
          terminalNode: 'approved',
          events: [
            { seq: 101, kind: 'action-executed', actor: 'agent', azp: 'ui4a-agent' },
            { seq: 102, kind: 'action-rejected', actor: 'agent', azp: 'ui4a-agent' },
          ],
        },
      }),
    ).toMatchObject({
      business: {
        winnerCount: 1,
        loserCount: 1,
        auditedLoserCount: 1,
        statuses: [200, 400],
        terminalNode: 'approved',
      },
    });
  });

  it('defines an agent-owned Draft abandon race with one terminal winner and audited loser', async () => {
    const { buildKubernetesReplayEvidence } = await plannedApi();

    expect(
      buildKubernetesReplayEvidence({
        plan: planFixture(),
        draft: {
          action: 'abandon',
          statuses: [200, 422],
          terminalStatus: 'abandoned',
          events: [
            { seq: 104, kind: 'draft-abandoned', actor: 'agent', azp: 'ui4a-agent' },
            { seq: 105, kind: 'action-rejected', actor: 'agent', azp: 'ui4a-agent' },
          ],
        },
      }),
    ).toMatchObject({
      draft: {
        winnerCount: 1,
        loserCount: 1,
        auditedLoserCount: 1,
        statuses: [200, 422],
        terminalStatus: 'abandoned',
      },
    });
  });

  it('requires a new Web Pod and identical before/after restart authority, projection and replay', async () => {
    const { buildKubernetesReplayEvidence } = await plannedApi();
    const beforeRestart = fingerprint({ eventHighWaterMark: 105, eventCount: 105 });
    const afterRestart = fingerprint({ eventHighWaterMark: 105, eventCount: 105 });

    expect(
      buildKubernetesReplayEvidence({
        plan: planFixture(),
        restart: { beforePodUid: 'web-pod-before', afterPodUid: 'web-pod-after' },
        pre: fingerprint(),
        beforeRestart,
        afterRestart,
      }),
    ).toMatchObject({
      restart: { podReplaced: true },
      replay: {
        eventHighWaterMarkStableAcrossRestart: true,
        authorityMatch: true,
        projectionMatch: true,
        recomputedReplayHashMatch: true,
      },
    });
  });

  it('fails preflight before token, HTTP or rollout and never returns credential material', async () => {
    const { executeKubernetesReplayDrill } = await plannedApi();
    const deps = dependencies();

    const result = await executeKubernetesReplayDrill(deps, {
      ...drillInput(),
      webDeployment: { name: 'web', uid: '', replicas: 1 },
    });

    expect(result).toEqual({ ok: false, code: 'K8S_REPLAY_PREFLIGHT_FAILED' });
    expect(deps.authorization).not.toHaveBeenCalled();
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.captureFingerprint).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(tokenCanary);
  });

  it('exposes the existing Draft abandon terminal-race audit debt separately from operator work', () => {
    const source = readFileSync(resolve('apps/web/src/engine/drafts/execute.ts'), 'utf8');
    const helpersSource = readFileSync(resolve('apps/web/src/engine/drafts/helpers.ts'), 'utf8');
    const start = source.indexOf("} else if (request.action === 'abandon') {");
    const end = source.indexOf('\n  } else {', start);
    const abandonBranch = source.slice(start, end);

    expect(start).toBeGreaterThan(0);
    expect(abandonBranch).toContain('concurrentDecisionRejection');
    expect(helpersSource).toMatch(
      /async function concurrentDecisionRejection[\s\S]+await rejectionEvent\(db, request, outcome\)/,
    );
  });
});

function planFixture() {
  return {
    mode: 'single-web-restart-replay',
    namespace: 'ui4a-system',
    identity: { actor: 'agent', authorizedParty: 'ui4a-agent' },
  };
}
