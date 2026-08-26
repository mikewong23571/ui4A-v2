/**
 * @ui4a/agent 公共导出。
 *
 * 循环协议(runAgent)与 AI-first LLM driver/工具投影。
 * 纯 TS 两栖;HTTP 客户端经 fetchImpl 注入;LLM 传输同样可注入(单测零网络)。
 * rule driver 仅从显式 testkit 子路径提供,不属于产品公共面。
 */
export * from './types';
export * from './loop/authorization';
export * from './contract/authenticated-fetch';
export * from './contract/disclosure';
export * from './llm/llm-config';
export * from './contract/http';
export * from './loop/loop';
export * from './protocol/match';
export * from './protocol/navigation';
export * from './protocol/plan';
export * from './presentation/render';
export * from './protocol/tools';
export * from './llm/llm-driver';
export * from './llm/llm-probe';
export * from './presentation/presentation-agent';
export * from './presentation/presentation-revision';
export * from './contract/production-agent-token-provider';
export * from './specialization/index';
