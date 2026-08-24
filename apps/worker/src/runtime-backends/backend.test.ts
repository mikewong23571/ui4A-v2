import { describe, expect, it, vi } from 'vitest';

type Specialization = 'coding' | 'writing' | 'authoring';
type BackendKind = 'kubernetes-job' | 'trusted-host';
type Transition = 'prepared' | 'executing' | 'collected' | 'verified' | 'finalized';

interface RuntimeRequest {
  schemaVersion: 1;
  runId: string;
  specialization: Specialization;
  birth: {
    definitionRef: string;
    definitionHash: string;
    promptHash: string;
    runtimeHash: string;
    taskContractHash: string;
    resultContractHash: string;
  };
  task: { contractRef: string; payload: unknown; contextRefs: string[] };
}

interface ServerRuntimeProfile {
  id: string;
  backend: BackendKind;
  image: string;
  workspace: { rootRef: string; retention: 'until-human-decision' };
  resources: { cpu: string; memory: string; timeoutSeconds: number };
  networkPolicy: 'restricted';
  leaseDurationMs: number;
  heartbeatTimeoutMs: number;
}

interface SealedRunnerEnvelope extends RuntimeRequest {
  execution: {
    profileId: string;
    backend: BackendKind;
    image: string;
    workspace: ServerRuntimeProfile['workspace'];
    resources: ServerRuntimeProfile['resources'];
    networkPolicy: 'restricted';
    leaseId: string;
    issuedAt: string;
  };
}

interface RuntimeCheckpoint {
  schemaVersion: 1;
  runId: string;
  profileId: string;
  backend: BackendKind;
  leaseId: string;
  attempt: number;
  cursor: string | null;
  heartbeatAt: number;
  leaseExpiresAt: number;
}

interface RuntimeBackendSpi {
  kind: BackendKind;
  prepare(envelope: SealedRunnerEnvelope): Promise<{ handle: string }>;
  execute(
    envelope: SealedRunnerEnvelope,
    prepared: { handle: string },
    controls: {
      signal: AbortSignal;
      checkpoint?: RuntimeCheckpoint;
      heartbeat(cursor: string | null): void;
    },
  ): Promise<{ status: 'completed'; backendOutput: unknown; transport?: unknown }>;
  collect(
    envelope: SealedRunnerEnvelope,
    execution: { status: 'completed'; backendOutput: unknown; transport?: unknown },
  ): Promise<{ candidate: unknown; artifacts: Array<{ ref: string; hash: string }> }>;
}

interface SpecializationPort {
  verify(input: {
    envelope: SealedRunnerEnvelope;
    candidate: unknown;
    artifacts: Array<{ ref: string; hash: string }>;
  }): Promise<{ passed: true; evidence: unknown }>;
  finalize(input: { envelope: SealedRunnerEnvelope; resultHash: string }): Promise<void>;
}

interface CanonicalRuntimeResult {
  schemaVersion: 1;
  runId: string;
  specialization: Specialization;
  status: 'succeeded';
  birth: RuntimeRequest['birth'];
  candidate: unknown;
  artifacts: Array<{ ref: string; hash: string }>;
  verification: unknown;
  resultHash: string;
}

type RuntimeControlDecision =
  | { action: 'continue' | 'resume' }
  | { action: 'cancel'; reasonCode: 'cancel_requested' }
  | { action: 'timeout'; reasonCode: 'deadline_exceeded' }
  | {
      action: 'restart';
      reasonCode: 'runner_disconnected' | 'lease_expired' | 'heartbeat_stale';
      backend: BackendKind;
      profileId: string;
      nextAttempt: number;
      fallbackAllowed: false;
    };

interface BackendModule {
  sealRuntimeEnvelope(input: {
    request: unknown;
    profile: ServerRuntimeProfile;
    leaseId: string;
    issuedAt: string;
  }): SealedRunnerEnvelope;
  runRuntimeBackendLifecycle(input: {
    request: unknown;
    profile: ServerRuntimeProfile;
    leaseId: string;
    issuedAt: string;
    attempt: number;
    checkpoint?: RuntimeCheckpoint;
    signal: AbortSignal;
    backends: Partial<Record<BackendKind, RuntimeBackendSpi>>;
    specializations: Record<Specialization, SpecializationPort>;
    recordTransition(transition: Transition): void;
    recordHeartbeat(checkpoint: RuntimeCheckpoint): void;
    now(): number;
  }): Promise<CanonicalRuntimeResult>;
  decideRuntimeControl(input: {
    checkpoint: RuntimeCheckpoint;
    now: number;
    deadlineAt: number;
    heartbeatTimeoutMs: number;
    cancelRequested: boolean;
    backendConnected: boolean;
  }): RuntimeControlDecision;
  canonicalizeRuntimeResult(input: {
    envelope: SealedRunnerEnvelope;
    candidate: unknown;
    artifacts: Array<{ ref: string; hash: string }>;
    verification: unknown;
    transport?: unknown;
  }): CanonicalRuntimeResult;
}

const plannedModulePath = './backend';

async function backendApi(): Promise<BackendModule> {
  return (await import(plannedModulePath)) as BackendModule;
}

const profile: ServerRuntimeProfile = {
  id: 'server-coding-k8s',
  backend: 'kubernetes-job',
  image: `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`,
  workspace: { rootRef: 'workspace-root:isolated', retention: 'until-human-decision' },
  resources: { cpu: '2', memory: '4Gi', timeoutSeconds: 1_800 },
  networkPolicy: 'restricted',
  leaseDurationMs: 60_000,
  heartbeatTimeoutMs: 15_000,
};

function request(specialization: Specialization = 'coding'): RuntimeRequest {
  return {
    schemaVersion: 1,
    runId: `runtime-${specialization}-1`,
    specialization,
    birth: {
      definitionRef: `${specialization}-agent@1`,
      definitionHash: `sha256:${'1'.repeat(64)}`,
      promptHash: `sha256:${'2'.repeat(64)}`,
      runtimeHash: `sha256:${'3'.repeat(64)}`,
      taskContractHash: `sha256:${'4'.repeat(64)}`,
      resultContractHash: `sha256:${'5'.repeat(64)}`,
    },
    task: {
      contractRef: `${specialization}-task@1`,
      payload: { instruction: `perform ${specialization}` },
      contextRefs: ['entity:fixture'],
    },
  };
}

function backendFixture(kind: BackendKind = 'kubernetes-job'): RuntimeBackendSpi {
  return {
    kind,
    prepare: vi.fn(async () => ({ handle: 'handle:1' })),
    execute: vi.fn(async (_envelope, _prepared, controls) => {
      controls.heartbeat('cursor:1');
      return {
        status: 'completed' as const,
        backendOutput: { markdown: '# Result' },
        transport: { podName: 'must-not-enter-canonical-result' },
      };
    }),
    collect: vi.fn(async (_envelope, execution) => ({
      candidate: execution.backendOutput,
      artifacts: [{ ref: 'artifact:result', hash: `sha256:${'6'.repeat(64)}` }],
    })),
  };
}

function specializationFixture(): SpecializationPort {
  return {
    verify: vi.fn(async ({ candidate }) => ({
      passed: true as const,
      evidence: { verifier: 'fixture', candidate },
    })),
    finalize: vi.fn(async () => undefined),
  };
}

function allSpecializations(port: SpecializationPort): Record<Specialization, SpecializationPort> {
  return { coding: port, writing: port, authoring: port };
}

function checkpoint(overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint {
  return {
    schemaVersion: 1,
    runId: 'runtime-coding-1',
    profileId: profile.id,
    backend: profile.backend,
    leaseId: 'lease:runtime-coding-1',
    attempt: 1,
    cursor: 'cursor:1',
    heartbeatAt: 20_000,
    leaseExpiresAt: 60_000,
    ...overrides,
  };
}

describe('T22 unified Runtime Backend contract', () => {
  it('seals immutable birth and server-owned execution fields into one detached envelope', async () => {
    const { sealRuntimeEnvelope } = await backendApi();
    const untrusted = request();
    const envelope = sealRuntimeEnvelope({
      request: untrusted,
      profile,
      leaseId: 'lease:runtime-coding-1',
      issuedAt: '2026-08-24T12:00:00.000Z',
    });

    expect(envelope).toMatchObject({
      runId: untrusted.runId,
      birth: untrusted.birth,
      task: untrusted.task,
      execution: {
        profileId: profile.id,
        backend: 'kubernetes-job',
        image: profile.image,
        workspace: profile.workspace,
        resources: profile.resources,
        networkPolicy: 'restricted',
        leaseId: 'lease:runtime-coding-1',
      },
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.birth)).toBe(true);
    expect(Object.isFrozen(envelope.execution.resources)).toBe(true);
    untrusted.birth.runtimeHash = `sha256:${'f'.repeat(64)}`;
    profile.resources.cpu = '999';
    expect(envelope.birth.runtimeHash).toBe(`sha256:${'3'.repeat(64)}`);
    expect(envelope.execution.resources.cpu).toBe('2');
  });

  it.each([
    'provider',
    'model',
    'cwd',
    'env',
    'backend',
    'profile',
    'image',
    'workspace',
    'resources',
    'networkPolicy',
  ])('rejects request-controlled %s before any mutation or backend call', async (field) => {
    const { runRuntimeBackendLifecycle } = await backendApi();
    const backend = backendFixture();
    const recordTransition = vi.fn();
    const recordHeartbeat = vi.fn();

    await expect(
      runRuntimeBackendLifecycle({
        request: { ...request(), [field]: 'request-controlled' },
        profile,
        leaseId: 'lease:runtime-coding-1',
        issuedAt: '2026-08-24T12:00:00.000Z',
        attempt: 1,
        signal: new AbortController().signal,
        backends: { 'kubernetes-job': backend },
        specializations: allSpecializations(specializationFixture()),
        recordTransition,
        recordHeartbeat,
        now: () => 20_000,
      }),
    ).rejects.toThrow(`runtime_request_forbidden_field:${field}`);
    expect(recordTransition).not.toHaveBeenCalled();
    expect(recordHeartbeat).not.toHaveBeenCalled();
    expect(backend.prepare).not.toHaveBeenCalled();
    expect(backend.execute).not.toHaveBeenCalled();
    expect(backend.collect).not.toHaveBeenCalled();
  });

  it('runs prepare → execute → collect → verify → finalize and emits a scoped heartbeat', async () => {
    const { runRuntimeBackendLifecycle } = await backendApi();
    const backend = backendFixture();
    const specialization = specializationFixture();
    const transitions: Transition[] = [];
    const recordHeartbeat = vi.fn();

    const result = await runRuntimeBackendLifecycle({
      request: request(),
      profile,
      leaseId: 'lease:runtime-coding-1',
      issuedAt: '2026-08-24T12:00:00.000Z',
      attempt: 1,
      signal: new AbortController().signal,
      backends: { 'kubernetes-job': backend },
      specializations: allSpecializations(specialization),
      recordTransition: (transition) => transitions.push(transition),
      recordHeartbeat,
      now: () => 20_000,
    });

    expect(transitions).toEqual(['prepared', 'executing', 'collected', 'verified', 'finalized']);
    expect(recordHeartbeat).toHaveBeenCalledWith({
      schemaVersion: 1,
      runId: 'runtime-coding-1',
      profileId: profile.id,
      backend: profile.backend,
      leaseId: 'lease:runtime-coding-1',
      attempt: 1,
      cursor: 'cursor:1',
      heartbeatAt: 20_000,
      leaseExpiresAt: 80_000,
    });
    expect(specialization.verify).toHaveBeenCalledOnce();
    expect(specialization.finalize).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      schemaVersion: 1,
      runId: 'runtime-coding-1',
      specialization: 'coding',
      status: 'succeeded',
      birth: request().birth,
      resultHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain('podName');
  });

  it('rejects a restart checkpoint for another immutable Run/profile before mutation', async () => {
    const { runRuntimeBackendLifecycle } = await backendApi();
    const backend = backendFixture();
    const recordTransition = vi.fn();

    await expect(
      runRuntimeBackendLifecycle({
        request: request(),
        profile,
        leaseId: 'lease:runtime-coding-1',
        issuedAt: '2026-08-24T12:00:00.000Z',
        attempt: 2,
        checkpoint: checkpoint({ runId: 'another-run', profileId: 'another-profile' }),
        signal: new AbortController().signal,
        backends: { 'kubernetes-job': backend },
        specializations: allSpecializations(specializationFixture()),
        recordTransition,
        recordHeartbeat: vi.fn(),
        now: () => 20_000,
      }),
    ).rejects.toThrow('runtime_checkpoint_scope_mismatch');
    expect(recordTransition).not.toHaveBeenCalled();
    expect(backend.prepare).not.toHaveBeenCalled();
  });

  it.each([
    [
      'continue',
      { now: 25_000, deadlineAt: 90_000, cancelRequested: false, backendConnected: true },
      { action: 'continue' },
    ],
    [
      'resume',
      {
        now: 25_000,
        deadlineAt: 90_000,
        cancelRequested: false,
        backendConnected: true,
        checkpoint: checkpoint({ attempt: 2 }),
      },
      { action: 'resume' },
    ],
    [
      'cancel',
      { now: 25_000, deadlineAt: 90_000, cancelRequested: true, backendConnected: true },
      { action: 'cancel', reasonCode: 'cancel_requested' },
    ],
    [
      'timeout',
      { now: 90_001, deadlineAt: 90_000, cancelRequested: false, backendConnected: true },
      { action: 'timeout', reasonCode: 'deadline_exceeded' },
    ],
    [
      'disconnect restart',
      { now: 25_000, deadlineAt: 90_000, cancelRequested: false, backendConnected: false },
      {
        action: 'restart',
        reasonCode: 'runner_disconnected',
        backend: profile.backend,
        profileId: profile.id,
        nextAttempt: 2,
        fallbackAllowed: false,
      },
    ],
    [
      'lease restart',
      {
        now: 60_001,
        deadlineAt: 90_000,
        cancelRequested: false,
        backendConnected: true,
      },
      {
        action: 'restart',
        reasonCode: 'lease_expired',
        backend: profile.backend,
        profileId: profile.id,
        nextAttempt: 2,
        fallbackAllowed: false,
      },
    ],
    [
      'heartbeat restart',
      { now: 35_001, deadlineAt: 90_000, cancelRequested: false, backendConnected: true },
      {
        action: 'restart',
        reasonCode: 'heartbeat_stale',
        backend: profile.backend,
        profileId: profile.id,
        nextAttempt: 2,
        fallbackAllowed: false,
      },
    ],
  ])(
    'decides bounded %s control without changing backend selection',
    async (_case, input, expected) => {
      const { decideRuntimeControl } = await backendApi();
      const selectedCheckpoint =
        'checkpoint' in input && input.checkpoint !== undefined ? input.checkpoint : checkpoint();

      expect(
        decideRuntimeControl({
          checkpoint: selectedCheckpoint,
          now: input.now,
          deadlineAt: input.deadlineAt,
          heartbeatTimeoutMs: profile.heartbeatTimeoutMs,
          cancelRequested: input.cancelRequested,
          backendConnected: input.backendConnected,
        }),
      ).toEqual(expected);
    },
  );

  it('never falls back when the selected backend fails', async () => {
    const { runRuntimeBackendLifecycle } = await backendApi();
    const selected = backendFixture('kubernetes-job');
    vi.mocked(selected.prepare).mockRejectedValue(new Error('cluster credential leaked'));
    const broaderHost = backendFixture('trusted-host');

    await expect(
      runRuntimeBackendLifecycle({
        request: request(),
        profile,
        leaseId: 'lease:runtime-coding-1',
        issuedAt: '2026-08-24T12:00:00.000Z',
        attempt: 1,
        signal: new AbortController().signal,
        backends: { 'kubernetes-job': selected, 'trusted-host': broaderHost },
        specializations: allSpecializations(specializationFixture()),
        recordTransition: vi.fn(),
        recordHeartbeat: vi.fn(),
        now: () => 20_000,
      }),
    ).rejects.toThrow('runtime_backend_unavailable:kubernetes-job');
    expect(broaderHost.prepare).not.toHaveBeenCalled();
    expect(broaderHost.execute).not.toHaveBeenCalled();
  });

  it('excludes backend transport from the canonical result identity', async () => {
    const { canonicalizeRuntimeResult, sealRuntimeEnvelope } = await backendApi();
    const envelope = sealRuntimeEnvelope({
      request: request(),
      profile,
      leaseId: 'lease:runtime-coding-1',
      issuedAt: '2026-08-24T12:00:00.000Z',
    });
    const semantic = {
      envelope,
      candidate: { markdown: '# Result' },
      artifacts: [{ ref: 'artifact:result', hash: `sha256:${'6'.repeat(64)}` }],
      verification: { passed: true, verifier: 'fixture' },
    };

    const kubernetes = canonicalizeRuntimeResult({
      ...semantic,
      transport: { podName: 'pod-1', namespace: 'runtime' },
    });
    const host = canonicalizeRuntimeResult({
      ...semantic,
      transport: { runnerId: 'runner-1', socket: '/private/runner.sock' },
    });

    expect(host).toEqual(kubernetes);
    expect(host.resultHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(host)).not.toMatch(/podName|runnerId|socket/);
  });

  it.each(['coding', 'writing', 'authoring'] as const)(
    'keeps the common lifecycle specialization-neutral for %s',
    async (specializationName) => {
      const { runRuntimeBackendLifecycle } = await backendApi();
      const backend = backendFixture();
      const specialization = specializationFixture();
      const transitions: Transition[] = [];

      const result = await runRuntimeBackendLifecycle({
        request: request(specializationName),
        profile: { ...profile, id: `server-${specializationName}-k8s` },
        leaseId: `lease:runtime-${specializationName}-1`,
        issuedAt: '2026-08-24T12:00:00.000Z',
        attempt: 1,
        signal: new AbortController().signal,
        backends: { 'kubernetes-job': backend },
        specializations: allSpecializations(specialization),
        recordTransition: (transition) => transitions.push(transition),
        recordHeartbeat: vi.fn(),
        now: () => 20_000,
      });

      expect(result.specialization).toBe(specializationName);
      expect(transitions).toEqual(['prepared', 'executing', 'collected', 'verified', 'finalized']);
      expect(specialization.verify).toHaveBeenCalledOnce();
      expect(specialization.finalize).toHaveBeenCalledOnce();
    },
  );
});
