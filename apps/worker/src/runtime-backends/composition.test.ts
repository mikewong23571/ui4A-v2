import type { ProductionDeploymentSettings, ProductionRuntimeProfile } from '@ui4a/shared';
import { describe, expect, it, vi } from 'vitest';

import type {
  CanonicalRuntimeResult,
  RuntimeBackendKind,
  RuntimeBackendSpi,
  RuntimeCheckpoint,
  RuntimeRequest,
  RuntimeSpecialization,
  RuntimeSpecializationPort,
  RuntimeTransition,
  SealedRunnerEnvelope,
} from './backend';
import { createHostRunnerBackend } from './host/host-runner';
import { createKubernetesJobBackend } from './kubernetes/kubernetes-job';

interface RuntimeComposition {
  run(input: {
    request: unknown;
    leaseId: string;
    issuedAt: string;
    attempt: number;
    checkpoint?: RuntimeCheckpoint;
    signal: AbortSignal;
    recordTransition(transition: RuntimeTransition): void;
    recordHeartbeat(checkpoint: RuntimeCheckpoint): void;
    now(): number;
  }): Promise<CanonicalRuntimeResult>;
}

interface CompositionModule {
  createProductionRuntimeComposition(input: {
    runtime: ProductionDeploymentSettings['runtime'];
    backends: Partial<Record<RuntimeBackendKind, RuntimeBackendSpi>>;
    specializations: Record<RuntimeSpecialization, RuntimeSpecializationPort>;
    runnerArtifactImage: string;
    leaseDurationMs: number;
    heartbeatTimeoutMs: number;
  }): RuntimeComposition;
}

const plannedModulePath = './composition';
const DIGESTS = {
  definition: `sha256:${'1'.repeat(64)}`,
  prompt: `sha256:${'2'.repeat(64)}`,
  runtime: `sha256:${'3'.repeat(64)}`,
  task: `sha256:${'4'.repeat(64)}`,
  result: `sha256:${'5'.repeat(64)}`,
  artifact: `sha256:${'6'.repeat(64)}`,
} as const;
const RUNNER_IMAGE = `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`;

async function compositionApi(): Promise<CompositionModule> {
  return (await import(plannedModulePath)) as CompositionModule;
}

function productionProfile(
  specialization: RuntimeSpecialization,
  backend: 'kubernetes' | 'host',
): ProductionRuntimeProfile {
  const common = {
    id: `${specialization}-${backend}`,
    specialization,
    workspaceRoot: `/srv/ui4a/${specialization}`,
    timeoutSeconds: 900,
    resources: { cpu: '1', memory: '1Gi' },
    networkPolicy: 'restricted' as const,
    credentialRefs: [`${specialization}-provider-credential`],
  };
  return backend === 'kubernetes'
    ? { ...common, backend, image: RUNNER_IMAGE }
    : {
        ...common,
        backend,
        runnerId: `trusted-${specialization}-01`,
        runnerTokenRef: `trusted-${specialization}-token`,
      };
}

function runtimeConfig(
  specialization: RuntimeSpecialization,
  selectedBackend: 'kubernetes' | 'host',
): ProductionDeploymentSettings['runtime'] {
  const profiles = (['coding', 'writing', 'authoring'] as const).flatMap((kind) => [
    productionProfile(kind, 'kubernetes'),
    productionProfile(kind, 'host'),
  ]);
  return {
    defaultProfiles: {
      coding: `coding-${specialization === 'coding' ? selectedBackend : 'kubernetes'}`,
      writing: `writing-${specialization === 'writing' ? selectedBackend : 'kubernetes'}`,
      authoring: `authoring-${specialization === 'authoring' ? selectedBackend : 'kubernetes'}`,
    },
    profiles,
    repositories: [
      { ref: 'ui4a', root: '/srv/repos/ui4a', allowedPaths: ['apps', 'packages', 'docs'] },
    ],
  };
}

function request(specialization: RuntimeSpecialization): RuntimeRequest {
  return {
    schemaVersion: 1,
    runId: `equivalence-${specialization}`,
    specialization,
    birth: {
      definitionRef: `${specialization}-agent@1`,
      definitionHash: DIGESTS.definition,
      promptHash: DIGESTS.prompt,
      runtimeHash: DIGESTS.runtime,
      taskContractHash: DIGESTS.task,
      resultContractHash: DIGESTS.result,
    },
    task: {
      contractRef: `${specialization}-task@1`,
      payload: {
        objective: `produce the canonical ${specialization} result`,
        boundedInput: { source: 'fixture', revision: 7 },
      },
      contextRefs: ['entity:fixture', 'artifact:immutable-source'],
    },
  };
}

function semanticDelivery(envelope: SealedRunnerEnvelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    runId: envelope.runId,
    specialization: envelope.specialization,
    birth: envelope.birth,
    task: envelope.task,
  };
}

function backendFixture(
  kind: RuntimeBackendKind,
  transport: unknown,
  deliveries: SealedRunnerEnvelope[],
): RuntimeBackendSpi {
  return {
    kind,
    prepare: vi.fn(async (envelope) => {
      deliveries.push(structuredClone(envelope));
      return { handle: `${kind}:${envelope.runId}` };
    }),
    execute: vi.fn(async (envelope, _prepared, controls) => {
      controls.heartbeat(`${kind}:complete`);
      return {
        status: 'completed' as const,
        backendOutput: {
          specialization: envelope.specialization,
          summary: `canonical-${envelope.specialization}`,
        },
        transport,
      };
    }),
    collect: vi.fn(async (_envelope, execution) => ({
      candidate: execution.backendOutput,
      artifacts: [{ ref: 'artifact:canonical-result', hash: DIGESTS.artifact }],
    })),
  };
}

function specializationFixture(
  finalized: Array<{ runId: string; resultHash: string }>,
): RuntimeSpecializationPort {
  return {
    verify: vi.fn(
      async ({
        envelope,
        candidate,
        artifacts,
      }: Parameters<RuntimeSpecializationPort['verify']>[0]) => ({
        passed: true as const,
        evidence: {
          specialization: envelope.specialization,
          candidate,
          artifactHashes: artifacts.map(({ hash }) => hash),
          humanDecisionIngress: 'pending-human-decision',
          agentMayDecide: false,
        },
      }),
    ),
    finalize: vi.fn(
      async ({ envelope, resultHash }: Parameters<RuntimeSpecializationPort['finalize']>[0]) => {
        finalized.push({ runId: envelope.runId, resultHash });
      },
    ),
  };
}

async function execute(input: {
  specialization: RuntimeSpecialization;
  selectedBackend: 'kubernetes' | 'host';
  backends?: Partial<Record<RuntimeBackendKind, RuntimeBackendSpi>>;
  requestOverride?: unknown;
}) {
  const { createProductionRuntimeComposition } = await compositionApi();
  const k8sDeliveries: SealedRunnerEnvelope[] = [];
  const hostDeliveries: SealedRunnerEnvelope[] = [];
  const finalized: Array<{ runId: string; resultHash: string }> = [];
  const k8s = backendFixture('kubernetes-job', { jobName: 'transport-only-k8s' }, k8sDeliveries);
  const host = backendFixture('trusted-host', { runnerId: 'transport-only-host' }, hostDeliveries);
  const port = specializationFixture(finalized);
  const composition = createProductionRuntimeComposition({
    runtime: runtimeConfig(input.specialization, input.selectedBackend),
    backends: input.backends ?? { 'kubernetes-job': k8s, 'trusted-host': host },
    specializations: { coding: port, writing: port, authoring: port },
    runnerArtifactImage: RUNNER_IMAGE,
    leaseDurationMs: 60_000,
    heartbeatTimeoutMs: 15_000,
  });
  const transitions: RuntimeTransition[] = [];
  const result = await composition.run({
    request: input.requestOverride ?? request(input.specialization),
    leaseId: `lease:${input.specialization}:${input.selectedBackend}`,
    issuedAt: '2026-08-24T12:00:00.000Z',
    attempt: 1,
    signal: new AbortController().signal,
    recordTransition: (transition) => transitions.push(transition),
    recordHeartbeat: vi.fn(),
    now: () => 1_000,
  });
  return { result, k8s, host, k8sDeliveries, hostDeliveries, finalized, transitions };
}

function expectRuntimeBackendSpi(value: unknown, kind: RuntimeBackendKind): void {
  expect(value).toEqual(
    expect.objectContaining({
      kind,
      prepare: expect.any(Function),
      execute: expect.any(Function),
      collect: expect.any(Function),
    }),
  );
}

describe('T22 production Runtime backend composition', () => {
  it.each([
    ['kubernetes', 'kubernetes-job'],
    ['host', 'trusted-host'],
  ] as const)(
    'maps the server-owned %s profile only to the %s SPI',
    async (profileBackend, spiKind) => {
      const outcome = await execute({ specialization: 'coding', selectedBackend: profileBackend });
      const selected = spiKind === 'kubernetes-job' ? outcome.k8s : outcome.host;
      const unselected = spiKind === 'kubernetes-job' ? outcome.host : outcome.k8s;

      expect(selected.prepare).toHaveBeenCalledOnce();
      expect(selected.execute).toHaveBeenCalledOnce();
      expect(selected.collect).toHaveBeenCalledOnce();
      expect(unselected.prepare).not.toHaveBeenCalled();
      expect(unselected.execute).not.toHaveBeenCalled();
      expect(unselected.collect).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['coding', 'kubernetes'],
    ['coding', 'host'],
    ['writing', 'kubernetes'],
    ['writing', 'host'],
    ['authoring', 'kubernetes'],
    ['authoring', 'host'],
  ] as const)(
    'delivers the complete sealed %s task through the server-selected %s backend',
    async (specialization, selectedBackend) => {
      const outcome = await execute({ specialization, selectedBackend });
      const deliveries =
        selectedBackend === 'kubernetes' ? outcome.k8sDeliveries : outcome.hostDeliveries;
      const expectedRequest = request(specialization);

      expect(deliveries).toHaveLength(1);
      expect(semanticDelivery(deliveries[0]!)).toEqual(expectedRequest);
      expect(deliveries[0]!.execution).toMatchObject({
        profileId: `${specialization}-${selectedBackend}`,
        backend: selectedBackend === 'kubernetes' ? 'kubernetes-job' : 'trusted-host',
        image: RUNNER_IMAGE,
        workspace: {
          rootRef: `/srv/ui4a/${specialization}`,
          retention: 'until-human-decision',
        },
        resources: { cpu: '1', memory: '1Gi', timeoutSeconds: 900 },
        networkPolicy: 'restricted',
        credentialRefs: [`${specialization}-provider-credential`],
      });
      expect(deliveries[0]!.birth).toEqual(expectedRequest.birth);
      expect(deliveries[0]!.task.payload).toEqual(expectedRequest.task.payload);
      expect(deliveries[0]!.task.contextRefs).toEqual(expectedRequest.task.contextRefs);
      expect(outcome.result).toMatchObject({
        schemaVersion: 1,
        runId: expectedRequest.runId,
        specialization,
        birth: expectedRequest.birth,
        candidate: {
          specialization,
          summary: `canonical-${specialization}`,
        },
        artifacts: [{ ref: 'artifact:canonical-result', hash: DIGESTS.artifact }],
        verification: {
          specialization,
          humanDecisionIngress: 'pending-human-decision',
          agentMayDecide: false,
        },
      });
      expect(outcome.finalized).toEqual([
        { runId: expectedRequest.runId, resultHash: outcome.result.resultHash },
      ]);
      expect(outcome.transitions).toEqual([
        'prepared',
        'executing',
        'collected',
        'verified',
        'finalized',
      ]);
    },
  );

  it.each(['coding', 'writing', 'authoring'] as const)(
    'keeps the %s canonical result independent of backend transport metadata',
    async (specialization) => {
      const kubernetes = await execute({ specialization, selectedBackend: 'kubernetes' });
      const host = await execute({ specialization, selectedBackend: 'host' });

      expect(kubernetes.result).toEqual(host.result);
      expect(JSON.stringify(kubernetes.result)).not.toContain('transport-only-k8s');
      expect(JSON.stringify(host.result)).not.toContain('transport-only-host');
    },
  );

  it.each(['backend', 'profile', 'image', 'cwd', 'provider', 'model', 'env'])(
    'rejects request-controlled %s before selecting or calling a backend',
    async (field) => {
      const injected = { ...request('coding'), [field]: 'attacker-controlled' };
      const k8s = backendFixture('kubernetes-job', {}, []);
      const host = backendFixture('trusted-host', {}, []);

      await expect(
        execute({
          specialization: 'coding',
          selectedBackend: 'kubernetes',
          requestOverride: injected,
          backends: { 'kubernetes-job': k8s, 'trusted-host': host },
        }),
      ).rejects.toThrow(`runtime_request_forbidden_field:${field}`);
      expect(k8s.prepare).not.toHaveBeenCalled();
      expect(host.prepare).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['kubernetes', 'kubernetes-job', 'trusted-host'],
    ['host', 'trusted-host', 'kubernetes-job'],
  ] as const)(
    'fails closed when the selected %s profile (%s SPI) is unavailable and never falls back to %s',
    async (profileBackend, selectedSpi, otherSpi) => {
      const other = backendFixture(otherSpi, {}, []);
      await expect(
        execute({
          specialization: 'coding',
          selectedBackend: profileBackend,
          backends: { [otherSpi]: other },
        }),
      ).rejects.toThrow(`runtime_backend_unavailable:${selectedSpi}`);
      expect(other.prepare).not.toHaveBeenCalled();
      expect(other.execute).not.toHaveBeenCalled();
      expect(other.collect).not.toHaveBeenCalled();
    },
  );

  it('exposes the Kubernetes Job adapter as the unified RuntimeBackendSpi', () => {
    const adapter = createKubernetesJobBackend({
      config: {
        namespace: 'ui4a-runtime',
        image: RUNNER_IMAGE,
        serviceAccountName: 'ui4a-agent-runtime',
        command: ['node', '/app/apps/agent-runner/dist/main.js', 'oneshot'],
        resources: {
          requests: { cpu: '500m', memory: '512Mi' },
          limits: { cpu: '1', memory: '1Gi' },
        },
        networkPolicyRef: 'ui4a-runtime-restricted',
        workspace: { claimPrefix: 'ui4a-run-', mountPath: '/workspaces/run' },
        activeDeadlineSeconds: 900,
        ttlSecondsAfterFinished: 3_600,
      },
      client: {
        createJob: vi.fn(async () => ({ uid: 'job-uid' })),
        watchRun: vi.fn(async function* () {}),
        deleteJob: vi.fn(async () => undefined),
        findRun: vi.fn(async () => []),
        deleteWorkspaceClaim: vi.fn(async () => undefined),
      },
      idempotency: { deliveries: new Map(), callbacks: new Map() },
    });

    expectRuntimeBackendSpi(adapter, 'kubernetes-job');
  });

  it('exposes the trusted Host Runner adapter as the unified RuntimeBackendSpi', () => {
    const state = new Map<string, unknown>();
    const adapter = createHostRunnerBackend({
      registry: {
        runners: [
          {
            id: 'trusted-writing-01',
            authenticatedIdentity: 'spiffe://ui4a.internal/runner/trusted-writing-01',
            capabilities: ['writing'],
            workspaceRoots: ['/srv/ui4a/writing'],
          },
        ],
        profiles: [
          {
            id: 'writing-host',
            runnerId: 'trusted-writing-01',
            capability: 'writing',
            workspaceRoot: '/srv/ui4a/writing',
            timeoutMs: 30_000,
          },
        ],
      },
      state: {
        load: (runId) => state.get(runId),
        save: (runId, value) => state.set(runId, structuredClone(value)),
        list: () => [...state.values()].map((value) => structuredClone(value)),
      },
      transport: {
        deliver: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
      },
      clock: { nowMs: () => 1_000 },
      fsFacts: { resolve: (path) => ({ kind: 'file', realPath: path }) },
      heartbeatTtlMs: 30_000,
    });

    expectRuntimeBackendSpi(adapter, 'trusted-host');
  });
});
