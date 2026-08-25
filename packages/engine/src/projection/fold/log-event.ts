/**
 * 日志事件类型:引擎 EngineEvent + 日志层字段(seq/ts/reason/detail)。
 * 日志形状(LogEvent)是引擎公共合同的一部分(worker 与重放工具共用)。
 */
import type { ApplicationDefinition, CapabilityDefinition, InstanceSnapshot } from '@ui4a/shared';

import type { EngineEvent } from '../../execution/effects';

/** 日志事件种类:引擎产出(含 T4 定义事件族)+ 日志层三种
 *  (拒绝留痕 I6 / 种子装载 / definition-seeded 定义种子)+
 *  notification-delivered(T3 notify capability 送达事件,worker 第二写者写入;
 *  fold 分支见 Task 2 读路径)+
 *  delegation-*(T5 委托事件族:worker delegationWorkflow 的首/步/终事件;
 *  类型先行与 web EventKind 对齐,fold 分支与 delegations 投影见 T5 Phase A Task 2)+
 *  render-spec-frozen(T7 凝固:渲染 spec 按关注点首冻入日志,
 *  fold 分支见 render-spec 模块)+
 *  chat-turn(T9 Phase B:聊天 inline 回合投影,web 聊天路由直写——
 *  纯审计留痕,fold 不改状态)+
 *  agent-decision(T11 Phase B:inline 路径每步决策一条审计,与 chat-turn 同源;
 *  纯留痕,fold 不改状态)+
 *  application-seeded(T10 Phase B:application 定义种子,boot 装载;
 *  fold 落 applications 表——seeded 即 active,键集 = app-known 已激活集合)+
 *  capability-seeded(T13 Phase C:capability 定义种子,boot 装载;
 *  fold 落 capabilities 表——seeded 即 registered,键集 =
 *  capability-registered 已注册集合)。 */
export type LogEventKind =
  | EngineEvent['kind']
  | 'action-rejected'
  | 'notification-delivered'
  | 'seed'
  | 'definition-seeded'
  | 'definition-candidate-applied'
  | 'application-seeded'
  | 'capability-seeded'
  | 'meta-bootstrap-applied'
  | 'delegation-started'
  | 'delegation-step'
  | 'delegation-completed'
  | 'delegation-failed'
  | 'delegation-max-steps'
  | 'render-spec-frozen'
  | 'capability-artifact-created'
  | 'chat-turn-started'
  | 'chat-turn-progress'
  | 'chat-turn'
  | 'chat-message-appended'
  | 'chat-context-updated'
  | 'chat-navigation-completed'
  | 'agent-decision';

/**
 * 存储事件(引擎 EngineEvent + 日志层字段)。
 * seq/ts 由日志层分配(时钟是 capability,引擎事件不含二者);
 * reason/detail 由拒绝路径与 seed 装载写入。
 */
export interface LogEvent extends Omit<EngineEvent, 'kind' | 'rel' | 'action' | 'actor'> {
  seq: number;
  /** ISO 时间戳(仅审计;fold 不读它,重放确定性不依赖时钟)。 */
  ts?: string;
  kind: LogEventKind;
  rel?: string;
  action?: string;
  /** 行为者;seed 等事件可缺省(存储层列为 null)。 */
  actor?: 'human' | 'agent';
  reason?: string;
  detail?: unknown;
}

/** seed 事件的 detail 载荷:种子实体与集合(Phase C 启动 seed 写入)。 */
export interface SeedDetail {
  instances: Record<string, InstanceSnapshot>;
  collections?: Record<string, string[]>;
}

/**
 * application-seeded 事件的 detail 载荷(T10 Phase B;机器可重放:定义全文入日志)。
 * 与 DefinitionSeededDetail 同哲学(seeded 即 active),但 application 无版本/
 * 生命周期(本 track 不扩展 meta 动词)——applications 表的存在即激活,
 * 键集就是 app-known 不变式的已激活集合。
 */
export interface ApplicationSeededDetail {
  name: string;
  definition: ApplicationDefinition;
}

/**
 * capability-seeded 事件的 detail 载荷(T13 Phase C;机器可重放:定义全文入日志)。
 * 与 ApplicationSeededDetail 同哲学(seeded 即 registered),capability 无版本/
 * 生命周期(本 track 不扩展 meta 动词)——capabilities 表的存在即注册,
 * 键集就是 capability-registered 不变式(Phase D)的已注册集合。
 */
export interface CapabilitySeededDetail {
  name: string;
  definition: CapabilityDefinition;
}
