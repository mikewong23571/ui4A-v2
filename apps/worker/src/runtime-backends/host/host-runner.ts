import { createHash } from 'node:crypto';

import type { RuntimeBackendSpi, SealedRunnerEnvelope } from '../backend';
import {
  SHA256_PATTERN,
  TERMINAL_STATUSES,
  type Capability,
  type HostRunState,
  type HostRunnerBackendDependencies,
  type HostRunnerFsFacts,
  type HostRunnerResult,
  type HostRunnerTask,
  type RegisteredRunner,
  type RunnerPresence,
} from './host-runner-types';
import {
  absoluteRoot,
  canonical,
  clone,
  containedBy,
  fail,
  runState,
  safeArtifactPath,
  sameMembers,
  validateRegistry,
  validateTask,
} from './host-runner-validation';

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

  const runnerOps = {
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

  const prepare: RuntimeBackendSpi['prepare'] = async (envelope) => {
    if (dependencies.runtimeExecution === undefined) fail('HOST_RUNNER_UNAVAILABLE', true);
    const lease = await runnerOps.dispatch({
      task: {
        schemaVersion: 1,
        runId: `run-${createHash('sha256').update(envelope.runId).digest('hex').slice(0, 40)}`,
        capability: envelope.specialization,
        birth: {
          definitionHash: envelope.birth.definitionHash,
          promptHash: envelope.birth.promptHash,
          runtimeHash: envelope.birth.runtimeHash,
        },
        payload: { delivery: envelope },
      },
      selectedProfileId: envelope.execution.profileId,
    });
    return { handle: lease.leaseId };
  };

  const spiExecute: RuntimeBackendSpi['execute'] = async (envelope, prepared, controls) => {
    if (dependencies.runtimeExecution === undefined) fail('HOST_RUNNER_UNAVAILABLE', true);
    return dependencies.runtimeExecution.execute({
      envelope,
      handle: prepared.handle,
      signal: controls.signal,
      ...(controls.checkpoint === undefined ? {} : { checkpoint: controls.checkpoint }),
      heartbeat: controls.heartbeat,
    });
  };

  function execute(input: { runnerId: string; identity: string; leaseId: string }): Promise<void>;
  function execute(
    envelope: SealedRunnerEnvelope,
    prepared: { handle: string },
    controls: Parameters<RuntimeBackendSpi['execute']>[2],
  ): ReturnType<RuntimeBackendSpi['execute']>;
  function execute(
    first: SealedRunnerEnvelope | { runnerId: string; identity: string; leaseId: string },
    prepared?: { handle: string },
    controls?: Parameters<RuntimeBackendSpi['execute']>[2],
  ): Promise<void | { status: 'completed'; backendOutput: unknown; transport?: unknown }> {
    if ('runnerId' in first) return runnerOps.execute(first);
    if (prepared === undefined || controls === undefined) fail('HOST_RUNNER_LEASE_INVALID');
    return spiExecute(first, prepared, controls);
  }

  const collect: RuntimeBackendSpi['collect'] = async (envelope, execution) => {
    if (dependencies.runtimeExecution === undefined) fail('HOST_RUNNER_UNAVAILABLE', true);
    return dependencies.runtimeExecution.collect({ envelope, execution });
  };

  return { ...runnerOps, kind: 'trusted-host' as const, prepare, execute, collect };
}
