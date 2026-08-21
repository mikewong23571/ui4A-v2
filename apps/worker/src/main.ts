/**
 * worker 入口(T3 Phase C):Temporal worker 真身。
 *
 * - 连接 Temporal dev server(缺省 localhost:7233,env TEMPORAL_ADDRESS 可覆盖,
 *   DECISIONS.md D4);taskQueue 固定 `ui4a`(web 派发与 worker 轮询的会合点);
 * - 注册 workflows(notifyWorkflow)+ activities(notify);启动即轮询;
 * - 优雅退出:SIGINT/SIGTERM → worker.shutdown()(drain 在途 activity)→
 *   worker.run() 返回 → 关闭连接,进程自然退出,无残留。
 */
import { fileURLToPath } from 'node:url';

import { NativeConnection, Worker } from '@temporalio/worker';

import * as activities from './activities';
import { shutdownBanner, startupBanner } from './banner';

const TASK_QUEUE = 'ui4a';
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

async function main(): Promise<void> {
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    // workflowsPath 指向源文件:worker 自带打包器把 workflow 模块隔离打包
    //(workflow 代码不得引入 Node API;tsx 只负责本入口进程)。
    workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
    activities,
  });

  console.log(startupBanner({ taskQueue: TASK_QUEUE, address: TEMPORAL_ADDRESS }));

  let shuttingDown = false;
  const requestShutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return; // 重复信号不重复关闭
    shuttingDown = true;
    console.log(shutdownBanner(signal));
    worker.shutdown();
  };
  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));

  await worker.run(); // 阻塞至优雅关闭完成
  await connection.close();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ui4a] worker 启动失败(temporal=${TEMPORAL_ADDRESS}): ${message}`);
  process.exit(1);
});
