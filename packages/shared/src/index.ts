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
export * from './definition/state';
export * from './definition/guards';
export * from './definition/predicates';
// 定义语言与定义平面形状(T4:machine-as-JSON 类型迁入,engine re-export 保持公共面)。
export * from './definition/definition';
// Stable, bounded cognition shared by business and Meta contract projections (T39).
export * from './definition/cognitive-semantics';
// Chat/runtime 与独立 Presentation Plane 之间的 versioned thin protocol。
export * from './presentation/presentation';
// Platform-neutral, bounded declarations for Presentation Composition.
export * from './presentation/composition';
// Browser-observed view and server navigation facts remain separate from Business truth.
export * from './presentation/chat-view';
// Bounded, replayable user presence changes and projection shapes (T29).
export * from './presence';
// Principal-owned Work Thread projection and strict core event contracts (T26).
export * from './work-thread';
// External-agent write ingress policy and governed Draft wire contracts.
export * from './submission';
// Provider-neutral Coding Capability Executor wire contracts.
export * from './agent/coding-executor';
// Versioned specialized Agent definition/task/result protocol (T19).
export * from './agent/agent-definition';
// Agent-authored specialization Draft contracts; approval and activation stay out of this result.
export * from './agent/agent-authoring';
// Source-grounded Writing Agent specialization contracts and protocol limits.
export * from './agent/writing-agent';
// Platform-neutral, fail-closed production deployment contract (T22).
export * from './deployment/index';
// Platform-neutral process readiness aggregation contract (T22).
export * from './deployment/readiness';
