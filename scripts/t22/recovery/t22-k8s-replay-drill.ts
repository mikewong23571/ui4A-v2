export interface ReplayFingerprint {
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

export interface KubernetesReplayDrillInput {
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
  preFingerprint: ReplayFingerprint;
  preHwmProbeRef: string;
}

export interface ReplayRequest {
  url: string;
  method: 'GET' | 'POST';
  authorization: string;
  body?: Record<string, unknown>;
}

export interface KubernetesReplayDrillDependencies {
  authorization(policyScope: string): Promise<string>;
  request(input: ReplayRequest): Promise<{ status: number; body: Record<string, unknown> }>;
  captureFingerprint(stage: string): Promise<ReplayFingerprint>;
  readEvents(afterSeq: number): Promise<Array<Record<string, unknown>>>;
  run(command: { executable: string; args: string[] }): Promise<{ exitCode: number }>;
  currentWebPodUid(): Promise<string>;
}

export interface KubernetesReplayPlan {
  mode: 'single-web-restart-replay';
  destructive: false;
  mutations: {
    business: 'bounded-fixture';
    draft: 'bounded-fixture';
    deployment: 'rollout-restart-only';
  };
  steps: string[];
  rollout: { executable: 'kubectl'; args: string[] };
}

type JsonRecord = Record<string, unknown>;

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const steps = [
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
] as const;

function object(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function validFingerprint(value: ReplayFingerprint): boolean {
  return (
    Number.isSafeInteger(value.eventHighWaterMark) &&
    value.eventHighWaterMark >= 0 &&
    Number.isSafeInteger(value.eventCount) &&
    value.eventCount >= 0 &&
    [
      value.eventDigest,
      value.payloadDigest,
      value.runEvidenceDigest,
      value.businessSnapshotHash,
      value.authoritativeHash,
      value.projectionHash,
      value.recomputedReplayHash,
    ].every((digest) => digestPattern.test(digest))
  );
}

function validInput(input: KubernetesReplayDrillInput): boolean {
  let origin: URL;
  try {
    origin = new URL(input.publicOrigin);
  } catch {
    return false;
  }
  return (
    input.namespace === 'ui4a-system' &&
    input.webDeployment.name === 'web' &&
    input.webDeployment.uid.length > 0 &&
    input.webDeployment.replicas === 1 &&
    origin.protocol === 'https:' &&
    origin.username === '' &&
    origin.password === '' &&
    origin.pathname === '/' &&
    origin.search === '' &&
    origin.hash === '' &&
    input.identity.actor === 'agent' &&
    input.identity.authorizedParty === 'ui4a-agent' &&
    input.identity.businessPolicyScope === 'community' &&
    input.identity.draftPolicyScope === 'publishing' &&
    input.businessRace.rel === 'comment:c1' &&
    input.businessRace.action === 'approve' &&
    input.businessRace.expectedInitialNode === 'pending' &&
    input.businessRace.expectedTerminalNode === 'approved' &&
    input.draftRace.catalogRel === 'meta/drafts' &&
    input.draftRace.target === 'post-status' &&
    input.draftRace.terminalAction === 'abandon' &&
    /^ui4a-recovery-hwm-[a-z0-9-]+$/.test(input.preHwmProbeRef) &&
    validFingerprint(input.preFingerprint)
  );
}

/** Plan the only bounded fixture and rollout sequence accepted by the experimental drill. */
export function planKubernetesReplayDrill(input: KubernetesReplayDrillInput): KubernetesReplayPlan {
  if (!validInput(input)) throw new Error('K8S_REPLAY_PREFLIGHT_FAILED');
  return {
    mode: 'single-web-restart-replay',
    destructive: false,
    mutations: {
      business: 'bounded-fixture',
      draft: 'bounded-fixture',
      deployment: 'rollout-restart-only',
    },
    steps: [...steps],
    rollout: {
      executable: 'kubectl',
      args: ['--namespace', input.namespace, 'rollout', 'restart', 'deployment/web'],
    },
  };
}

function statuses(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((status) => Number.isInteger(status))
    ? (value as number[])
    : undefined;
}

function eventRows(value: unknown): JsonRecord[] | undefined {
  return Array.isArray(value) && value.every((event) => object(event) !== undefined)
    ? (value as JsonRecord[])
    : undefined;
}

function orderedAgentEvents(events: JsonRecord[], expectedKinds: readonly string[]): boolean {
  if (events.length !== expectedKinds.length) return false;
  return events.every(
    (event, index) =>
      event.kind === expectedKinds[index] &&
      (event.kind === 'draft-abandoned' || event.actor === 'agent') &&
      Number.isSafeInteger(event.seq) &&
      (index === 0 || Number(event.seq) > Number(events[index - 1]!.seq)),
  );
}

function businessEvidence(value: unknown): JsonRecord {
  const input = object(value);
  const observedStatuses = statuses(input?.statuses);
  const events = eventRows(input?.events);
  if (
    input === undefined ||
    observedStatuses === undefined ||
    events === undefined ||
    input.rel !== 'comment:c1' ||
    input.action !== 'approve' ||
    input.terminalNode !== 'approved' ||
    observedStatuses.filter((status) => status === 200).length !== 1 ||
    observedStatuses.filter((status) => status === 400).length !== 1 ||
    !orderedAgentEvents(events, ['action-executed', 'action-rejected'])
  ) {
    throw new Error('K8S_REPLAY_BUSINESS_EVIDENCE_INVALID');
  }
  return {
    winnerCount: 1,
    loserCount: 1,
    auditedLoserCount: 1,
    statuses: [...observedStatuses],
    terminalNode: 'approved',
  };
}

function draftEvidence(value: unknown): JsonRecord {
  const input = object(value);
  const observedStatuses = statuses(input?.statuses);
  const events = eventRows(input?.events);
  if (
    input === undefined ||
    observedStatuses === undefined ||
    events === undefined ||
    input.action !== 'abandon' ||
    input.terminalStatus !== 'abandoned' ||
    observedStatuses.filter((status) => status === 200).length !== 1 ||
    observedStatuses.filter((status) => status === 422).length !== 1 ||
    !orderedAgentEvents(events, ['draft-abandoned', 'action-rejected'])
  ) {
    throw new Error('K8S_REPLAY_DRAFT_EVIDENCE_INVALID');
  }
  return {
    winnerCount: 1,
    loserCount: 1,
    auditedLoserCount: 1,
    statuses: [...observedStatuses],
    terminalStatus: 'abandoned',
  };
}

function replayEvidence(value: JsonRecord): { restart: JsonRecord; replay: JsonRecord } {
  const restart = object(value.restart);
  const before = object(value.beforeRestart) as ReplayFingerprint | undefined;
  const after = object(value.afterRestart) as ReplayFingerprint | undefined;
  if (
    restart === undefined ||
    typeof restart.beforePodUid !== 'string' ||
    typeof restart.afterPodUid !== 'string' ||
    restart.beforePodUid === '' ||
    restart.afterPodUid === '' ||
    restart.beforePodUid === restart.afterPodUid ||
    before === undefined ||
    after === undefined ||
    !validFingerprint(before) ||
    !validFingerprint(after)
  ) {
    throw new Error('K8S_REPLAY_RESTART_EVIDENCE_INVALID');
  }
  const stableHwm = before.eventHighWaterMark === after.eventHighWaterMark;
  const authorityMatch = before.authoritativeHash === after.authoritativeHash;
  const projectionMatch = before.projectionHash === after.projectionHash;
  const replayHashMatch = before.recomputedReplayHash === after.recomputedReplayHash;
  if (!stableHwm || !authorityMatch || !projectionMatch || !replayHashMatch) {
    throw new Error('K8S_REPLAY_RESTART_EVIDENCE_INVALID');
  }
  return {
    restart: { podReplaced: true },
    replay: {
      eventHighWaterMarkStableAcrossRestart: stableHwm,
      authorityMatch,
      projectionMatch,
      recomputedReplayHashMatch: replayHashMatch,
    },
  };
}

/** Normalize bounded race and restart observations into Secret-free mechanical evidence. */
export function buildKubernetesReplayEvidence(input: Record<string, unknown>): JsonRecord {
  const evidence: JsonRecord = {};
  if (input.business !== undefined) evidence.business = businessEvidence(input.business);
  if (input.draft !== undefined) evidence.draft = draftEvidence(input.draft);
  if (
    input.restart !== undefined ||
    input.beforeRestart !== undefined ||
    input.afterRestart !== undefined
  ) {
    Object.assign(evidence, replayEvidence(input));
  }
  if (Object.keys(evidence).length === 0) throw new Error('K8S_REPLAY_EVIDENCE_INVALID');
  return evidence;
}

function authorization(value: string): string {
  if (!value.startsWith('Bearer ') || value.length <= 'Bearer '.length) {
    throw new Error('K8S_REPLAY_AUTH_INVALID');
  }
  return value;
}

function sameFingerprint(left: ReplayFingerprint, right: ReplayFingerprint): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function responseEntity(response: { status: number; body: JsonRecord }): JsonRecord | undefined {
  return object(response.body.entity);
}

/** Execute the bounded live sequence only through injected auth, HTTP, DB evidence and kubectl ports. */
export async function executeKubernetesReplayDrill(
  dependencies: KubernetesReplayDrillDependencies,
  input: KubernetesReplayDrillInput,
): Promise<Record<string, unknown>> {
  let plan: KubernetesReplayPlan;
  try {
    plan = planKubernetesReplayDrill(input);
  } catch {
    return { ok: false, code: 'K8S_REPLAY_PREFLIGHT_FAILED' };
  }
  try {
    const capturedPre = await dependencies.captureFingerprint('pre-race');
    if (!sameFingerprint(capturedPre, input.preFingerprint)) {
      throw new Error('K8S_REPLAY_PRE_FINGERPRINT_CHANGED');
    }
    const [businessAuthorization, draftAuthorization] = await Promise.all([
      dependencies.authorization(input.identity.businessPolicyScope),
      dependencies.authorization(input.identity.draftPolicyScope),
    ]).then((headers) => headers.map(authorization));
    const businessUrl = `${input.publicOrigin}/api/entity?rel=comment%3Ac1`;
    const businessFixture = await dependencies.request({
      url: businessUrl,
      method: 'GET',
      authorization: businessAuthorization,
    });
    const fixtureProperties = object(businessFixture.body.properties);
    const fixtureActions = Array.isArray(businessFixture.body.actions)
      ? businessFixture.body.actions.map(object)
      : [];
    if (
      businessFixture.status !== 200 ||
      fixtureProperties?.node !== input.businessRace.expectedInitialNode ||
      !fixtureActions.some((action) => action?.name === input.businessRace.action)
    ) {
      throw new Error('K8S_REPLAY_BUSINESS_FIXTURE_INVALID');
    }
    const businessResponses = await Promise.all(
      ['a', 'b'].map(() =>
        dependencies.request({
          url: `${input.publicOrigin}/api/exec`,
          method: 'POST',
          authorization: businessAuthorization,
          body: { rel: input.businessRace.rel, action: input.businessRace.action, params: {} },
        }),
      ),
    );
    const draftCreate = await dependencies.request({
      url: `${input.publicOrigin}/_meta/api/exec`,
      method: 'POST',
      authorization: draftAuthorization,
      body: {
        rel: input.draftRace.catalogRel,
        action: 'create',
        params: {
          kind: 'flow-definition',
          target: input.draftRace.target,
          commandId: `replay-drill-create-${input.preFingerprint.eventHighWaterMark}`,
          payload: { name: input.draftRace.target },
        },
      },
    });
    const draftProperties = object(responseEntity(draftCreate)?.properties);
    if (draftCreate.status !== 200 || typeof draftProperties?.rel !== 'string') {
      throw new Error('K8S_REPLAY_DRAFT_FIXTURE_INVALID');
    }
    const draftResponses = await Promise.all(
      ['a', 'b'].map((suffix) =>
        dependencies.request({
          url: `${input.publicOrigin}/_meta/api/exec`,
          method: 'POST',
          authorization: draftAuthorization,
          body: {
            rel: draftProperties.rel,
            action: input.draftRace.terminalAction,
            params: {
              commandId: `replay-drill-abandon-${suffix}-${input.preFingerprint.eventHighWaterMark}`,
              reason: `bounded replay race ${suffix}`,
            },
          },
        }),
      ),
    );
    const events = await dependencies.readEvents(input.preFingerprint.eventHighWaterMark);
    const beforeRestart = await dependencies.captureFingerprint('before-restart');
    const beforePodUid = await dependencies.currentWebPodUid();
    const rollout = await dependencies.run({
      executable: plan.rollout.executable,
      args: [...plan.rollout.args],
    });
    if (rollout.exitCode !== 0) throw new Error('K8S_REPLAY_ROLLOUT_FAILED');
    const ready = await dependencies.run({
      executable: 'kubectl',
      args: [
        '--namespace',
        input.namespace,
        'rollout',
        'status',
        'deployment/web',
        '--timeout=120s',
      ],
    });
    if (ready.exitCode !== 0) throw new Error('K8S_REPLAY_ROLLOUT_FAILED');
    const afterPodUid = await dependencies.currentWebPodUid();
    const afterRestart = await dependencies.captureFingerprint('after-restart');

    const businessEvents = events.filter(
      (event) => event.rel === input.businessRace.rel && event.action === input.businessRace.action,
    );
    const draftEvents = events.filter(
      (event) =>
        event.rel === draftProperties.rel &&
        (event.kind === 'draft-abandoned' || event.action === input.draftRace.terminalAction),
    );
    const businessWinner =
      businessResponses.find(({ status }) => status === 200) ?? businessResponses[0]!;
    const businessWinnerProperties = object(responseEntity(businessWinner)?.properties);
    const evidence = buildKubernetesReplayEvidence({
      plan,
      business: {
        rel: input.businessRace.rel,
        action: input.businessRace.action,
        statuses: businessResponses.map(({ status }) => status),
        terminalNode: businessWinnerProperties?.node,
        events: businessEvents,
      },
      draft: {
        action: input.draftRace.terminalAction,
        statuses: draftResponses.map(({ status }) => status),
        terminalStatus: 'abandoned',
        events: draftEvents,
      },
      restart: { beforePodUid, afterPodUid },
      pre: capturedPre,
      beforeRestart,
      afterRestart,
    });
    return { ok: true, code: 'K8S_REPLAY_DRILL_COMPLETED', evidence };
  } catch {
    return { ok: false, code: 'K8S_REPLAY_DRILL_FAILED' };
  }
}
