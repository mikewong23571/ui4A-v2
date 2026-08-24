import type { ProductionDeploymentConfig } from '@ui4a/shared';
import { describe, expect, it, vi } from 'vitest';

import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';
import { runWorkerStartup } from './worker-startup';

function productionConfig(): ProductionDeploymentConfig {
  return {
    settings: {
      temporal: {
        address: 'temporal.ui4a.svc:7233',
        namespace: 'ui4a-production',
        taskQueue: 'ui4a-production-worker',
        workerIdentity: 'worker-0.ui4a',
      },
    },
  } as ProductionDeploymentConfig;
}

function startupDependencies(
  overrides: Partial<Parameters<typeof runWorkerStartup<unknown>>[0]> = {},
): Parameters<typeof runWorkerStartup<unknown>>[0] {
  return {
    preflight: vi.fn(() => undefined),
    connect: vi.fn(async () => 'connection'),
    closeConnection: vi.fn(async () => undefined),
    createWorker: vi.fn(async () => ({ run: vi.fn(async () => undefined), shutdown: vi.fn() })),
    startHealthServer: vi.fn(async () => ({ close: vi.fn() })),
    onSignal: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('Worker startup composition', () => {
  it('passes the canonical production Temporal settings without local fallback', async () => {
    const createWorker = vi.fn(async () => ({
      run: vi.fn(async () => undefined),
      shutdown: vi.fn(),
    }));
    const dependencies = startupDependencies({
      preflight: vi.fn(() => productionConfig()),
      createWorker,
    });

    await runWorkerStartup(dependencies, {
      TEMPORAL_ADDRESS: 'localhost:9999',
      UI4A_TASK_QUEUE: 'local-queue',
    });

    expect(dependencies.connect).toHaveBeenCalledExactlyOnceWith({
      address: 'temporal.ui4a.svc:7233',
    });
    expect(createWorker).toHaveBeenCalledExactlyOnceWith({
      connection: 'connection',
      namespace: 'ui4a-production',
      taskQueue: 'ui4a-production-worker',
      identity: 'worker-0.ui4a',
    });
  });

  it('keeps localhost, default namespace, and env overrides in the local profile only', async () => {
    const createWorker = vi.fn(async () => ({
      run: vi.fn(async () => undefined),
      shutdown: vi.fn(),
    }));
    const dependencies = startupDependencies({ createWorker });

    await runWorkerStartup(dependencies, {});

    expect(dependencies.connect).toHaveBeenCalledExactlyOnceWith({ address: 'localhost:7233' });
    expect(createWorker).toHaveBeenCalledExactlyOnceWith({
      connection: 'connection',
      namespace: 'default',
      taskQueue: 'ui4a',
    });
  });

  it('performs no Temporal or health action when production preflight fails', async () => {
    const dependencies = startupDependencies({
      preflight: runWorkerProductionDeploymentPreflight,
    });

    await expect(
      runWorkerStartup(dependencies, { UI4A_DEPLOYMENT_PROFILE: 'production' }),
    ).rejects.toThrow(/settings|UI4A_DEPLOYMENT_SETTINGS/i);

    expect(dependencies.connect).not.toHaveBeenCalled();
    expect(dependencies.createWorker).not.toHaveBeenCalled();
    expect(dependencies.startHealthServer).not.toHaveBeenCalled();
  });

  it('shuts down once on repeated signals, then closes health and Temporal connection', async () => {
    let finishRun: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRun = resolve;
        }),
    );
    const shutdown = vi.fn(() => finishRun?.());
    const closeHealth = vi.fn();
    const closeConnection = vi.fn(async () => undefined);
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const dependencies = startupDependencies({
      connect: vi.fn(async () => ({ close: closeConnection })),
      closeConnection: vi.fn(async (connection) => {
        await (connection as { close(): Promise<void> }).close();
      }),
      createWorker: vi.fn(async () => ({ run, shutdown })),
      startHealthServer: vi.fn(async () => ({ close: closeHealth })),
      onSignal: vi.fn((signal, handler) => signalHandlers.set(signal, handler)),
    });

    const startup = runWorkerStartup(dependencies, {});
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    signalHandlers.get('SIGTERM')?.();
    signalHandlers.get('SIGINT')?.();
    await startup;

    expect(shutdown).toHaveBeenCalledOnce();
    expect(closeHealth).toHaveBeenCalledOnce();
    expect(closeConnection).toHaveBeenCalledOnce();
  });
});
