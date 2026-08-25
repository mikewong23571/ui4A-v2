const environments = ['kubernetes', 'compose'] as const;
const targets = [
  'llm',
  'temporal',
  'keycloak-jwks',
  'postgresql',
  'kubernetes-runtime',
  'host-runner',
] as const;

type Environment = (typeof environments)[number];
type FaultTarget = (typeof targets)[number];
type Gate = 'after-golden' | 'after-verified-backup';

export interface FaultDefinition {
  id: `${Environment}:${FaultTarget}`;
  environment: Environment;
  target: FaultTarget;
  gate: Gate;
  preState: {
    requiredFields: string[];
    requireZeroActiveRuns: boolean;
  };
  injection: {
    kind: string;
    singleMutation: true;
    reversible: true;
  };
  duringFault: {
    readiness: 'not-ready' | 'degraded';
    business: 'honest-failure';
    readOnly: 'available' | 'bounded-existing-session-only' | 'unavailable';
    falseSuccesses: 0;
    unauthorizedSideEffects: 0;
  };
  recovery: {
    restoreInFinally: true;
    requireSameUidOrDeclaredReplacement: true;
    requireReplicaAndReadinessEquality: true;
    retry: 'same-command-once';
    cas: 'must-remain-enforced';
  };
  evidencePolicy: {
    secretMaterial: 'forbidden';
    rawErrorMessage: 'forbidden';
  };
}

export interface FaultState {
  uid: string;
  desiredReplicas: number;
  readyReplicas: number;
  readiness: string;
  businessFingerprint: string;
  eventHighWaterMark: number;
  activeRuns: number;
  replacement?: { previousUid: string; reasonCode: string };
}

export interface FaultHooks {
  capturePreState(definition: FaultDefinition): Promise<FaultState>;
  inject(definition: FaultDefinition): Promise<{ mutationCount: 1; receipt: string }>;
  assertDuringFault(definition: FaultDefinition): Promise<{
    falseSuccesses: 0;
    unauthorizedSideEffects: 0;
    readiness: 'not-ready' | 'degraded';
  }>;
  restore(definition: FaultDefinition): Promise<void>;
  capturePostState(definition: FaultDefinition): Promise<FaultState>;
  retryWithCas(definition: FaultDefinition): Promise<{
    attempts: 1;
    casEnforced: true;
    status: 'succeeded' | 'honest-rejection';
  }>;
}

export interface FaultEvidence {
  schemaVersion: 1;
  scenarioId: string;
  restored: true;
  preState: FaultState;
  postState: FaultState;
  falseSuccesses: 0;
  unauthorizedSideEffects: 0;
  retry: { attempts: 1; casEnforced: true; status: string };
}

const requiredPreStateFields = [
  'uid',
  'desiredReplicas',
  'readyReplicas',
  'readiness',
  'businessFingerprint',
  'eventHighWaterMark',
  'activeRuns',
];

const injections = {
  'kubernetes:llm': 'apply-runner-egress-deny-policy',
  'kubernetes:temporal': 'scale-temporal-deployment-to-zero',
  'kubernetes:keycloak-jwks': 'scale-keycloak-deployment-to-zero',
  'kubernetes:postgresql': 'scale-postgres-statefulset-to-zero',
  'kubernetes:kubernetes-runtime': 'remove-worker-job-create-rbac',
  'kubernetes:host-runner': 'stop-registered-host-runner',
  'compose:llm': 'stop-server-owned-llm-fault-proxy',
  'compose:temporal': 'stop-temporal-service',
  'compose:keycloak-jwks': 'stop-keycloak-service',
  'compose:postgresql': 'stop-postgres-service',
  'compose:host-runner': 'stop-host-runner-service',
} as const;

function targetFromId(id: keyof typeof injections): FaultTarget {
  return id.slice(id.indexOf(':') + 1) as FaultTarget;
}

function definition(id: keyof typeof injections): FaultDefinition {
  const environment = id.slice(0, id.indexOf(':')) as Environment;
  const target = targetFromId(id);
  return {
    id,
    environment,
    target,
    gate: target === 'postgresql' ? 'after-verified-backup' : 'after-golden',
    preState: { requiredFields: [...requiredPreStateFields], requireZeroActiveRuns: true },
    injection: { kind: injections[id], singleMutation: true, reversible: true },
    duringFault: {
      readiness: ['temporal', 'keycloak-jwks', 'postgresql'].includes(target)
        ? 'not-ready'
        : 'degraded',
      business: 'honest-failure',
      readOnly:
        target === 'postgresql'
          ? 'unavailable'
          : target === 'keycloak-jwks'
            ? 'bounded-existing-session-only'
            : 'available',
      falseSuccesses: 0,
      unauthorizedSideEffects: 0,
    },
    recovery: {
      restoreInFinally: true,
      requireSameUidOrDeclaredReplacement: true,
      requireReplicaAndReadinessEquality: true,
      retry: 'same-command-once',
      cas: 'must-remain-enforced',
    },
    evidencePolicy: { secretMaterial: 'forbidden', rawErrorMessage: 'forbidden' },
  };
}

const inventory = Object.freeze(
  (Object.keys(injections) as Array<keyof typeof injections>).map((id) =>
    Object.freeze(definition(id)),
  ),
);

/** Return the platform-neutral, exact experimental fault matrix. */
export function faultInjectionInventory(): readonly FaultDefinition[] {
  return inventory;
}

function stableFailure(code: string): Error {
  return new Error(code);
}

function sameDefinition(input: FaultDefinition, expected: FaultDefinition): boolean {
  try {
    return JSON.stringify(input) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function validState(state: FaultState): boolean {
  return (
    typeof state.uid === 'string' &&
    state.uid.length > 0 &&
    Number.isSafeInteger(state.desiredReplicas) &&
    state.desiredReplicas >= 0 &&
    Number.isSafeInteger(state.readyReplicas) &&
    state.readyReplicas >= 0 &&
    state.readyReplicas <= state.desiredReplicas &&
    state.readiness === 'ready' &&
    /^sha256:[0-9a-f]{64}$/.test(state.businessFingerprint) &&
    Number.isSafeInteger(state.eventHighWaterMark) &&
    state.eventHighWaterMark >= 0 &&
    state.activeRuns === 0
  );
}

function postStateMatches(preState: FaultState, postState: FaultState): boolean {
  const uidMatches =
    postState.uid === preState.uid ||
    (postState.replacement?.previousUid === preState.uid &&
      typeof postState.replacement.reasonCode === 'string' &&
      postState.replacement.reasonCode.length > 0);
  return (
    validState(postState) &&
    uidMatches &&
    postState.desiredReplicas === preState.desiredReplicas &&
    postState.readyReplicas === preState.readyReplicas &&
    postState.readiness === preState.readiness &&
    postState.businessFingerprint === preState.businessFingerprint &&
    postState.eventHighWaterMark === preState.eventHighWaterMark
  );
}

/** Execute one injected scenario lifecycle without owning any platform mutation primitive. */
export async function runBoundedFaultInjection(
  input: FaultDefinition,
  hooks: FaultHooks,
): Promise<FaultEvidence> {
  const canonical = inventory.find(({ id }) => id === input.id);
  if (canonical === undefined || !sameDefinition(input, canonical)) {
    throw stableFailure('fault_injection_definition_invalid');
  }

  let phase = 'preflight';
  let preState: FaultState | undefined;
  let during:
    | { falseSuccesses: 0; unauthorizedSideEffects: 0; readiness: 'not-ready' | 'degraded' }
    | undefined;
  let lifecycleFailure: Error | undefined;
  try {
    preState = await hooks.capturePreState(canonical);
    if (!validState(preState)) throw stableFailure('invalid');

    phase = 'injection';
    const injection = await hooks.inject(canonical);
    if (injection.mutationCount !== 1 || injection.receipt.length === 0) {
      throw stableFailure('invalid');
    }

    phase = 'assertion';
    during = await hooks.assertDuringFault(canonical);
    if (
      during.falseSuccesses !== 0 ||
      during.unauthorizedSideEffects !== 0 ||
      during.readiness !== canonical.duringFault.readiness
    ) {
      throw stableFailure('invalid');
    }
  } catch {
    lifecycleFailure = stableFailure(`fault_injection_${phase}_failed`);
  } finally {
    try {
      await hooks.restore(canonical);
    } catch {
      throw stableFailure('fault_injection_restore_failed');
    }
  }
  if (lifecycleFailure !== undefined) throw lifecycleFailure;

  phase = 'post_state';
  let postState: FaultState;
  try {
    postState = await hooks.capturePostState(canonical);
    if (preState === undefined || !postStateMatches(preState, postState)) {
      throw stableFailure('invalid');
    }
  } catch {
    throw stableFailure(`fault_injection_${phase}_failed`);
  }

  let retry: FaultEvidence['retry'];
  try {
    retry = await hooks.retryWithCas(canonical);
    if (
      retry.attempts !== 1 ||
      retry.casEnforced !== true ||
      !['succeeded', 'honest-rejection'].includes(retry.status)
    ) {
      throw stableFailure('invalid');
    }
  } catch {
    throw stableFailure('fault_injection_retry_failed');
  }

  return {
    schemaVersion: 1,
    scenarioId: canonical.id,
    restored: true,
    preState: preState!,
    postState,
    falseSuccesses: during!.falseSuccesses,
    unauthorizedSideEffects: during!.unauthorizedSideEffects,
    retry,
  };
}
