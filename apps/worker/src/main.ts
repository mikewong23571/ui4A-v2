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
import { shutdownBanner, startupBanner } from './banner';
import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';
import { startWorkerHealthServer, workerReleaseMetadata } from './runtime-health';

async function main(): Promise<void> {
  if (process.argv[2] === '--version' || process.argv[2] === 'version') {
    console.log(JSON.stringify(workerReleaseMetadata()));
    return;
  }
  const productionConfig = runWorkerProductionDeploymentPreflight();
  const taskQueue =
    productionConfig?.settings.temporal.taskQueue ?? process.env.UI4A_TASK_QUEUE ?? 'ui4a';
  const temporalAddress =
    productionConfig?.settings.temporal.address ?? process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = productionConfig?.settings.temporal.namespace ?? 'default';
  const identity = productionConfig?.settings.temporal.workerIdentity;

  const connection = await NativeConnection.connect({ address: temporalAddress });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    ...(identity === undefined ? {} : { identity }),
    // workflowsPath 指向源文件:worker 自带打包器把 workflow 模块隔离打包
    //(workflow 代码不得引入 Node API;tsx 只负责本入口进程)。
    workflowsPath: fileURLToPath(
      new URL(
        import.meta.url.endsWith('.ts') ? './workflows.ts' : './workflows.js',
        import.meta.url,
      ),
    ),
    activities,
  });

  const healthServer = await startWorkerHealthServer();
  console.log(startupBanner({ taskQueue, address: temporalAddress }));

  let shuttingDown = false;
  const requestShutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return; // 重复信号不重复关闭
    shuttingDown = true;
    console.log(shutdownBanner(signal));
    worker.shutdown();
  };
  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));

  try {
    await worker.run(); // 阻塞至优雅关闭完成
  } finally {
    healthServer.close();
    await connection.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ui4a] worker 启动失败: ${message}`);
  process.exit(1);
});
