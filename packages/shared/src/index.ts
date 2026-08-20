/** 应用名,全栈共享的唯一口径(web 页面标题、worker 日志前缀等)。 */
export const APP_NAME = 'UI4A';

/** 当前版本;与 packages/shared/package.json 的 version 保持一致(升版时同步改)。 */
export const VERSION = '0.1.0';

/**
 * 生成第 `tick` 次心跳的日志文案,格式 `[ui4a] heartbeat #<tick>`。
 * worker 空壳进程按固定间隔调用,后续真实能力平面复用同一格式。
 */
export function heartbeatMessage(tick: number): string {
  return `[ui4a] heartbeat #${tick}`;
}
