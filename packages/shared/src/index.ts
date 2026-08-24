/** 应用名,全栈共享的唯一口径(web 页面标题、worker 日志前缀等)。 */
export const APP_NAME = 'UI4A';

export { RELEASE_VERSION as VERSION } from './release';
export * from './release';

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
// Chat/runtime 与独立 Presentation Plane 之间的 versioned thin protocol。
export * from './presentation';
// Browser-observed view and server navigation facts remain separate from Business truth.
export * from './chat-view';
// External-agent write ingress policy and governed Draft wire contracts.
export * from './submission';
// Provider-neutral Coding Capability Executor wire contracts.
export * from './coding-executor';
// Versioned specialized Agent definition/task/result protocol (T19).
export * from './agent-definition';
// Agent-authored specialization Draft contracts; approval and activation stay out of this result.
export * from './agent-authoring';
// Source-grounded Writing Agent specialization contracts and protocol limits.
export * from './writing-agent';
// Platform-neutral, fail-closed production deployment contract (T22).
export * from './production-deployment-config';
