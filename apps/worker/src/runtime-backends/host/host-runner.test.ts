import { describe, expect, it, vi } from 'vitest';

type Capability = 'coding' | 'writing' | 'authoring';

interface HostRunnerTask {
  schemaVersion: 1;
  runId: string;
  capability: Capability;
  birth: {
    definitionHash: string;
    promptHash: string;
    runtimeHash: string;
  };
  payload: unknown;
  [key: string]: unknown;
}

interface HostRunnerRegistry {
  runners: Array<{
    id: string;
    authenticatedIdentity: string;
    capabilities: Capability[];
    workspaceRoots: string[];
  }>;
  profiles: Array<{
    id: string;
    runnerId: string;
    capability: Capability;
    workspaceRoot: string;
    timeoutMs: number;
  }>;
}

interface HostRunnerStateStore {
  load(runId: string): unknown;
  save(runId: string, state: unknown): void;
  list(): unknown[];
}

interface HostRunnerTransport {
  deliver(command: unknown): Promise<void>;
  cancel(command: unknown): Promise<void>;
}

interface HostRunnerFsFacts {
  resolve(path: string): { kind: 'file' | 'directory' | 'symlink'; realPath: string };
}

interface HostRunnerBackend {
  heartbeat(input: {
    runnerId: string;
    identity: string;
    capabilities: Capability[];
    workspaceRoots: string[];
  }): Promise<{ runnerId: string; status: 'online'; leaseUntilMs: number }>;
  disconnect(input: { runnerId: string; identity: string }): Promise<void>;
  dispatch(input: {
    task: HostRunnerTask;
    selectedProfileId: string;
  }): Promise<{ leaseId: string; runnerId: string; profileId: string; workspaceRoot: string }>;
  claim(input: { runnerId: string; identity: string; leaseId: string }): Promise<void>;
  execute(input: { runnerId: string; identity: string; leaseId: string }): Promise<void>;
  acceptResult(input: {
    runnerId: string;
    identity: string;
    leaseId: string;
    result: {
      runId: string;
      status: 'succeeded' | 'failed';
      resultHash: string;
      artifacts: Array<{ path: string; hash: string }>;
    };
  }): Promise<unknown>;
  cancel(input: { runId: string; reason: string }): Promise<void>;
  expireLeases(): Promise<void>;
  snapshot(runId: string): unknown;
}

interface HostRunnerModule {
  createHostRunnerBackend(input: {
    registry: HostRunnerRegistry;
    state: HostRunnerStateStore;
    transport: HostRunnerTransport;
    clock: { nowMs(): number };
    fsFacts: HostRunnerFsFacts;
    heartbeatTtlMs: number;
  }): HostRunnerBackend;
}

const plannedModulePath = './host-runner';
const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;

async function plannedApi(): Promise<HostRunnerModule> {
  return (await import(plannedModulePath)) as HostRunnerModule;
}

function registry(): HostRunnerRegistry {
  return {
    runners: [
      {
        id: 'trusted-writer-01',
        authenticatedIdentity: 'spiffe://ui4a.internal/runner/trusted-writer-01',
        capabilities: ['writing'],
        workspaceRoots: ['/srv/ui4a/writing'],
      },
    ],
    profiles: [
      {
        id: 'writing-host',
        runnerId: 'trusted-writer-01',
        capability: 'writing',
        workspaceRoot: '/srv/ui4a/writing',
        timeoutMs: 30_000,
      },
    ],
  };
}

function task(overrides: Partial<HostRunnerTask> = {}): HostRunnerTask {
  return {
    schemaVersion: 1,
    runId: 'agent-run-42',
    capability: 'writing',
    birth: {
      definitionHash: SHA_A,
      promptHash: SHA_A,
      runtimeHash: SHA_A,
    },
    payload: { objective: 'write an evidence-backed summary' },
    ...overrides,
  };
}

function stateStore(): HostRunnerStateStore {
  const records = new Map<string, unknown>();
  return {
    load: (runId) => records.get(runId),
    save: (runId, state) => records.set(runId, structuredClone(state)),
    list: () => [...records.values()].map((state) => structuredClone(state)),
  };
}

function fixtureDependencies() {
  let now = 1_000;
  const deliver = vi.fn(async (command: unknown) => {
    void command;
  });
  const cancel = vi.fn(async (command: unknown) => {
    void command;
  });
  const facts = new Map<string, ReturnType<HostRunnerFsFacts['resolve']>>();
  return {
    state: stateStore(),
    transport: { deliver, cancel },
    clock: {
      nowMs: () => now,
      advance: (milliseconds: number) => {
        now += milliseconds;
      },
    },
    fsFacts: {
      resolve: (path: string) => facts.get(path) ?? { kind: 'file' as const, realPath: path },
      set: (path: string, fact: ReturnType<HostRunnerFsFacts['resolve']>) => facts.set(path, fact),
    },
  };
}

const heartbeat = {
  runnerId: 'trusted-writer-01',
  identity: 'spiffe://ui4a.internal/runner/trusted-writer-01',
  capabilities: ['writing'] as Capability[],
  workspaceRoots: ['/srv/ui4a/writing'],
};

async function createFixture() {
  const { createHostRunnerBackend } = await plannedApi();
  const dependencies = fixtureDependencies();
  const backend = createHostRunnerBackend({
    registry: registry(),
    state: dependencies.state,
    transport: dependencies.transport,
    clock: dependencies.clock,
    fsFacts: dependencies.fsFacts,
    heartbeatTtlMs: 10_000,
  });
  return { createHostRunnerBackend, backend, ...dependencies };
}

describe('T22 Trusted Host Runner Backend contract (Red)', () => {
  it('accepts only the registered identity and server-owned capabilities, roots, and profile', async () => {
    const { backend } = await createFixture();

    await expect(backend.heartbeat(heartbeat)).resolves.toMatchObject({
      runnerId: 'trusted-writer-01',
      status: 'online',
    });
    await expect(
      backend.heartbeat({ ...heartbeat, identity: 'spiffe://attacker/runner' }),
    ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_IDENTITY_INVALID' }));
    await expect(
      backend.heartbeat({ ...heartbeat, capabilities: ['writing', 'coding'] }),
    ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_CAPABILITY_ESCALATION' }));
    await expect(
      backend.heartbeat({ ...heartbeat, workspaceRoots: ['/srv/ui4a', '/'] }),
    ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_ROOT_ESCALATION' }));

    await expect(
      backend.dispatch({ task: task(), selectedProfileId: 'writing-host' }),
    ).resolves.toMatchObject({
      runnerId: 'trusted-writer-01',
      profileId: 'writing-host',
      workspaceRoot: '/srv/ui4a/writing',
    });
  });

  it('authenticates heartbeat, lease, claim, execute, result, and cancellation', async () => {
    const { backend, transport } = await createFixture();
    await backend.heartbeat(heartbeat);
    const lease = await backend.dispatch({ task: task(), selectedProfileId: 'writing-host' });

    await expect(
      backend.claim({
        runnerId: heartbeat.runnerId,
        identity: heartbeat.identity,
        leaseId: lease.leaseId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      backend.execute({
        runnerId: heartbeat.runnerId,
        identity: heartbeat.identity,
        leaseId: lease.leaseId,
      }),
    ).resolves.toBeUndefined();
    expect(transport.deliver).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backend: 'host',
        profileId: 'writing-host',
        runnerId: 'trusted-writer-01',
        workspaceRoot: '/srv/ui4a/writing',
        task: task(),
      }),
    );

    await expect(
      backend.acceptResult({
        runnerId: heartbeat.runnerId,
        identity: heartbeat.identity,
        leaseId: lease.leaseId,
        result: {
          runId: 'agent-run-42',
          status: 'succeeded',
          resultHash: SHA_B,
          artifacts: [{ path: 'out/result.md', hash: SHA_A }],
        },
      }),
    ).resolves.toMatchObject({ status: 'succeeded', resultHash: SHA_B });

    const cancelLease = await backend.dispatch({
      task: task({ runId: 'agent-run-cancel' }),
      selectedProfileId: 'writing-host',
    });
    await backend.claim({ ...heartbeat, leaseId: cancelLease.leaseId });
    await backend.cancel({ runId: 'agent-run-cancel', reason: 'human_cancelled' });
    expect(transport.cancel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        runnerId: 'trusted-writer-01',
        leaseId: cancelLease.leaseId,
        reason: 'human_cancelled',
      }),
    );
    expect(backend.snapshot('agent-run-cancel')).toMatchObject({ status: 'canceled' });
  });

  it('survives disconnect, reconnect, and Worker restart without duplicate delivery or result', async () => {
    const fixture = await createFixture();
    const { backend, transport } = fixture;
    await backend.heartbeat(heartbeat);
    const lease = await backend.dispatch({ task: task(), selectedProfileId: 'writing-host' });
    await backend.claim({ ...heartbeat, leaseId: lease.leaseId });
    await backend.execute({ ...heartbeat, leaseId: lease.leaseId });
    await backend.execute({ ...heartbeat, leaseId: lease.leaseId });
    expect(transport.deliver).toHaveBeenCalledOnce();

    await backend.disconnect({ runnerId: heartbeat.runnerId, identity: heartbeat.identity });
    expect(backend.snapshot('agent-run-42')).toMatchObject({
      status: 'retryable-disconnect',
      restartBoundary: true,
    });
    await backend.heartbeat(heartbeat);

    const restarted = fixture.createHostRunnerBackend({
      registry: registry(),
      state: fixture.state,
      transport,
      clock: fixture.clock,
      fsFacts: fixture.fsFacts,
      heartbeatTtlMs: 10_000,
    });
    const duplicateLease = await restarted.dispatch({
      task: task(),
      selectedProfileId: 'writing-host',
    });
    expect(duplicateLease).toEqual(lease);
    await restarted.execute({ ...heartbeat, leaseId: lease.leaseId });
    expect(transport.deliver).toHaveBeenCalledOnce();

    const result = {
      runId: 'agent-run-42',
      status: 'succeeded' as const,
      resultHash: SHA_B,
      artifacts: [{ path: 'out/result.md', hash: SHA_A }],
    };
    const first = await restarted.acceptResult({ ...heartbeat, leaseId: lease.leaseId, result });
    const duplicate = await restarted.acceptResult({
      ...heartbeat,
      leaseId: lease.leaseId,
      result,
    });
    expect(duplicate).toEqual(first);
    await expect(
      restarted.acceptResult({
        ...heartbeat,
        leaseId: lease.leaseId,
        result: { ...result, resultHash: SHA_A },
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_RESULT_CONFLICT' }));
  });

  it.each(['/etc/passwd', '../secret', 'out/../../secret'])(
    'rejects invalid result path %s',
    async (path) => {
      const { backend } = await createFixture();
      await backend.heartbeat(heartbeat);
      const lease = await backend.dispatch({ task: task(), selectedProfileId: 'writing-host' });
      await backend.claim({ ...heartbeat, leaseId: lease.leaseId });
      await backend.execute({ ...heartbeat, leaseId: lease.leaseId });

      await expect(
        backend.acceptResult({
          ...heartbeat,
          leaseId: lease.leaseId,
          result: {
            runId: 'agent-run-42',
            status: 'succeeded',
            resultHash: SHA_B,
            artifacts: [{ path, hash: SHA_A }],
          },
        }),
      ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_PATH_INVALID' }));
    },
  );

  it('rejects a symlink that resolves outside the fixed workspace root', async () => {
    const { backend, fsFacts } = await createFixture();
    fsFacts.set('/srv/ui4a/writing/out/result.md', {
      kind: 'symlink',
      realPath: '/etc/passwd',
    });
    await backend.heartbeat(heartbeat);
    const lease = await backend.dispatch({ task: task(), selectedProfileId: 'writing-host' });
    await backend.claim({ ...heartbeat, leaseId: lease.leaseId });
    await backend.execute({ ...heartbeat, leaseId: lease.leaseId });

    await expect(
      backend.acceptResult({
        ...heartbeat,
        leaseId: lease.leaseId,
        result: {
          runId: 'agent-run-42',
          status: 'succeeded',
          resultHash: SHA_B,
          artifacts: [{ path: 'out/result.md', hash: SHA_A }],
        },
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_SYMLINK_ESCAPE' }));
  });

  it('expires a timed-out lease once and rejects a late result', async () => {
    const { backend, clock, transport } = await createFixture();
    await backend.heartbeat(heartbeat);
    const lease = await backend.dispatch({ task: task(), selectedProfileId: 'writing-host' });
    await backend.claim({ ...heartbeat, leaseId: lease.leaseId });
    await backend.execute({ ...heartbeat, leaseId: lease.leaseId });

    clock.advance(30_001);
    await backend.expireLeases();
    await backend.expireLeases();
    expect(backend.snapshot('agent-run-42')).toMatchObject({ status: 'timed-out' });
    expect(transport.cancel).toHaveBeenCalledOnce();
    await expect(
      backend.acceptResult({
        ...heartbeat,
        leaseId: lease.leaseId,
        result: {
          runId: 'agent-run-42',
          status: 'succeeded',
          resultHash: SHA_B,
          artifacts: [],
        },
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_LEASE_EXPIRED' }));
  });

  it.each(['backend', 'image', 'command', 'cwd', 'provider', 'model', 'env'])(
    'rejects user task override %s before lease or execution',
    async (field) => {
      const { backend, transport } = await createFixture();
      await backend.heartbeat(heartbeat);

      await expect(
        backend.dispatch({
          task: task({ [field]: field === 'env' ? { PATH: '/unsafe' } : 'request-controlled' }),
          selectedProfileId: 'writing-host',
        }),
      ).rejects.toEqual(expect.objectContaining({ code: 'HOST_RUNNER_TASK_OVERRIDE_FORBIDDEN' }));
      expect(transport.deliver).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the selected host is unavailable and exposes no K8s or wider fallback', async () => {
    const { backend, transport } = await createFixture();

    await expect(
      backend.dispatch({ task: task(), selectedProfileId: 'writing-host' }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'HOST_RUNNER_UNAVAILABLE',
        backend: 'host',
        retryable: true,
        fallbackAttempted: false,
      }),
    );
    expect(transport.deliver).not.toHaveBeenCalled();
    expect(JSON.stringify(backend.snapshot('agent-run-42'))).not.toMatch(
      /kubernetes|serviceAccount|cluster-admin|privileged/i,
    );
  });
});
