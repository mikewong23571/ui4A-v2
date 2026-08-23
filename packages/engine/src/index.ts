/**
 * @ui4a/engine 公共导出。
 *
 * 引擎核心:machine-as-JSON 类型与解析、XState v5 转移校验、三层裁决、
 * 效果词汇表、fold 投影(日志→快照)、Siren 投影、sitemap 推导;
 * 定义平面(T4):definition-lifecycle 常量、meta exec 编排、定义事件。
 * 纯 TS(浏览器/服务端两栖,零 Node API)。
 */
export * from './types';
export * from './parse';
export * from './machine';
export * from './schema';
export * from './judge';
export * from './effects';
export * from './confirmation';
export * from './execute';
export * from './plan';
export * from './fold';
export * from './delegation';
export * from './render-spec';
export * from './capability-artifact';
export * from './execution-audit';
export * from './lifecycle';
export * from './meta';
export * from './meta-bootstrap';
export * from './definition-diff';
export * from './definition-bundle';
export * from './invariants';
export * from './siren';
export * from './sitemap';
export * from './submission/index';
// Independently replayable pure Capability Run plane.
export * from './capability-run/index';
// 独立 Presentation Plane 的纯编排/校验基座；不进入 Business fold。
export * from './presentation/index';
