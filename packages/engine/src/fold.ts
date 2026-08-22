/**
 * fold 投影:事件日志 → 引擎快照的纯函数(arch-brief §4 事件溯源)。
 *
 * "当前 UI 状态 = 日志折叠后的物化状态";应用核心是日志的纯函数(I5 的根基)。
 * 与在线路径同构:在线 exec = judge(裁决) → applyEffects(效果) → appendEvent(s) →
 * 增量持有新快照;重放 = fold(全部事件) —— 每条 action-executed 事件还原成
 * ExecRequest 后重放同一个 applyEffects(同一 flow 常量、同一效果词汇表),
 * 两条路径产出相同快照(由 I5 集成测试以内容 hash 断言)。
 *
 * 放在 engine(而非 web service 层)的理由:fold 是"应用核心"本体且纯(零 Node API,
 * 两栖),worker(T3 消费 spawn-requested)与任何重放工具都需要它;
 * 日志形状(LogEvent)因此成为引擎公共合同的一部分。
 */
import { fieldValues, metaActivationRel, metaFlowRel } from '@ui4a/shared';
import type {
  ApplicationDefinition,
  CapabilityDefinition,
  ConfirmationSnapshot,
  DefinitionEntry,
  DefinitionStatus,
  EngineSnapshot,
  FlowDefinition,
  InstanceSnapshot,
} from '@ui4a/shared';

import {
  confirmationRel,
  type ConfirmationDecisionDetail,
  type ConfirmationRequestDetail,
} from './confirmation';
import { applyDelegationStarted, applyDelegationStep, applyDelegationTerminal } from './delegation';
import { applyEffects } from './effects';
import type { EngineEvent } from './effects';
import type { ExecRequest } from './judge';
import { withLifecycleFlows } from './lifecycle';
import type {
  DefinitionActivatedDetail,
  DefinitionDeprecatedDetail,
  DefinitionRejectedDetail,
  DefinitionRevisedDetail,
  DefinitionSeededDetail,
  DefinitionSubmittedDetail,
} from './meta';
import { actionEffects } from './parse';
import { applyRenderSpecFrozen } from './render-spec';
import { applyCapabilityArtifactCreated } from './capability-artifact';

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

/** 由事件参数(带出处)还原 exec 请求的求值输入。 */
function toExecRequest(event: LogEvent): ExecRequest {
  const params = event.params ?? {};
  return {
    rel: event.rel ?? '',
    action: event.action ?? '',
    params: fieldValues(params),
    paramOrigins: Object.fromEntries(
      Object.entries(params).map(([name, entry]) => [name, entry.origin]),
    ),
    actor: event.actor,
    principal: event.principal,
    channel: event.channel,
  };
}

/** seed 合并:只补缺、不覆盖(幂等种子装载;重复 seed 事件无害)。
 *  T4 Phase B:新装实例按当时活跃定义盖出生版本戳(空库序:定义先于业务 seed,
 *  天然可解析;定义未入日志的 flow 不盖戳,保持既有形状)。 */
function applySeed(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<SeedDetail> | undefined;
  if (detail === undefined || typeof detail !== 'object' || detail.instances === undefined) {
    throw new Error(`seed 事件(seq=${event.seq})缺少 detail.instances`);
  }
  const instances: EngineSnapshot['instances'] = { ...snapshot.instances };
  for (const [rel, seeded] of Object.entries(detail.instances)) {
    if (instances[rel] !== undefined) continue;
    const bornVersion = seeded.bornVersion ?? snapshot.definitions?.[seeded.flow]?.version;
    instances[rel] = bornVersion !== undefined ? { ...seeded, bornVersion } : { ...seeded };
  }
  const collections: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(snapshot.collections)) {
    collections[name] = [...members];
  }
  for (const [name, members] of Object.entries(detail.collections ?? {})) {
    const existing = collections[name] ?? [];
    collections[name] = [...existing, ...members.filter((rel) => !existing.includes(rel))];
  }
  return {
    instances,
    collections,
    // confirmations/definitions/activations 表随行(seed 只补实体与集合,
    // 不动确认门与定义平面状态;恒物化与在线路径同构)。
    confirmations: { ...snapshot.confirmations },
    // T5:delegations 表随行(seed 不产委托;与 confirmations 同口径)。
    delegations: { ...(snapshot.delegations ?? {}) },
    definitions: { ...snapshot.definitions },
    activations: { ...(snapshot.activations ?? {}) },
    definitionVersions: { ...(snapshot.definitionVersions ?? {}) },
    // T7:renderSpecs 表随行(seed 不产凝固;与 confirmations 同口径)。
    renderSpecs: { ...(snapshot.renderSpecs ?? {}) },
    artifacts: { ...(snapshot.artifacts ?? {}) },
    // T10:applications 表随行,但仅在场时携带——缺省不物化为 {}
    // (app-known 以"表不存在"为过渡期 vacuous pass 信号;与 effects.ts 同口径)。
    ...(snapshot.applications !== undefined ? { applications: { ...snapshot.applications } } : {}),
    // T13:capabilities 表随行,与 applications 同口径(仅在场时携带,
    // 缺省不物化为 {}——capability-registered 的过渡期 vacuous pass 信号)。
    ...(snapshot.capabilities !== undefined ? { capabilities: { ...snapshot.capabilities } } : {}),
  };
}

/**
 * 重放一条 action-executed:定义解析以**快照为准**(T4 Phase B:定义来自日志)——
 * 实例带出生版本戳按 definitionVersions[bornVersion] 取,否则取该 flow 当前活跃
 * 版本;快照无该 flow 定义(测试 fixture/常量域)才回退 deps.flows 常量。
 * 日志与定义漂移时响亮失败(带 seq)——日志 + 定义 = 完整重放输入,任何缺口都
 * 必须被 I5 级测试看见。
 */
function instanceFlowFromSnapshot(
  snapshot: EngineSnapshot,
  instance: EngineSnapshot['instances'][string],
): FlowDefinition | undefined {
  const entry = snapshot.definitions?.[instance.flow];
  if (entry === undefined) return undefined;
  const version = instance.bornVersion ?? entry.version;
  return snapshot.definitionVersions?.[instance.flow]?.[version] ?? entry.definition;
}

function applyExecuted(
  snapshot: EngineSnapshot,
  event: LogEvent,
  flows: Readonly<Record<string, FlowDefinition>>,
): EngineSnapshot {
  const request = toExecRequest(event);
  const where = `seq=${event.seq}(${request.rel}#${request.action})`;

  const instance = snapshot.instances[request.rel];
  if (instance === undefined) {
    throw new Error(`重放失败:${where} 实例不存在(日志与状态漂移)`);
  }
  const flow = instanceFlowFromSnapshot(snapshot, instance) ?? flows[instance.flow];
  if (flow === undefined) {
    throw new Error(`重放失败:${where} 流程 "${instance.flow}" 未注册(定义漂移)`);
  }
  const node = flow.nodes.find((candidate) => candidate.name === instance.node);
  if (node === undefined) {
    throw new Error(`重放失败:${where} 节点 "${instance.node}" 不在流程 "${flow.name}" 节点集`);
  }
  const action = node.actions.find((candidate) => candidate.name === request.action);
  if (action === undefined) {
    throw new Error(`重放失败:${where} 动作未声明于节点 "${node.name}"(定义与日志漂移)`);
  }

  try {
    // versions 随快照传入:transition 校验同样按出生版本解析(与在线一致)。
    return applyEffects(request, actionEffects(action), snapshot, {
      flows,
      versions: snapshot.definitionVersions,
    }).snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`重放失败:${where} ${message}`);
  }
}

// ---------------------------------------------------------------------------
// application-seeded 重放(T10 Phase B;spec 架构决定 4)
// ---------------------------------------------------------------------------

/**
 * application-seeded 重放:活跃 app 定义落 applications 表(幂等:已存在跳过)。
 * seeded 即 active——applications 表的键集即 app-known 不变式的已激活集合;
 * 本 track 无 app 生命周期动词,表只经本事件增长(不物化 lifecycle 实例,
 * 与 definition-seeded 的 definitions 表/lifecycle 实例双轨不同)。
 */
function applyApplicationSeeded(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<ApplicationSeededDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.name !== 'string' ||
    detail.definition === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} application-seeded 缺少 detail 载荷(日志完整性)`);
  }
  if (snapshot.applications?.[detail.name] !== undefined) {
    return snapshot; // 幂等:重复 seed 不覆盖(boot 重放安全)。
  }
  return {
    ...snapshot,
    applications: { ...(snapshot.applications ?? {}), [detail.name]: detail.definition },
  };
}

// ---------------------------------------------------------------------------
// capability-seeded 重放(T13 Phase C;spec 架构决定 3)
// ---------------------------------------------------------------------------

/**
 * capability-seeded 重放:已注册 capability 定义落 capabilities 表
 * (幂等:已存在跳过)。seeded 即 registered——capabilities 表的键集即
 * capability-registered 不变式(Phase D)的已注册集合;本 track 无
 * capability 生命周期动词,表只经本事件增长(与 application-seeded
 * 同哲学:不物化 lifecycle 实例)。
 */
function applyCapabilitySeeded(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<CapabilitySeededDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.name !== 'string' ||
    detail.definition === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} capability-seeded 缺少 detail 载荷(日志完整性)`);
  }
  if (snapshot.capabilities?.[detail.name] !== undefined) {
    return snapshot; // 幂等:重复 seed 不覆盖(boot 重放安全)。
  }
  return {
    ...snapshot,
    capabilities: { ...(snapshot.capabilities ?? {}), [detail.name]: detail.definition },
  };
}

// ---------------------------------------------------------------------------
// confirmation 事件链重放(T3:挂起→approve/reject;与在线路径同构)
// ---------------------------------------------------------------------------

/** confirmation-requested 重放:pending 实体物化(不重新裁决策略,载荷即真相)。 */
function applyConfirmationRequested(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<ConfirmationRequestDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.id !== 'string' ||
    typeof detail.targetRel !== 'string' ||
    typeof detail.targetAction !== 'string'
  ) {
    throw new Error(
      `重放失败:seq=${event.seq} confirmation-requested 缺少 detail 载荷(日志完整性)`,
    );
  }
  const rel = confirmationRel(detail.id);
  if (snapshot.confirmations?.[rel] !== undefined) {
    throw new Error(`重放失败:seq=${event.seq} 确认 "${rel}" 重复物化(日志完整性)`);
  }
  // 与 suspendForConfirmation 的物化形状逐字段同构(I5 hash 一致的前提):
  // 空参数表/缺信道时不落键,保持与在线构造完全一致。
  const params = event.params;
  const confirmation: ConfirmationSnapshot = {
    id: detail.id,
    targetRel: detail.targetRel,
    targetAction: detail.targetAction,
    ...(params !== undefined && Object.keys(params).length > 0 ? { params } : {}),
    proposedBy: {
      actor: event.actor ?? 'human',
      ...(event.principal !== undefined ? { principal: event.principal } : {}),
    },
    ...(event.channel !== undefined ? { channel: event.channel } : {}),
    status: 'pending',
    ...(typeof detail.policy === 'string' ? { policy: detail.policy } : {}),
    ...(typeof detail.policyReason === 'string' ? { policyReason: detail.policyReason } : {}),
    ...(detail.riskLevel === 'low' || detail.riskLevel === 'medium' || detail.riskLevel === 'high'
      ? { riskLevel: detail.riskLevel }
      : {}),
  };
  return {
    ...snapshot,
    confirmations: { ...(snapshot.confirmations ?? {}), [rel]: confirmation },
  };
}

/** confirmation-approved / rejected 重放:状态流转(实体保留供审计)。 */
function applyConfirmationDecision(
  snapshot: EngineSnapshot,
  event: LogEvent,
  status: 'approved' | 'rejected',
): EngineSnapshot {
  const detail = event.detail as Partial<ConfirmationDecisionDetail> | undefined;
  if (detail === undefined || typeof detail !== 'object' || typeof detail.id !== 'string') {
    throw new Error(
      `重放失败:seq=${event.seq} confirmation-${status} 缺少 detail 载荷(日志完整性)`,
    );
  }
  const rel = confirmationRel(detail.id);
  const existing = snapshot.confirmations?.[rel];
  if (existing === undefined) {
    throw new Error(`重放失败:seq=${event.seq} 确认 "${rel}" 不存在(日志与状态漂移)`);
  }
  if (existing.status !== 'pending') {
    throw new Error(`重放失败:seq=${event.seq} 确认 "${rel}" 已是 ${existing.status}(重复裁决)`);
  }
  // decidedBy 从 detail 还原(含 principal;与在线 decidedByOf 构造逐字段同构)。
  const decidedBy = detail.decidedBy;
  if (
    decidedBy === undefined ||
    typeof decidedBy !== 'object' ||
    (decidedBy.actor !== 'human' && decidedBy.actor !== 'agent')
  ) {
    throw new Error(`重放失败:seq=${event.seq} confirmation-${status} 缺少 decidedBy(日志完整性)`);
  }
  const updated: ConfirmationSnapshot =
    status === 'approved'
      ? { ...existing, status, approvedBy: decidedBy }
      : { ...existing, status, rejectedReason: event.reason };
  return {
    ...snapshot,
    confirmations: { ...(snapshot.confirmations ?? {}), [rel]: updated },
  };
}

/** notification-delivered 重放:对应确认标记 notified=true(worker 送达事件)。
 *  重复送达(capability 重试)幂等:已 notified 则原快照返回,不抛错;
 *  指向未知确认响亮失败(日志完整性)。 */
function applyNotificationDelivered(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const rel = event.rel;
  if (rel === undefined || rel === '') {
    throw new Error(`重放失败:seq=${event.seq} notification-delivered 缺少 rel(日志完整性)`);
  }
  const existing = snapshot.confirmations?.[rel];
  if (existing === undefined) {
    throw new Error(
      `重放失败:seq=${event.seq} notification-delivered 指向未知确认 "${rel}"(日志完整性)`,
    );
  }
  if (existing.notified === true) {
    return snapshot;
  }
  return {
    ...snapshot,
    confirmations: { ...(snapshot.confirmations ?? {}), [rel]: { ...existing, notified: true } },
  };
}

// ---------------------------------------------------------------------------
// 定义事件族重放(T4:与在线 executeMeta 路径同构)
// ---------------------------------------------------------------------------

/** definition-seeded 重放:建立 definitions 条目 + lifecycle 实例(幂等:已存在跳过)。
 *  同时沉淀版本历史(v1 全文),并对先于定义入日志的既有实例回溯盖出生版本戳
 *  (旧库迁移口径:迁移时在途实例视为出生于迁移落定的活跃版本)。 */
function applyDefinitionSeeded(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionSeededDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.name !== 'string' ||
    typeof detail.version !== 'number' ||
    typeof detail.status !== 'string' ||
    detail.definition === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-seeded 缺少 detail 载荷(日志完整性)`);
  }
  const definitions = { ...(snapshot.definitions ?? {}) };
  if (definitions[detail.name] !== undefined) {
    return snapshot; // 幂等:重复 seed 不覆盖(boot 重放安全)。
  }
  const status = detail.status as DefinitionStatus;
  const entry: DefinitionEntry = {
    name: detail.name,
    version: detail.version,
    status,
    definition: detail.definition,
  };
  definitions[detail.name] = entry;
  const instances = { ...snapshot.instances };
  const rel = metaFlowRel(detail.name);
  if (instances[rel] === undefined) {
    instances[rel] = { rel, flow: 'definition-lifecycle', node: status, fields: {} };
  }
  // 迁移序回溯盖戳:该 flow 既有实例(定义入日志前出生)补 bornVersion。
  for (const [instanceRel, instance] of Object.entries(instances)) {
    if (instance.flow === detail.name && instance.bornVersion === undefined) {
      instances[instanceRel] = { ...instance, bornVersion: detail.version };
    }
  }
  return {
    ...snapshot,
    instances,
    definitions,
    definitionVersions: {
      ...(snapshot.definitionVersions ?? {}),
      [detail.name]: {
        ...(snapshot.definitionVersions?.[detail.name] ?? {}),
        [detail.version]: detail.definition,
      },
    },
  };
}

/** definitions 条目定位(定义事件重放的公共前置;缺条目 = 日志漂移)。 */
function definitionEntry(snapshot: EngineSnapshot, event: LogEvent, name: string): DefinitionEntry {
  const entry = snapshot.definitions?.[name];
  if (entry === undefined) {
    throw new Error(`重放失败:seq=${event.seq} 定义 "${name}" 不在 definitions 表(日志与状态漂移)`);
  }
  return entry;
}

/** lifecycle 实例节点核对(转移已由前置 action-executed 重放;此处只核对)。 */
function lifecycleNodeOf(
  snapshot: EngineSnapshot,
  event: LogEvent,
  name: string,
): InstanceSnapshot {
  const instance = snapshot.instances[metaFlowRel(name)];
  if (instance === undefined) {
    throw new Error(`重放失败:seq=${event.seq} lifecycle 实例 "${metaFlowRel(name)}" 不存在(漂移)`);
  }
  return instance;
}

/** definition-revised 重放:条目 → draft,bornBy=当前版本(工作副本即当前定义)。 */
function applyDefinitionRevised(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionRevisedDetail> | undefined;
  if (detail === undefined || typeof detail.name !== 'string') {
    throw new Error(`重放失败:seq=${event.seq} definition-revised 缺少 detail.name(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'draft') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-revised 时实例不在 draft(在 ${instance.node};日志完整性)`,
    );
  }
  return {
    ...snapshot,
    definitions: {
      ...snapshot.definitions,
      [detail.name]: { ...entry, status: 'draft', bornBy: entry.version },
    },
  };
}

/** definition-deprecated 重放:条目 → deprecated。 */
function applyDefinitionDeprecated(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionDeprecatedDetail> | undefined;
  if (detail === undefined || typeof detail.name !== 'string') {
    throw new Error(`重放失败:seq=${event.seq} definition-deprecated 缺少 detail.name(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'deprecated') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-deprecated 时实例不在 deprecated(在 ${instance.node};日志完整性)`,
    );
  }
  return {
    ...snapshot,
    definitions: { ...snapshot.definitions, [detail.name]: { ...entry, status: 'deprecated' } },
  };
}

/**
 * definition-submitted 重放(载荷即真相:不重新求值不变式——在线路径的
 * 求值输入已随 definition-seeded/edited 链重放,注册表随时间可变,重放
 * 确定性以日志为准,与 confirmation-requested 同口径)。
 * passed → pending-approval + activation 物化;fail → 回 draft。
 * 前置 action-executed(submit)已把实例迁到 validating,此处核对。
 */
function applyDefinitionSubmitted(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionSubmittedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail.name !== 'string' ||
    typeof detail.passed !== 'boolean' ||
    !Array.isArray(detail.checks)
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-submitted 缺少 detail 载荷(日志完整性)`);
  }
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'validating') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-submitted 时实例不在 validating(在 ${instance.node};日志完整性)`,
    );
  }
  const entry = definitionEntry(snapshot, event, detail.name);

  if (detail.passed) {
    const payload = detail.activation;
    if (
      payload === undefined ||
      typeof payload.id !== 'string' ||
      typeof payload.version !== 'number' ||
      typeof payload.artifact !== 'string' ||
      payload.definition === undefined ||
      payload.requestedBy === undefined
    ) {
      throw new Error(
        `重放失败:seq=${event.seq} definition-submitted(passed)缺少 activation 载荷(日志完整性)`,
      );
    }
    const rel = metaActivationRel(payload.id);
    if (snapshot.activations?.[rel] !== undefined) {
      throw new Error(`重放失败:seq=${event.seq} 激活 "${rel}" 重复物化(日志完整性)`);
    }
    // 机械 diff 从载荷还原(载荷即真相,不重算);older 日志(diff 字段引入前)
    // 可缺省——投影按缺 diff 处理,不破坏旧日志重放。
    if (
      payload.diff !== undefined &&
      (typeof payload.diff !== 'object' ||
        payload.diff === null ||
        (payload.diff as { algorithm?: unknown }).algorithm !== 'deep-object-diff')
    ) {
      throw new Error(`重放失败:seq=${event.seq} activation.diff 载荷形状非法(日志完整性)`);
    }
    const activation = {
      id: payload.id,
      flow: detail.name,
      status: 'pending-approval' as const,
      version: payload.version,
      artifact: payload.artifact,
      checks: detail.checks,
      definition: payload.definition,
      requestedBy: payload.requestedBy,
      ...(payload.diff !== undefined ? { diff: payload.diff } : {}),
    };
    return {
      ...snapshot,
      instances: {
        ...snapshot.instances,
        [metaFlowRel(detail.name)]: { ...instance, node: 'pending-approval' },
      },
      definitions: {
        ...snapshot.definitions,
        [detail.name]: { ...entry, status: 'pending-approval' },
      },
      activations: { ...(snapshot.activations ?? {}), [rel]: activation },
    };
  }

  return {
    ...snapshot,
    instances: {
      ...snapshot.instances,
      [metaFlowRel(detail.name)]: { ...instance, node: 'draft' },
    },
    definitions: { ...snapshot.definitions, [detail.name]: { ...entry, status: 'draft' } },
  };
}

/**
 * definition-activated 重放:approve 落态——条目 {status: active,
 * version(激活落实的新版本), definition(草稿全文)};activation → approved
 * (decidedBy 留痕)。前置 action-executed(approve)已迁实例到 active,此处核对。
 */
function applyDefinitionActivated(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionActivatedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail.name !== 'string' ||
    typeof detail.version !== 'number' ||
    typeof detail.activationId !== 'string' ||
    detail.definition === undefined ||
    detail.decidedBy === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-activated 缺少 detail 载荷(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'active') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-activated 时实例不在 active(在 ${instance.node};日志完整性)`,
    );
  }
  const activationRel = metaActivationRel(detail.activationId);
  const activation = snapshot.activations?.[activationRel];
  if (activation === undefined) {
    throw new Error(`重放失败:seq=${event.seq} 激活 "${activationRel}" 不存在(日志与状态漂移)`);
  }
  if (activation.status !== 'pending-approval') {
    throw new Error(
      `重放失败:seq=${event.seq} 激活 "${activationRel}" 已是 ${activation.status}(重复裁决)`,
    );
  }
  return {
    ...snapshot,
    definitions: {
      ...snapshot.definitions,
      [detail.name]: {
        ...entry,
        status: 'active',
        version: detail.version,
        definition: detail.definition,
      },
    },
    // 版本历史沉淀(与在线 decide() 同构):旧版本保留,仅活跃指针移动。
    definitionVersions: {
      ...(snapshot.definitionVersions ?? {}),
      [detail.name]: {
        ...(snapshot.definitionVersions?.[detail.name] ?? {}),
        [detail.version]: detail.definition,
      },
    },
    activations: {
      ...(snapshot.activations ?? {}),
      [activationRel]: { ...activation, status: 'approved' as const, approvedBy: detail.decidedBy },
    },
  };
}

/** definition-rejected 重放:条目 → rejected;activation → rejected(reason 留痕)。 */
function applyDefinitionRejected(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionRejectedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail.name !== 'string' ||
    typeof detail.activationId !== 'string' ||
    detail.decidedBy === undefined ||
    typeof detail.reason !== 'string'
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-rejected 缺少 detail 载荷(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'rejected') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-rejected 时实例不在 rejected(在 ${instance.node};日志完整性)`,
    );
  }
  const activationRel = metaActivationRel(detail.activationId);
  const activation = snapshot.activations?.[activationRel];
  if (activation === undefined || activation.status !== 'pending-approval') {
    throw new Error(`重放失败:seq=${event.seq} 激活 "${activationRel}" 不存在或已决策(日志完整性)`);
  }
  return {
    ...snapshot,
    definitions: { ...snapshot.definitions, [detail.name]: { ...entry, status: 'rejected' } },
    activations: {
      ...(snapshot.activations ?? {}),
      [activationRel]: {
        ...activation,
        status: 'rejected' as const,
        rejectedReason: detail.reason,
      },
    },
  };
}

/**
 * 折叠事件日志为引擎快照(纯函数;events 须按 seq 升序传入)。
 *
 * - action-executed:重放 applyEffects(在线路径同一函数);
 * - action-rejected:不改状态(拒绝即数据,留痕在日志本身,I6);
 * - entity-appended / spawn-requested:伴随事件——状态已由同批 action-executed
 *   重放体现(append 由 applyEffects 落位;spawn 在 T2 不改状态),fold 不双算;
 * - confirmation-requested:pending 确认实体物化(目标动作不生效);
 * - confirmation-approved:状态 → approved(实体保留);紧随其后的 action-executed
 *   照常重放(挂起→approve 重放后效果必须出现,I5);
 * - confirmation-rejected:状态 → rejected(原因保留),原动作永不生效;
 * - notification-delivered:确认标记 notified=true(worker 第二写者的送达事件,
 *   重复幂等;spec 决定 4 双写者方案);
 * - delegation-started / -step / -completed | -failed | -max-steps(T5):委托
 *   事件族折叠为 delegations 表(worker delegationWorkflow 的轨迹;step 步号
 *   连续性在 fold 层强制,缺口即抛错);
 * - render-spec-frozen(T7):凝固渲染 spec 物化为 renderSpecs 表
 *   (concern → spec;同 spec 重复幂等,异 spec 抛错——凝固语义);
 * - seed:合并种子实体(幂等);
 * - definition-seeded(T4):建立 definitions 条目 + lifecycle 实例(幂等);
 * - application-seeded(T10):活跃 app 定义落 applications 表(幂等;
 *   seeded 即 active,键集 = app-known 已激活集合);
 * - capability-seeded(T13):已注册 capability 定义落 capabilities 表(幂等;
 *   seeded 即 registered,键集 = capability-registered 已注册集合);
 * - definition-edited:伴随事件——工作副本已由同批 action-executed 重放
 *   (applyEffects 的 meta-edit),fold 不双算;
 * - definition-revised / -deprecated:条目状态落态(转移由前置 action-executed
 *   重放,此处核对 + 条目同步);
 * - definition-submitted:载荷即真相——passed 则 pending-approval + activation
 *   物化;fail 则回 draft(校验报告即 checks 失败项);
 * - definition-activated / -rejected:approve/reject 落态(版本推进/驳回留痕;
 *   转移由前置 action-executed 重放,此处核对 + 条目与 activation 同步);
 * - chat-turn(T9 Phase B):聊天回合投影——纯审计留痕,fold 不改状态;
 * - agent-decision(T11 Phase B):inline 每步决策审计——纯留痕,fold 不改状态;
 * - 未知 kind:抛错(日志完整性守卫)。
 *
 * initial(可选):从既有快照继续折叠——web 读路径按 seq 增量 fold 的根基
 * (增量结果与全量 fold 同构,由测试以内容 hash 断言;缺省从空快照起步)。
 */
export function fold(
  events: readonly LogEvent[],
  deps: { flows: Readonly<Record<string, FlowDefinition>> },
  initial?: EngineSnapshot,
): EngineSnapshot {
  // T4:lifecycle 常量自动注入(保留名)——meta 动作的 action-executed 重放
  // 需要 definition-lifecycle,调用方无须自带。
  const flows = withLifecycleFlows(deps.flows);
  let snapshot: EngineSnapshot =
    initial === undefined
      ? {
          instances: {},
          collections: {},
          confirmations: {},
          delegations: {},
          definitions: {},
          activations: {},
          definitionVersions: {},
          renderSpecs: {},
          artifacts: {},
        }
      : {
          instances: initial.instances,
          collections: initial.collections,
          confirmations: initial.confirmations ?? {},
          // T5:delegations 表随行(与 confirmations 同口径:在线恒物化,
          // 重放同构前提是两边形状一致)。
          delegations: initial.delegations ?? {},
          // T4:definitions/activations 表随行(在线 applyEffects 恒物化,
          // 重放同构前提是两边形状一致);definitionVersions(T4 Phase B)同口径。
          definitions: initial.definitions ?? {},
          activations: initial.activations ?? {},
          definitionVersions: initial.definitionVersions ?? {},
          // T7:renderSpecs 表随行(凝固表恒物化,同口径)。
          renderSpecs: initial.renderSpecs ?? {},
          // T10:applications 表随行,但仅在场时携带——缺省不物化为 {}
          // (app-known 过渡期 vacuous pass 信号;与 applyEffects 同口径)。
          ...(initial.applications !== undefined ? { applications: initial.applications } : {}),
          // T13:capabilities 表随行,与 applications 同口径(仅在场时携带;
          // capability-registered 过渡期 vacuous pass 信号)。
          ...(initial.capabilities !== undefined ? { capabilities: initial.capabilities } : {}),
          artifacts: initial.artifacts ?? {},
        };
  for (const event of events) {
    switch (event.kind) {
      case 'seed':
        snapshot = applySeed(snapshot, event);
        break;
      case 'definition-seeded':
        snapshot = applyDefinitionSeeded(snapshot, event);
        break;
      case 'application-seeded':
        snapshot = applyApplicationSeeded(snapshot, event);
        break;
      case 'capability-seeded':
        snapshot = applyCapabilitySeeded(snapshot, event);
        break;
      case 'definition-edited':
        break;
      case 'definition-revised':
        snapshot = applyDefinitionRevised(snapshot, event);
        break;
      case 'definition-deprecated':
        snapshot = applyDefinitionDeprecated(snapshot, event);
        break;
      case 'definition-submitted':
        snapshot = applyDefinitionSubmitted(snapshot, event);
        break;
      case 'definition-activated':
        snapshot = applyDefinitionActivated(snapshot, event);
        break;
      case 'definition-rejected':
        snapshot = applyDefinitionRejected(snapshot, event);
        break;
      case 'action-executed':
        snapshot = applyExecuted(snapshot, event, flows);
        break;
      case 'confirmation-requested':
        snapshot = applyConfirmationRequested(snapshot, event);
        break;
      case 'confirmation-approved':
        snapshot = applyConfirmationDecision(snapshot, event, 'approved');
        break;
      case 'confirmation-rejected':
        snapshot = applyConfirmationDecision(snapshot, event, 'rejected');
        break;
      case 'notification-delivered':
        snapshot = applyNotificationDelivered(snapshot, event);
        break;
      case 'delegation-started':
        snapshot = applyDelegationStarted(snapshot, event);
        break;
      case 'delegation-step':
        snapshot = applyDelegationStep(snapshot, event);
        break;
      case 'delegation-completed':
      case 'delegation-failed':
      case 'delegation-max-steps':
        snapshot = applyDelegationTerminal(snapshot, event, event.kind);
        break;
      case 'render-spec-frozen':
        snapshot = applyRenderSpecFrozen(snapshot, event);
        break;
      case 'capability-artifact-created':
        snapshot = applyCapabilityArtifactCreated(snapshot, event);
        break;
      case 'action-rejected':
      case 'entity-appended':
      case 'spawn-requested':
      // plan-executed(T6):批量裁决记录——纯标记,状态由同批各步伴随事件
      // (action-executed / confirmation-requested 族)重放,fold 不双算。
      case 'plan-executed':
      // chat-turn(T9 Phase B):聊天回合投影——纯审计留痕(消息全文在 detail),
      // 状态与引擎无关,fold 忽略;历史读路径走 /api/chat/history 的日志过滤。
      case 'chat-turn':
      case 'chat-turn-started':
      case 'chat-turn-progress':
      // T15:raw dialogue 与 derived conversation context 是 append-only 审计事实；
      // 专用 conversation fold 消费它们，业务引擎快照保持不变。
      case 'chat-message-appended':
      case 'chat-context-updated':
      // agent-decision(T11 Phase B):inline 每步决策审计(step/driver/prompt/
      // reasoning/op 在 detail)——纯留痕,fold 忽略,与 chat-turn 同口径。
      case 'agent-decision':
      // meta-bootstrap-applied:应用制品安装 receipt；状态由同批 seed 事件物化。
      case 'meta-bootstrap-applied':
        break;
      default:
        throw new Error(`重放失败:未知事件 kind "${String(event.kind)}"(seq=${event.seq})`);
    }
  }
  return snapshot;
}
