import type { ProductionDeploymentConfig } from '@ui4a/shared';
import { describe, expect, it, vi } from 'vitest';

import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';
import { runWorkerStartup } from './worker-startup';
import { createWorkerReadinessState } from './worker-readiness';

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
    createReadinessState: vi.fn(() => createWorkerReadinessState()),
    probeDependencies: vi.fn(async () => ({
      postgres: { required: true as const, status: 'ok' as const },
      migration: { required: true as const, status: 'ok' as const },
      bootstrap: { required: true as const, status: 'ok' as const },
      replay: { required: true as const, status: 'ok' as const },
    })),
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

  it.each([
    [
      'PostgreSQL',
      {
        postgres: {
          required: true as const,
          status: 'error' as const,
          reasonCode: 'postgres_unavailable',
        },
        migration: {
          required: true as const,
          status: 'unknown' as const,
          reasonCode: 'migration_not_checked',
        },
        bootstrap: {
          required: true as const,
          status: 'unknown' as const,
          reasonCode: 'bootstrap_not_checked',
        },
        replay: {
          required: true as const,
          status: 'unknown' as const,
          reasonCode: 'replay_not_checked',
        },
      },
    ],
    [
      'migration',
      {
        postgres: { required: true as const, status: 'ok' as const },
        migration: {
          required: true as const,
          status: 'degraded' as const,
          reasonCode: 'migration_required',
        },
        bootstrap: {
          required: true as const,
          status: 'unknown' as const,
          reasonCode: 'bootstrap_not_checked',
        },
        replay: {
          required: true as const,
          status: 'unknown' as const,
          reasonCode: 'replay_not_checked',
        },
      },
    ],
    [
      'bootstrap',
      {
        postgres: { required: true as const, status: 'ok' as const },
        migration: { required: true as const, status: 'ok' as const },
        bootstrap: {
          required: true as const,
          status: 'degraded' as const,
          reasonCode: 'bootstrap_required',
        },
        replay: {
          required: true as const,
          status: 'unknown' as const,
          reasonCode: 'replay_not_checked',
        },
      },
    ],
    [
      'replay',
      {
        postgres: { required: true as const, status: 'ok' as const },
        migration: { required: true as const, status: 'ok' as const },
        bootstrap: { required: true as const, status: 'ok' as const },
        replay: {
          required: true as const,
          status: 'error' as const,
          reasonCode: 'replay_receipt_invalid',
        },
      },
    ],
  ])('never connects or serves when %s is not ready', async (_name, snapshot) => {
    const readiness = createWorkerReadinessState();
    const dependencies = startupDependencies({
      createReadinessState: vi.fn(() => readiness),
      probeDependencies: vi.fn(async () => snapshot),
    });

    await expect(runWorkerStartup(dependencies, {})).rejects.toThrow(
      /postgres_unavailable|migration_required|bootstrap_required|replay_receipt_invalid/,
    );
    expect(readiness.snapshot()).toMatchObject({ lifecycle: 'starting', status: 'not-ready' });
    expect(dependencies.connect).not.toHaveBeenCalled();
    expect(dependencies.createWorker).not.toHaveBeenCalled();
  });

  it('keeps starting/not-ready when Temporal connection fails', async () => {
    const readiness = createWorkerReadinessState();
    const dependencies = startupDependencies({
      createReadinessState: vi.fn(() => readiness),
      connect: vi.fn(async () => {
        throw new Error('secret-bearing Temporal failure');
      }),
    });

    await expect(runWorkerStartup(dependencies, {})).rejects.toThrow('temporal_unavailable');
    expect(readiness.snapshot()).toMatchObject({
      lifecycle: 'starting',
      status: 'not-ready',
      dependencies: {
        temporal: { status: 'error', reasonCode: 'temporal_unavailable' },
      },
    });
    expect(JSON.stringify(readiness.snapshot())).not.toContain('secret-bearing');
    expect(dependencies.createWorker).not.toHaveBeenCalled();
  });

  it('never becomes ready when Worker creation fails after Temporal connects', async () => {
    const readiness = createWorkerReadinessState();
    const closeConnection = vi.fn(async () => undefined);
    const dependencies = startupDependencies({
      createReadinessState: vi.fn(() => readiness),
      closeConnection,
      createWorker: vi.fn(async () => {
        throw new Error('worker_start_failed');
      }),
    });

    await expect(runWorkerStartup(dependencies, {})).rejects.toThrow('worker_start_failed');
    expect(readiness.snapshot()).toMatchObject({ lifecycle: 'starting', status: 'not-ready' });
    expect(closeConnection).toHaveBeenCalledOnce();
  });

  it('shuts down once on repeated signals, then closes health and Temporal connection', async () => {
    let finishRun: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRun = resolve;
        }),
    );
    const closeHealth = vi.fn();
    const closeConnection = vi.fn(async () => undefined);
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const readiness = createWorkerReadinessState();
    const shutdown = vi.fn(() => {
      expect(readiness.snapshot().lifecycle).toBe('draining');
      finishRun?.();
    });
    const dependencies = startupDependencies({
      connect: vi.fn(async () => ({ close: closeConnection })),
      closeConnection: vi.fn(async (connection) => {
        await (connection as { close(): Promise<void> }).close();
      }),
      createWorker: vi.fn(async () => ({ run, shutdown })),
      createReadinessState: vi.fn(() => readiness),
      startHealthServer: vi.fn(async () => ({ close: closeHealth })),
      onSignal: vi.fn((signal, handler) => signalHandlers.set(signal, handler)),
    });

    const startup = runWorkerStartup(dependencies, {});
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    signalHandlers.get('SIGTERM')?.();
    signalHandlers.get('SIGINT')?.();
    await startup;

    expect(shutdown).toHaveBeenCalledOnce();
    expect(readiness.snapshot()).toMatchObject({ lifecycle: 'draining', status: 'not-ready' });
    expect(closeHealth).toHaveBeenCalledOnce();
    expect(closeConnection).toHaveBeenCalledOnce();
  });
});
