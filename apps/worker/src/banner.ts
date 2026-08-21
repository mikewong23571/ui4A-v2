import { APP_NAME, VERSION } from '@ui4a/shared';

/**
 * worker 启动横幅(T3 Phase C:原心跳循环删除,保留 VERSION 横幅证明 worker 侧
 * shared 通路可用)。心跳由 Temporal worker 自身的 poll 循环取代——worker 活着
 * 即在轮询 taskQueue,不再需要自造定时器。
 */
export interface WorkerBanner {
  taskQueue: string;
  address: string;
}

/** 启动日志行:绑定 shared 的 APP_NAME/VERSION + taskQueue 与 Temporal 地址。 */
export function startupBanner(info: WorkerBanner): string {
  return `[${APP_NAME}] worker v${VERSION} started (taskQueue=${info.taskQueue}, temporal=${info.address})`;
}

/** 收到退出信号、开始优雅关闭时的日志行。 */
export function shutdownBanner(signal: NodeJS.Signals): string {
  return `[ui4a] worker received ${signal}, shutting down`;
}
