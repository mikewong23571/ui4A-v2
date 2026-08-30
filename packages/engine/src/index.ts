/**
 * @ui4a/engine 公共导出。
 *
 * 引擎核心:machine-as-JSON 类型与解析、XState v5 转移校验、三层裁决、
 * 效果词汇表、fold 投影(日志→快照)、Siren 投影、sitemap 推导;
 * 定义平面(T4):definition-lifecycle 常量、meta exec 编排、定义事件。
 * 纯 TS(浏览器/服务端两栖,零 Node API)。
 */
export * from './core/types';
export * from './core/parse';
export * from './core/machine';
export * from './contract/schema';
export * from './execution/judge';
export * from './execution/effects';
export * from './execution/confirmation';
export * from './execution/execute';
export * from './execution/plan';
export * from './projection/fold/index';
export * from './delegation/delegation';
export * from './projection/render-spec';
export * from './projection/capability-artifact';
export * from './projection/work-thread';
export * from './projection/work-thread-command';
export * from './execution/execution-audit';
export * from './definition/lifecycle';
export * from './definition/meta';
export * from './definition/meta-bootstrap';
export * from './definition/definition-diff';
export * from './definition/definition-bundle';
export * from './definition/invariants';
export * from './contract/siren/index';
export * from './contract/sitemap';
export * from './contract/cognitive-semantics';
export * from './submission/index';
// Independently replayable pure Capability Run plane.
export * from './capability-run/index';
// Canonical specialization-independent Agent Run plane and T18 read codec.
export * from './agent-run/index';
// Runtime feature negotiation and effective grant intersection for Agent specializations.
export * from './agent-runtime-policy/index';
// 独立 Presentation Plane 的纯编排/校验基座；不进入 Business fold。
export * from './presentation/index';
// Specialized Agent definition parser, derivation, and activation kernels (T19).
export * from './agent-definition/index';
