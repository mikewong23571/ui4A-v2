import { describe, expect, it, vi } from 'vitest';

import { runRunnerCommand, runRunnerMain, type RunnerCommandOptions } from './main.js';
import { createRunnerDeliveryProcessor, scheduleRunnerTimeout } from './process.js';

function commandHarness(overrides: RunnerCommandOptions = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    options: {
      environment: {},
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
      ...overrides,
    } satisfies RunnerCommandOptions,
  };
}

describe('Agent Runner command entrypoint', () => {
  it('runs pki-init from server-owned environment and emits no key material', async () => {
    const pkiInit = vi.fn(async () => ({
      status: 'created' as const,
      rootDirectory: '/var/lib/ui4a/ca',
      files: [
        {
          id: 'rootCertificate' as const,
          path: '/var/lib/ui4a/ca/root-ca.crt',
          sha256: `sha256:${'a'.repeat(64)}`,
          mode: 0o644 as const,
        },
      ],
    }));
    const environment = {
      UI4A_PKI_ROOT: '/var/lib/ui4a/ca',
      UI4A_HOST: 'ui4a.mothership.internal',
      KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
    };
    const harness = commandHarness({ environment, pkiInit });

    await expect(runRunnerMain(['pki-init'], harness.options)).resolves.toBe(0);
    expect(pkiInit).toHaveBeenCalledWith({
      rootDirectory: '/var/lib/ui4a/ca',
      ui4aHost: 'ui4a.mothership.internal',
      keycloakHost: 'auth.ui4a.mothership.internal',
    });
    expect(harness.stderr).toEqual([]);
    expect(JSON.parse(harness.stdout[0]!)).toMatchObject({ status: 'created' });
    expect(harness.stdout[0]).not.toContain('PRIVATE KEY');
  });

  it('maps a non-writable pki-init volume to stable EX_CANTCREAT without leaking details', async () => {
    const pkiInit = vi.fn(async () => {
      throw new Error('PKI_ROOT_NOT_WRITABLE');
    });
    const harness = commandHarness({ pkiInit });

    await expect(runRunnerMain(['pki-init'], harness.options)).resolves.toBe(73);
    expect(harness.stdout).toEqual([]);
    expect(JSON.parse(harness.stderr[0]!)).toEqual({
      status: 'failed',
      reasonCode: 'PKI_ROOT_NOT_WRITABLE',
    });
  });

  it('fails oneshot honestly with stable CONFIG exit when no delivery adapter is configured', async () => {
    const harness = commandHarness();

    await expect(runRunnerMain(['oneshot'], harness.options)).resolves.toBe(78);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toHaveLength(1);
    expect(JSON.parse(harness.stderr[0]!)).toMatchObject({
      status: 'unavailable',
      reasonCode: 'runner_delivery_not_configured',
    });
  });

  it('executes an injected sealed delivery and writes only its canonical result', async () => {
    const delivery = {
      schemaVersion: 1,
      deliveryId: 'delivery:oneshot:1',
      request: {
        schemaVersion: 1,
        runId: 'run:oneshot:1',
        specialization: 'writing',
        birth: {
          definitionRef: 'writing-agent@1',
          definitionHash: `sha256:${'1'.repeat(64)}`,
          promptHash: `sha256:${'2'.repeat(64)}`,
          runtimeHash: `sha256:${'3'.repeat(64)}`,
          taskContractHash: `sha256:${'4'.repeat(64)}`,
          resultContractHash: `sha256:${'5'.repeat(64)}`,
        },
        task: {
          contractRef: 'writing-task@1',
          payload: { instruction: 'Write the result.' },
          contextRefs: [],
        },
      },
      execution: {
        profileId: 'server-writing',
        backend: 'kubernetes-job',
        image: `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`,
        workspace: { rootRef: 'workspace:writing:1' },
        resources: { cpu: '1', memory: '1Gi', timeoutMs: 30_000 },
        networkPolicy: 'restricted',
        credentialRefs: [],
      },
    };
    const executor = vi.fn(async () => ({
      candidate: { markdown: '# Result' },
      artifacts: [],
    }));
    const processor = createRunnerDeliveryProcessor({
      resolveSecrets: async () => ({}),
      executor,
      scheduleTimeout: scheduleRunnerTimeout,
    });
    const readDelivery = vi.fn(async () => delivery);
    const oneshot = { processor, readDelivery };
    const harness = commandHarness({ oneshot });

    await expect(runRunnerMain(['oneshot'], harness.options)).resolves.toBe(0);
    expect(readDelivery).toHaveBeenCalledWith(harness.options.environment);
    expect(executor).toHaveBeenCalledOnce();
    expect(harness.stderr).toEqual([]);
    expect(JSON.parse(harness.stdout[0]!)).toMatchObject({
      deliveryId: 'delivery:oneshot:1',
      runId: 'run:oneshot:1',
      specialization: 'writing',
      status: 'succeeded',
      candidate: { markdown: '# Result' },
      resultHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it('uses the production Kubernetes one-shot adapter when no test adapter is injected', async () => {
    const readDelivery = vi.fn(async () => ({ sealed: 'delivery' }));
    const runnerResult = {
      schemaVersion: 1 as const,
      deliveryId: 'delivery:k8s:1',
      runId: 'run:k8s:1',
      specialization: 'writing' as const,
      status: 'succeeded' as const,
      birth: {
        definitionRef: 'writing@1',
        definitionHash: `sha256:${'1'.repeat(64)}`,
        promptHash: `sha256:${'2'.repeat(64)}`,
        runtimeHash: `sha256:${'3'.repeat(64)}`,
        taskContractHash: `sha256:${'4'.repeat(64)}`,
        resultContractHash: `sha256:${'5'.repeat(64)}`,
      },
      candidate: { markdown: '# K8s' },
      artifacts: [],
      resultHash: `sha256:${'6'.repeat(64)}`,
    };
    const processor = { execute: vi.fn(async () => runnerResult) };
    const productionOneshot = vi.fn(() => ({ processor, readDelivery }));
    const harness = commandHarness({ productionOneshot });

    await expect(runRunnerMain(['oneshot'], harness.options)).resolves.toBe(0);
    expect(productionOneshot).toHaveBeenCalledWith(harness.options.environment);
    expect(readDelivery).toHaveBeenCalledOnce();
    expect(processor.execute).toHaveBeenCalledWith({ sealed: 'delivery' }, undefined);
    expect(JSON.parse(harness.stdout[0]!)).toEqual(runnerResult);
  });

  it.each(['health', 'version', '--version'])(
    '%s exits zero with canonical non-GA metadata',
    async (command) => {
      const harness = commandHarness();

      await expect(runRunnerCommand(command, harness.options)).resolves.toBe(0);
      expect(harness.stderr).toEqual([]);
      const output = JSON.parse(harness.stdout[0]!) as Record<string, unknown>;
      const metadata = command === 'health' ? output.release : output;
      expect(metadata).toMatchObject({
        version: '0.1.0-experimental.1',
        channel: 'experimental',
        support: { ga: false, productionReady: false, sla: false, lts: false },
      });
    },
  );

  it('returns a structured non-zero failure for an unknown command', async () => {
    const harness = commandHarness();

    await expect(runRunnerCommand('not-a-command', harness.options)).resolves.toBe(1);
    expect(harness.stdout).toEqual([]);
    expect(JSON.parse(harness.stderr[0]!)).toEqual({
      status: 'failed',
      reason: 'unknown runner command: not-a-command',
    });
  });

  it('delegates daemon startup and returns zero only after it closes', async () => {
    const daemon = vi.fn(async () => undefined);
    const harness = commandHarness({ daemon });

    await expect(runRunnerMain([], harness.options)).resolves.toBe(0);
    expect(daemon).toHaveBeenCalledOnce();
    expect(daemon).toHaveBeenCalledWith(harness.options.environment);
  });

  it('reports daemon startup failure without a false success exit', async () => {
    const harness = commandHarness({
      daemon: async () => {
        throw new Error('bind failed');
      },
    });

    await expect(runRunnerCommand('daemon', harness.options)).resolves.toBe(1);
    expect(JSON.parse(harness.stderr[0]!)).toEqual({
      status: 'failed',
      reason: 'bind failed',
    });
  });
});
