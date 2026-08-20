import { APP_NAME, VERSION, heartbeatMessage } from '@ui4a/shared';

/** 启动日志行:绑定 shared 的 APP_NAME/VERSION,证明 worker 侧共享通路可用。 */
export function startupMessage(intervalMs: number): string {
  return `[${APP_NAME}] worker v${VERSION} started (heartbeat every ${intervalMs}ms)`;
}

/**
 * 计算下一次心跳前的等待毫秒数。当前为固定间隔策略;
 * 作为纯函数保留,后续能力平面若引入退避可只改这里。
 */
export function nextDelayMs(_tick: number, intervalMs: number): number {
  return intervalMs;
}

/** 心跳日志行:直接委托 shared 的 heartbeatMessage,全栈同格式。 */
export function formatHeartbeat(tick: number): string {
  return heartbeatMessage(tick);
}

/** 收到退出信号时的日志行。 */
export function shutdownMessage(signal: NodeJS.Signals): string {
  return `[ui4a] worker received ${signal}, exiting`;
}
