/**
 * worker 入口(T3 Phase C):Temporal worker 真身。
 *
 * - 显式 production profile 先通过统一部署预检，再使用 canonical Temporal
 *   address/namespace/taskQueue/identity；local demo 继续使用既有 env/default；
 * - 注册 workflows(notifyWorkflow)+ activities(notify);启动即轮询;
 * - 优雅退出:SIGINT/SIGTERM → worker.shutdown()(drain 在途 activity)→
 *   worker.run() 返回 → 关闭连接,进程自然退出,无残留。
 */
import { fileURLToPath } from 'node:url';

import { NativeConnection, Worker } from '@temporalio/worker';

import * as activities from './activities';
import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';
import { startWorkerHealthServer, workerReleaseMetadata } from './runtime-health';
import { createWorkerReadinessState, probeWorkerDependencies } from './worker-readiness';
import { runWorkerStartup } from './worker-startup';

async function main(): Promise<void> {
  if (process.argv[2] === '--version' || process.argv[2] === 'version') {
    console.log(JSON.stringify(workerReleaseMetadata()));
    return;
  }
  const workflowsPath = fileURLToPath(
    new URL(import.meta.url.endsWith('.ts') ? './workflows.ts' : './workflows.js', import.meta.url),
  );
  await runWorkerStartup(
    {
      preflight: runWorkerProductionDeploymentPreflight,
      connect: (options) => NativeConnection.connect(options),
      closeConnection: (connection) => connection.close(),
      createWorker: (options) =>
        Worker.create({
          ...options,
          // Worker 的 bundler 只以纯 workflows 模块为入口；Node/health 代码不进入 sandbox。
          workflowsPath,
          activities,
        }),
      createReadinessState: () => createWorkerReadinessState(),
      probeDependencies: () => probeWorkerDependencies({ db: activities.workerDb() }),
      startHealthServer: (environment, readiness) =>
        startWorkerHealthServer(environment, readiness),
      onSignal: (signal, handler) => process.on(signal, handler),
      log: (message) => console.log(message),
    },
    process.env,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ui4a] worker 启动失败: ${message}`);
  process.exit(1);
});
