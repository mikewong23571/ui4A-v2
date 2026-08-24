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

interface RegisteredRunner {
  id: string;
  authenticatedIdentity: string;
  capabilities: Capability[];
  workspaceRoots: string[];
}

interface HostRunnerProfile {
  id: string;
  runnerId: string;
  capability: Capability;
  workspaceRoot: string;
  timeoutMs: number;
}

interface HostRunnerRegistry {
  runners: RegisteredRunner[];
  profiles: HostRunnerProfile[];
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

interface HostRunnerBackendDependencies {
  registry: HostRunnerRegistry;
  state: HostRunnerStateStore;
  transport: HostRunnerTransport;
  clock: { nowMs(): number };
  fsFacts: HostRunnerFsFacts;
  heartbeatTtlMs: number;
}

interface HostRunnerResult {
  runId: string;
  status: 'succeeded' | 'failed';
  resultHash: string;
  artifacts: Array<{ path: string; hash: string }>;
}

type HostRunStatus =
  | 'unavailable'
  | 'leased'
  | 'claimed'
  | 'delivering'
  | 'executing'
  | 'retryable-disconnect'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'timed-out';

interface HostRunState {
  schemaVersion: 1;
  backend: 'host';
  runId: string;
  profileId: string;
  runnerId: string;
  workspaceRoot: string;
  task: HostRunnerTask;
  leaseId: string;
  leaseUntilMs: number;
  status: HostRunStatus;
  delivered: boolean;
  cancelSent: boolean;
  restartBoundary: boolean;
  fallbackAttempted: false;
  result?: HostRunnerResult;
  resultHash?: string;
}

interface RunnerPresence {
  leaseUntilMs: number;
}

type HostRunnerErrorCode =
  | 'HOST_RUNNER_CAPABILITY_ESCALATION'
  | 'HOST_RUNNER_IDENTITY_INVALID'
  | 'HOST_RUNNER_LEASE_EXPIRED'
  | 'HOST_RUNNER_LEASE_INVALID'
  | 'HOST_RUNNER_FILESYSTEM_FACT_INVALID'
  | 'HOST_RUNNER_PATH_INVALID'
  | 'HOST_RUNNER_PROFILE_INVALID'
  | 'HOST_RUNNER_REGISTRY_INVALID'
  | 'HOST_RUNNER_RESULT_CONFLICT'
  | 'HOST_RUNNER_RESULT_INVALID'
  | 'HOST_RUNNER_ROOT_ESCALATION'
  | 'HOST_RUNNER_STATE_CONFLICT'
  | 'HOST_RUNNER_SYMLINK_ESCAPE'
  | 'HOST_RUNNER_TASK_INVALID'
  | 'HOST_RUNNER_TASK_OVERRIDE_FORBIDDEN'
  | 'HOST_RUNNER_TRANSPORT_FAILED'
  | 'HOST_RUNNER_UNAVAILABLE';

class HostRunnerError extends Error {
  readonly backend = 'host';
  readonly fallbackAttempted = false;

  constructor(
    readonly code: HostRunnerErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = 'HostRunnerError';
  }
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FORBIDDEN_TASK_FIELDS = [
  'backend',
  'image',
  'command',
  'cwd',
  'provider',
  'model',
  'env',
] as const;
const TERMINAL_STATUSES = new Set<HostRunStatus>(['succeeded', 'failed', 'canceled', 'timed-out']);

function fail(code: HostRunnerErrorCode, retryable = false): never {
  throw new HostRunnerError(code, retryable);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(',')}}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function absoluteRoot(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').some((part) => part === '.' || part === '..')
  );
}

function validateRegistry(registry: HostRunnerRegistry): void {
  const runners = new Map<string, RegisteredRunner>();
  for (const runner of registry.runners) {
    if (
      !STABLE_ID_PATTERN.test(runner.id) ||
      runner.authenticatedIdentity.trim() === '' ||
      runner.capabilities.length === 0 ||
      new Set(runner.capabilities).size !== runner.capabilities.length ||
      runner.workspaceRoots.length === 0 ||
      runner.workspaceRoots.some((root) => !absoluteRoot(root)) ||
      new Set(runner.workspaceRoots).size !== runner.workspaceRoots.length ||
      runners.has(runner.id)
    ) {
      fail('HOST_RUNNER_REGISTRY_INVALID');
    }
    runners.set(runner.id, runner);
  }

  const profileIds = new Set<string>();
  for (const profile of registry.profiles) {
    const runner = runners.get(profile.runnerId);
    if (
      !STABLE_ID_PATTERN.test(profile.id) ||
      profileIds.has(profile.id) ||
      runner === undefined ||
      !runner.capabilities.includes(profile.capability) ||
      !runner.workspaceRoots.includes(profile.workspaceRoot) ||
      !Number.isSafeInteger(profile.timeoutMs) ||
      profile.timeoutMs < 1
    ) {
      fail('HOST_RUNNER_REGISTRY_INVALID');
    }
    profileIds.add(profile.id);
  }
}

function validateTask(task: HostRunnerTask): void {
  if (FORBIDDEN_TASK_FIELDS.some((field) => Object.hasOwn(task, field))) {
    fail('HOST_RUNNER_TASK_OVERRIDE_FORBIDDEN');
  }
  if (
    task.schemaVersion !== 1 ||
    !RUN_ID_PATTERN.test(task.runId) ||
    (task.capability !== 'coding' &&
      task.capability !== 'writing' &&
      task.capability !== 'authoring') ||
    typeof task.birth !== 'object' ||
    task.birth === null ||
    !SHA256_PATTERN.test(task.birth.definitionHash) ||
    !SHA256_PATTERN.test(task.birth.promptHash) ||
    !SHA256_PATTERN.test(task.birth.runtimeHash)
  ) {
    fail('HOST_RUNNER_TASK_INVALID');
  }
}

function runState(value: unknown): HostRunState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Partial<HostRunState>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.backend !== 'host' ||
    typeof candidate.runId !== 'string' ||
    typeof candidate.leaseId !== 'string'
  ) {
    return undefined;
  }
  return candidate as HostRunState;
}

function safeArtifactPath(path: string): boolean {
  const segments = path.split('/');
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !/^[A-Za-z]:/u.test(path) &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function containedBy(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Create the trusted-host activity adapter. All external facts remain injected: the registry owns
 * grants, the store owns restart state, and transport/filesystem implementations stay outside.
 */
export function createHostRunnerBackend(dependencies: HostRunnerBackendDependencies) {
  validateRegistry(dependencies.registry);
  if (!Number.isSafeInteger(dependencies.heartbeatTtlMs) || dependencies.heartbeatTtlMs < 1) {
    fail('HOST_RUNNER_REGISTRY_INVALID');
  }
  const runners = new Map(dependencies.registry.runners.map((runner) => [runner.id, runner]));
  const profiles = new Map(dependencies.registry.profiles.map((profile) => [profile.id, profile]));
  const presence = new Map<string, RunnerPresence>();

  const registeredRunner = (runnerId: string, identity: string): RegisteredRunner => {
    const runner = runners.get(runnerId);
    if (runner === undefined || runner.authenticatedIdentity !== identity) {
      fail('HOST_RUNNER_IDENTITY_INVALID');
    }
    return runner;
  };

  const findByLease = (leaseId: string): HostRunState => {
    const found = dependencies.state
      .list()
      .map(runState)
      .find((state) => state?.leaseId === leaseId);
    if (found === undefined) fail('HOST_RUNNER_LEASE_INVALID');
    return found;
  };

  const save = (state: HostRunState): void => {
    dependencies.state.save(state.runId, clone(state));
  };

  const runnerOnline = (runnerId: string): boolean => {
    const online = presence.get(runnerId);
    return online !== undefined && online.leaseUntilMs >= dependencies.clock.nowMs();
  };

  const ensureLeaseUsable = (state: HostRunState): void => {
    if (state.status === 'timed-out' || dependencies.clock.nowMs() > state.leaseUntilMs) {
      fail('HOST_RUNNER_LEASE_EXPIRED');
    }
    if (state.status === 'canceled') fail('HOST_RUNNER_LEASE_INVALID');
  };

  const cancelOnce = async (state: HostRunState, reason: string): Promise<void> => {
    if (state.cancelSent) return;
    state.cancelSent = true;
    save(state);
    try {
      await dependencies.transport.cancel({
        backend: 'host',
        runId: state.runId,
        runnerId: state.runnerId,
        leaseId: state.leaseId,
        reason,
      });
    } catch (error) {
      void error;
      state.cancelSent = false;
      save(state);
      fail('HOST_RUNNER_TRANSPORT_FAILED', true);
    }
  };

  return {
    async heartbeat(input: {
      runnerId: string;
      identity: string;
      capabilities: Capability[];
      workspaceRoots: string[];
    }) {
      const runner = registeredRunner(input.runnerId, input.identity);
      if (!sameMembers(input.capabilities, runner.capabilities)) {
        fail('HOST_RUNNER_CAPABILITY_ESCALATION');
      }
      if (!sameMembers(input.workspaceRoots, runner.workspaceRoots)) {
        fail('HOST_RUNNER_ROOT_ESCALATION');
      }
      const leaseUntilMs = dependencies.clock.nowMs() + dependencies.heartbeatTtlMs;
      presence.set(runner.id, { leaseUntilMs });
      return { runnerId: runner.id, status: 'online' as const, leaseUntilMs };
    },

    async disconnect(input: { runnerId: string; identity: string }): Promise<void> {
      registeredRunner(input.runnerId, input.identity);
      presence.delete(input.runnerId);
      for (const value of dependencies.state.list()) {
        const state = runState(value);
        if (
          state !== undefined &&
          state.runnerId === input.runnerId &&
          !TERMINAL_STATUSES.has(state.status) &&
          state.status !== 'unavailable'
        ) {
          state.status = 'retryable-disconnect';
          state.restartBoundary = true;
          save(state);
        }
      }
    },

    async dispatch(input: { task: HostRunnerTask; selectedProfileId: string }) {
      validateTask(input.task);
      const profile = profiles.get(input.selectedProfileId);
      if (profile === undefined || profile.capability !== input.task.capability) {
        fail('HOST_RUNNER_PROFILE_INVALID');
      }
      const runner = runners.get(profile.runnerId);
      if (runner === undefined) fail('HOST_RUNNER_PROFILE_INVALID');

      const existing = runState(dependencies.state.load(input.task.runId));
      if (existing !== undefined) {
        if (
          existing.profileId !== profile.id ||
          canonical(existing.task) !== canonical(input.task)
        ) {
          fail('HOST_RUNNER_STATE_CONFLICT');
        }
        if (existing.status === 'unavailable') {
          if (!runnerOnline(runner.id)) fail('HOST_RUNNER_UNAVAILABLE', true);
          existing.status = 'leased';
          existing.leaseUntilMs = dependencies.clock.nowMs() + profile.timeoutMs;
          save(existing);
        }
        return {
          leaseId: existing.leaseId,
          runnerId: existing.runnerId,
          profileId: existing.profileId,
          workspaceRoot: existing.workspaceRoot,
        };
      }

      if (!runnerOnline(runner.id)) {
        const unavailable: HostRunState = {
          schemaVersion: 1,
          backend: 'host',
          runId: input.task.runId,
          profileId: profile.id,
          runnerId: runner.id,
          workspaceRoot: profile.workspaceRoot,
          task: clone(input.task),
          leaseId: `host:${runner.id}:${input.task.runId}`,
          leaseUntilMs: dependencies.clock.nowMs(),
          status: 'unavailable',
          delivered: false,
          cancelSent: false,
          restartBoundary: false,
          fallbackAttempted: false,
        };
        save(unavailable);
        fail('HOST_RUNNER_UNAVAILABLE', true);
      }

      const state: HostRunState = {
        schemaVersion: 1,
        backend: 'host',
        runId: input.task.runId,
        profileId: profile.id,
        runnerId: runner.id,
        workspaceRoot: profile.workspaceRoot,
        task: clone(input.task),
        leaseId: `host:${runner.id}:${input.task.runId}`,
        leaseUntilMs: dependencies.clock.nowMs() + profile.timeoutMs,
        status: 'leased',
        delivered: false,
        cancelSent: false,
        restartBoundary: false,
        fallbackAttempted: false,
      };
      save(state);
      return {
        leaseId: state.leaseId,
        runnerId: state.runnerId,
        profileId: state.profileId,
        workspaceRoot: state.workspaceRoot,
      };
    },

    async claim(input: { runnerId: string; identity: string; leaseId: string }): Promise<void> {
      registeredRunner(input.runnerId, input.identity);
      const state = findByLease(input.leaseId);
      if (state.runnerId !== input.runnerId) fail('HOST_RUNNER_IDENTITY_INVALID');
      ensureLeaseUsable(state);
      if (!runnerOnline(state.runnerId)) fail('HOST_RUNNER_UNAVAILABLE', true);
      if (state.status === 'leased' || state.status === 'retryable-disconnect') {
        state.status = 'claimed';
        save(state);
        return;
      }
      if (state.status === 'claimed' || state.status === 'executing') return;
      fail('HOST_RUNNER_LEASE_INVALID');
    },

    async execute(input: { runnerId: string; identity: string; leaseId: string }): Promise<void> {
      registeredRunner(input.runnerId, input.identity);
      const state = findByLease(input.leaseId);
      if (state.runnerId !== input.runnerId) fail('HOST_RUNNER_IDENTITY_INVALID');
      ensureLeaseUsable(state);
      if (state.delivered) {
        if (state.status === 'retryable-disconnect') {
          state.status = 'executing';
          save(state);
        }
        return;
      }
      if (!runnerOnline(state.runnerId)) fail('HOST_RUNNER_UNAVAILABLE', true);
      if (state.status !== 'claimed') fail('HOST_RUNNER_LEASE_INVALID');

      state.status = 'delivering';
      state.delivered = true;
      save(state);
      try {
        await dependencies.transport.deliver({
          schemaVersion: 1,
          backend: 'host',
          profileId: state.profileId,
          runnerId: state.runnerId,
          leaseId: state.leaseId,
          leaseUntilMs: state.leaseUntilMs,
          workspaceRoot: state.workspaceRoot,
          task: clone(state.task),
        });
      } catch (error) {
        void error;
        state.status = 'claimed';
        state.delivered = false;
        save(state);
        fail('HOST_RUNNER_TRANSPORT_FAILED', true);
      }
      state.status = 'executing';
      save(state);
    },

    async acceptResult(input: {
      runnerId: string;
      identity: string;
      leaseId: string;
      result: HostRunnerResult;
    }) {
      registeredRunner(input.runnerId, input.identity);
      const state = findByLease(input.leaseId);
      if (state.runnerId !== input.runnerId) fail('HOST_RUNNER_IDENTITY_INVALID');
      if (state.result !== undefined) {
        if (canonical(state.result) !== canonical(input.result)) {
          fail('HOST_RUNNER_RESULT_CONFLICT');
        }
        return clone(state);
      }
      ensureLeaseUsable(state);
      if (
        state.status !== 'executing' ||
        input.result.runId !== state.runId ||
        (input.result.status !== 'succeeded' && input.result.status !== 'failed') ||
        !SHA256_PATTERN.test(input.result.resultHash) ||
        !Array.isArray(input.result.artifacts)
      ) {
        fail('HOST_RUNNER_RESULT_INVALID');
      }

      for (const artifact of input.result.artifacts) {
        if (!safeArtifactPath(artifact.path) || !SHA256_PATTERN.test(artifact.hash)) {
          fail('HOST_RUNNER_PATH_INVALID');
        }
        const candidatePath = `${state.workspaceRoot}/${artifact.path}`;
        let fact: ReturnType<HostRunnerFsFacts['resolve']>;
        try {
          fact = dependencies.fsFacts.resolve(candidatePath);
        } catch (error) {
          void error;
          fail('HOST_RUNNER_FILESYSTEM_FACT_INVALID');
        }
        if (
          (fact.kind !== 'file' && fact.kind !== 'directory' && fact.kind !== 'symlink') ||
          !absoluteRoot(fact.realPath) ||
          fact.kind === 'directory'
        ) {
          fail('HOST_RUNNER_FILESYSTEM_FACT_INVALID');
        }
        if (!containedBy(state.workspaceRoot, fact.realPath)) {
          fail(fact.kind === 'symlink' ? 'HOST_RUNNER_SYMLINK_ESCAPE' : 'HOST_RUNNER_PATH_INVALID');
        }
      }

      state.status = input.result.status;
      state.result = clone(input.result);
      state.resultHash = input.result.resultHash;
      save(state);
      return clone(state);
    },

    async cancel(input: { runId: string; reason: string }): Promise<void> {
      const state = runState(dependencies.state.load(input.runId));
      if (state === undefined) fail('HOST_RUNNER_LEASE_INVALID');
      if (state.status === 'canceled') return;
      if (TERMINAL_STATUSES.has(state.status)) fail('HOST_RUNNER_LEASE_INVALID');
      await cancelOnce(state, input.reason);
      state.status = 'canceled';
      save(state);
    },

    async expireLeases(): Promise<void> {
      for (const value of dependencies.state.list()) {
        const state = runState(value);
        if (
          state !== undefined &&
          !TERMINAL_STATUSES.has(state.status) &&
          state.status !== 'unavailable' &&
          dependencies.clock.nowMs() > state.leaseUntilMs
        ) {
          state.status = 'timed-out';
          save(state);
          await cancelOnce(state, 'lease_timeout');
        }
      }
    },

    snapshot(runId: string): unknown {
      const state = runState(dependencies.state.load(runId));
      return state === undefined ? undefined : clone(state);
    },
  };
}
