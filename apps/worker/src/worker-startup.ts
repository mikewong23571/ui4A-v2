import type { DeploymentEnvironment, ProductionDeploymentConfig } from '@ui4a/shared';

import { shutdownBanner, startupBanner } from './banner';

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
  connect(options: { address: string }): Promise<Connection>;
  closeConnection(connection: Connection): Promise<void>;
  createWorker(options: WorkerRegistrationOptions<Connection>): Promise<WorkerProcess>;
  startHealthServer(environment: DeploymentEnvironment): Promise<WorkerHealthServer>;
  onSignal(signal: NodeJS.Signals, handler: () => void): void;
  log(message: string): void;
}

interface WorkerStartupOptions {
  address: string;
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
      namespace: temporal.namespace,
      taskQueue: temporal.taskQueue,
      identity: temporal.workerIdentity,
    };
  }
  return {
    address: environment.TEMPORAL_ADDRESS ?? 'localhost:7233',
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
  const connection = await dependencies.connect({ address: options.address });
  let healthServer: WorkerHealthServer | undefined;

  try {
    const worker = await dependencies.createWorker({
      connection,
      namespace: options.namespace,
      taskQueue: options.taskQueue,
      ...(options.identity === undefined ? {} : { identity: options.identity }),
    });
    healthServer = await dependencies.startHealthServer(environment);
    dependencies.log(startupBanner({ taskQueue: options.taskQueue, address: options.address }));

    let shuttingDown = false;
    const requestShutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      dependencies.log(shutdownBanner(signal));
      worker.shutdown();
    };
    dependencies.onSignal('SIGINT', () => requestShutdown('SIGINT'));
    dependencies.onSignal('SIGTERM', () => requestShutdown('SIGTERM'));

    await worker.run();
  } finally {
    healthServer?.close();
    await dependencies.closeConnection(connection);
  }
}
