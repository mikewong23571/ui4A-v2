import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const temporal = vi.hoisted(() => {
  const close = vi.fn(async () => undefined);
  const connection = { close };
  return {
    clientOptions: [] as unknown[],
    close,
    connect: vi.fn(async (options: unknown) => {
      void options;
      return connection;
    }),
    getHandle: vi.fn((workflowId: string) => {
      void workflowId;
      return { cancel: vi.fn(), terminate: vi.fn() };
    }),
    start: vi.fn(async (workflow: string, options: Record<string, unknown>) => {
      void workflow;
      void options;
      return { workflowId: 'fixture-workflow' };
    }),
  };
});

vi.mock('node:fs', () => ({
  readFileSync: vi.fn((path: string) => Buffer.from(`fixture:${path}`)),
}));

vi.mock('@temporalio/client', () => ({
  Connection: { connect: temporal.connect },
  Client: class {
    workflow = { start: temporal.start, getHandle: temporal.getHandle };

    constructor(options: unknown) {
      temporal.clientOptions.push(options);
    }
  },
}));

vi.mock('../production-deployment-preflight', () => ({
  runWebProductionDeploymentPreflight: vi.fn(() => ({
    settings: {
      temporal: {
        address: 'temporal-frontend.ui4a.svc.cluster.local:7233',
        namespace: 'ui4a',
        taskQueue: 'ui4a-agent-runs',
        testTaskQueue: 'ui4a-agent-runs-test',
        webIdentity: 'ui4a-web',
        workerIdentity: 'ui4a-worker',
        connectTimeoutMs: 15_000,
        transport: {
          mode: 'tls',
          serverName: 'temporal-frontend.ui4a.svc.cluster.local',
          caCertificatePath: '/run/tls/temporal/ca.crt',
          clientCertificatePath: '/run/tls/temporal/client.crt',
          clientPrivateKeyPath: '/run/tls/temporal/client.key',
        },
      },
    },
  })),
}));

import { dispatchAgentRun, resetTemporalAgentRunClientForTests } from './agent-run';
import { dispatchDelegation, resetTemporalDelegationClientForTests } from './delegation';
import { dispatchNotify, resetTemporalClientForTests } from './notify';

const confirmation = {
  id: 'c1',
  targetRel: 'post:first',
  targetAction: 'archive',
  params: {},
  proposedBy: { actor: 'agent' as const, principal: 'human-alice' },
  channel: 'oidc',
  policyReason: 'fixture confirmation policy',
};

async function dispatchAll(): Promise<void> {
  await dispatchNotify(confirmation);
  await dispatchDelegation({
    goal: { verb: 'publish' },
    driverKind: 'llm',
    baseUrl: 'https://ui4a.internal',
    principal: 'human-alice',
  });
  await dispatchAgentRun({
    runId: 'agent-1',
  } as Parameters<typeof dispatchAgentRun>[0]);
}

beforeEach(() => {
  vi.stubEnv('UI4A_DEPLOYMENT_PROFILE', 'production');
  vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');
  vi.stubEnv('TEMPORAL_ADDRESS', 'unused-temporal.invalid:9999');
  vi.stubEnv('UI4A_TASK_QUEUE', 'unused-queue');
  resetTemporalClientForTests();
  resetTemporalDelegationClientForTests();
  resetTemporalAgentRunClientForTests();
  temporal.clientOptions.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('one production Temporal adapter for all Web workflow clients (Red)', () => {
  it('reuses one connection with canonical address, timeout, and TLS transport', async () => {
    await dispatchAll();

    expect(temporal.connect).toHaveBeenCalledOnce();
    expect(temporal.connect).toHaveBeenCalledWith({
      address: 'temporal-frontend.ui4a.svc.cluster.local:7233',
      connectTimeout: 15_000,
      tls: {
        serverNameOverride: 'temporal-frontend.ui4a.svc.cluster.local',
        serverRootCACertificate: Buffer.from('fixture:/run/tls/temporal/ca.crt'),
        clientCertPair: {
          crt: Buffer.from('fixture:/run/tls/temporal/client.crt'),
          key: Buffer.from('fixture:/run/tls/temporal/client.key'),
        },
      },
    });
  });

  it('uses one namespace/identity and the canonical queue for all starts', async () => {
    await dispatchAll();

    expect(temporal.clientOptions).toEqual([
      expect.objectContaining({ namespace: 'ui4a', identity: 'ui4a-web' }),
    ]);
    expect(temporal.start).toHaveBeenCalledTimes(3);
    for (const [, options] of temporal.start.mock.calls) {
      expect(options).toMatchObject({ taskQueue: 'ui4a-agent-runs' });
    }
  });

  it('closes the shared connection exactly once when all client reset hooks run', async () => {
    await dispatchAll();

    resetTemporalClientForTests();
    resetTemporalDelegationClientForTests();
    resetTemporalAgentRunClientForTests();
    await vi.waitFor(() => expect(temporal.close).toHaveBeenCalledOnce());
  });
});
