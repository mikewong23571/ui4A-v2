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

// 引擎运行时状态与 guard 合同(T2:谓词实现与引擎共用的类型基座)。
export * from './state';
export * from './guards';
export * from './predicates';
// 定义语言与定义平面形状(T4:machine-as-JSON 类型迁入,engine re-export 保持公共面)。
export * from './definition';
