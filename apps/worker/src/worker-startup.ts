import type { DeploymentEnvironment, ProductionDeploymentConfig } from '@ui4a/shared';

import { shutdownBanner, startupBanner } from './banner';
import type { WorkerTemporalConnectionOptions } from './temporal-connection';
import type { WorkerPersistentDependencySnapshot, WorkerReadinessState } from './worker-readiness';

export interface WorkerProcess {
  run(): Promise<void>;
  shutdown(): void;
}

export interface WorkerHealthServer {
  close(): void;
}

export interface WorkerRegistrationOptions<Connection> {
  connection: Connection;
  namespace: string;
  taskQueue: string;
  identity?: string;
}

export interface WorkerStartupDependencies<Connection> {
  preflight(environment: DeploymentEnvironment): ProductionDeploymentConfig | undefined;
  connect(options: WorkerTemporalConnectionOptions): Promise<Connection>;
  closeConnection(connection: Connection): Promise<void>;
  createWorker(options: WorkerRegistrationOptions<Connection>): Promise<WorkerProcess>;
  createReadinessState(): WorkerReadinessState;
  probeDependencies(
    config: ProductionDeploymentConfig | undefined,
    environment: DeploymentEnvironment,
  ): Promise<WorkerPersistentDependencySnapshot>;
  startHealthServer(
    environment: DeploymentEnvironment,
    readiness: WorkerReadinessState,
  ): Promise<WorkerHealthServer>;
  onSignal(signal: NodeJS.Signals, handler: () => void): void;
  log(message: string): void;
}

interface WorkerStartupOptions extends WorkerTemporalConnectionOptions {
  namespace: string;
  taskQueue: string;
  identity?: string;
}

function workerStartupOptions(
  productionConfig: ProductionDeploymentConfig | undefined,
  environment: DeploymentEnvironment,
): WorkerStartupOptions {
  const temporal = productionConfig?.settings.temporal;
  if (temporal !== undefined) {
    return {
      address: temporal.address,
      connectTimeoutMs: temporal.connectTimeoutMs,
      transport: temporal.transport,
      namespace: temporal.namespace,
      taskQueue: temporal.taskQueue,
      identity: temporal.workerIdentity,
    };
  }
  return {
    address: environment.TEMPORAL_ADDRESS ?? 'localhost:7233',
    connectTimeoutMs: 10_000,
    transport: { mode: 'istio' },
    namespace: 'default',
    taskQueue: environment.UI4A_TASK_QUEUE ?? 'ui4a',
  };
}

/**
 * Compose the Worker process after fail-closed deployment preflight.
 *
 * Temporal and health implementations stay injected so tests can prove ordering without
 * starting a real server. Production still binds the canonical Worker and workflow bundle in
 * main.ts.
 */
export async function runWorkerStartup<Connection>(
  dependencies: WorkerStartupDependencies<Connection>,
  environment: DeploymentEnvironment = process.env,
): Promise<void> {
  const productionConfig = dependencies.preflight(environment);
  const options = workerStartupOptions(productionConfig, environment);
  const readiness = dependencies.createReadinessState();
  readiness.markDependency('config', 'ok');
  let healthServer: WorkerHealthServer | undefined;
  let connection: Connection | undefined;

  try {
    healthServer = await dependencies.startHealthServer(environment, readiness);
    const persistent = await dependencies.probeDependencies(productionConfig, environment);
    for (const dependency of ['postgres', 'migration', 'bootstrap', 'replay'] as const) {
      readiness.markDependency(
        dependency,
        persistent[dependency].status,
        persistent[dependency].reasonCode,
      );
    }
    const failedPersistent = (['postgres', 'migration', 'bootstrap', 'replay'] as const).find(
      (dependency) => persistent[dependency].status !== 'ok',
    );
    if (failedPersistent !== undefined) {
      throw new Error(
        persistent[failedPersistent].reasonCode ?? 'worker_persistent_dependency_not_ready',
      );
    }

    try {
      connection = await dependencies.connect({
        address: options.address,
        connectTimeoutMs: options.connectTimeoutMs,
        transport: options.transport,
      });
      readiness.markDependency('temporal', 'ok');
    } catch {
      readiness.markDependency('temporal', 'error', 'temporal_unavailable');
      throw new Error('temporal_unavailable');
    }
    const worker = await dependencies.createWorker({
      connection,
      namespace: options.namespace,
      taskQueue: options.taskQueue,
      ...(options.identity === undefined ? {} : { identity: options.identity }),
    });
    readiness.markServing();
    dependencies.log(startupBanner({ taskQueue: options.taskQueue, address: options.address }));

    let shuttingDown = false;
    const requestShutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      readiness.beginDraining();
      dependencies.log(shutdownBanner(signal));
      worker.shutdown();
    };
    dependencies.onSignal('SIGINT', () => requestShutdown('SIGINT'));
    dependencies.onSignal('SIGTERM', () => requestShutdown('SIGTERM'));

    await worker.run();
  } finally {
    if (readiness.snapshot().lifecycle === 'serving') readiness.beginDraining();
    healthServer?.close();
    if (connection !== undefined) await dependencies.closeConnection(connection);
  }
}
