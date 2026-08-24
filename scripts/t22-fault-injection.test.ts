import { describe, expect, it, vi } from 'vitest';

const plannedModulePath = './t22-fault-injection.js';
const environments = ['kubernetes', 'compose'] as const;
const targets = [
  'llm',
  'temporal',
  'keycloak-jwks',
  'postgresql',
  'kubernetes-runtime',
  'host-runner',
] as const;
const expectedInjections = {
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

type Environment = (typeof environments)[number];
type FaultTarget = (typeof targets)[number];
type Gate = 'after-golden' | 'after-verified-backup';

interface FaultDefinition {
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

interface FaultState {
  uid: string;
  desiredReplicas: number;
  readyReplicas: number;
  readiness: string;
  businessFingerprint: string;
  eventHighWaterMark: number;
  activeRuns: number;
}

interface FaultHooks {
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

interface FaultEvidence {
  schemaVersion: 1;
  scenarioId: string;
  restored: true;
  preState: FaultState;
  postState: FaultState;
  falseSuccesses: 0;
  unauthorizedSideEffects: 0;
  retry: { attempts: 1; casEnforced: true; status: string };
  errorCode?: string;
}

interface PlannedFaultModule {
  faultInjectionInventory(): readonly FaultDefinition[];
  runBoundedFaultInjection(definition: FaultDefinition, hooks: FaultHooks): Promise<FaultEvidence>;
}

async function plannedModule(): Promise<PlannedFaultModule> {
  return (await import(/* @vite-ignore */ plannedModulePath)) as PlannedFaultModule;
}

function state(): FaultState {
  return {
    uid: 'resource-uid-before',
    desiredReplicas: 1,
    readyReplicas: 1,
    readiness: 'ready',
    businessFingerprint: `sha256:${'a'.repeat(64)}`,
    eventHighWaterMark: 42,
    activeRuns: 0,
  };
}

function definition(): FaultDefinition {
  return {
    id: 'kubernetes:temporal',
    environment: 'kubernetes',
    target: 'temporal',
    gate: 'after-golden',
    preState: {
      requiredFields: [
        'uid',
        'desiredReplicas',
        'readyReplicas',
        'readiness',
        'businessFingerprint',
        'eventHighWaterMark',
        'activeRuns',
      ],
      requireZeroActiveRuns: true,
    },
    injection: {
      kind: 'scale-temporal-deployment-to-zero',
      singleMutation: true,
      reversible: true,
    },
    duringFault: {
      readiness: 'not-ready',
      business: 'honest-failure',
      readOnly: 'available',
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

function hooks(overrides: Partial<FaultHooks> = {}): FaultHooks {
  return {
    capturePreState: vi.fn(async () => state()),
    inject: vi.fn(async () => ({ mutationCount: 1 as const, receipt: 'bounded-mutation-1' })),
    assertDuringFault: vi.fn(async () => ({
      falseSuccesses: 0 as const,
      unauthorizedSideEffects: 0 as const,
      readiness: 'not-ready' as const,
    })),
    restore: vi.fn(async () => undefined),
    capturePostState: vi.fn(async () => state()),
    retryWithCas: vi.fn(async () => ({
      attempts: 1 as const,
      casEnforced: true as const,
      status: 'succeeded' as const,
    })),
    ...overrides,
  };
}

describe('T22 bounded fault-injection operator contract', () => {
  it('defines the exact K8s/Compose matrix with one reversible mutation and honest states', async () => {
    const { faultInjectionInventory } = await plannedModule();
    const inventory = faultInjectionInventory();

    expect(inventory.map(({ id }) => id)).toEqual(Object.keys(expectedInjections));
    for (const scenario of inventory) {
      expect(scenario.preState.requiredFields).toEqual(
        expect.arrayContaining([
          'uid',
          'desiredReplicas',
          'readyReplicas',
          'readiness',
          'businessFingerprint',
          'eventHighWaterMark',
          'activeRuns',
        ]),
      );
      expect(scenario.preState.requireZeroActiveRuns).toBe(true);
      expect(scenario.injection).toMatchObject({ singleMutation: true, reversible: true });
      expect(scenario.injection.kind, scenario.id).toBe(
        expectedInjections[scenario.id as keyof typeof expectedInjections],
      );
      expect(scenario.duringFault.business).toBe('honest-failure');
      expect(scenario.duringFault.readiness).not.toBe('ready');
      expect(scenario.duringFault.falseSuccesses).toBe(0);
      expect(scenario.duringFault.unauthorizedSideEffects).toBe(0);
      expect(scenario.recovery).toEqual({
        restoreInFinally: true,
        requireSameUidOrDeclaredReplacement: true,
        requireReplicaAndReadinessEquality: true,
        retry: 'same-command-once',
        cas: 'must-remain-enforced',
      });
      expect(scenario.evidencePolicy).toEqual({
        secretMaterial: 'forbidden',
        rawErrorMessage: 'forbidden',
      });
      expect(scenario.gate).toBe(
        scenario.target === 'postgresql' ? 'after-verified-backup' : 'after-golden',
      );
      expect(scenario.duringFault.readOnly).toBe(
        scenario.target === 'postgresql'
          ? 'unavailable'
          : scenario.target === 'keycloak-jwks'
            ? 'bounded-existing-session-only'
            : 'available',
      );
    }
  });

  it('captures pre-state, restores in finally, proves post-state, then retries with CAS once', async () => {
    const { runBoundedFaultInjection } = await plannedModule();
    const scenario = definition();
    const operator = hooks();

    const evidence = await runBoundedFaultInjection(scenario, operator);

    expect(operator.capturePreState).toHaveBeenCalledOnce();
    expect(operator.inject).toHaveBeenCalledOnce();
    expect(operator.assertDuringFault).toHaveBeenCalledOnce();
    expect(operator.restore).toHaveBeenCalledOnce();
    expect(operator.capturePostState).toHaveBeenCalledOnce();
    expect(operator.retryWithCas).toHaveBeenCalledOnce();
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      scenarioId: scenario.id,
      restored: true,
      falseSuccesses: 0,
      unauthorizedSideEffects: 0,
      retry: { attempts: 1, casEnforced: true, status: 'succeeded' },
    });
    expect(evidence.postState).toEqual(evidence.preState);
  });

  it('restores after a failed assertion and exposes only a stable redacted failure', async () => {
    const { runBoundedFaultInjection } = await plannedModule();
    const restore = vi.fn(async () => undefined);
    const operator = hooks({
      restore,
      assertDuringFault: vi.fn(async () => {
        throw new Error('provider failed with __secret_material__');
      }),
    });

    await expect(runBoundedFaultInjection(definition(), operator)).rejects.toThrow(
      'fault_injection_assertion_failed',
    );
    expect(restore).toHaveBeenCalledOnce();
    expect(JSON.stringify(restore.mock.calls)).not.toContain('__secret_material__');
  });
});
