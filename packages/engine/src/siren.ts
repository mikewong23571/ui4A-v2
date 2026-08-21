/**
 * Siren 投影器:rel → Siren 实体(arch-brief §2 四件组装)。
 *
 * properties / actions / links / guard-results;集合实体经 entities[] 携带
 * 子实体(带直达 href,B2 的"经子实体链接直达 post:post-welcome"即靠它)。
 * 纯函数;href 默认相对路径(/api/exec、/api/entity?rel=…),
 * HTTP 层以 baseHref 注入本源前缀——引擎不知道自己被挂在哪。
 */
import type {
  ActivationSnapshot,
  ConfirmationSnapshot,
  DefinitionEntry,
  EngineSnapshot,
  GuardEvaluation,
  GuardRegistry,
} from '@ui4a/shared';
import { fieldValues, metaActivationRel, terminalNodes } from '@ui4a/shared';

import {
  CONFIRMATION_APPROVE_ACTION,
  CONFIRMATION_REJECT_ACTION,
  confirmationRel,
} from './confirmation';
import { evaluateGuards, flowForInstance } from './judge';
import type { DefinitionVersionTable } from './judge';
import {
  DEFINITION_LIFECYCLE_FLOW,
  LIFECYCLE_INTERNAL_EDGES,
} from './lifecycle';
import { actionEffects } from './parse';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from './schema';
import type { ActionDefinition, FieldDefinition, FlowDefinition } from './types';

/** Siren action(字段为参数 JSON Schema——RJSF 与 agent 共同输入)。 */
export interface SirenAction {
  name: string;
  title: string;
  method: string;
  href: string;
  fields: Record<string, unknown>;
  'requires-confirmation'?: 'low' | 'medium' | 'high';
}

/** guard 求值结果逐项注入的条目(每个 action 一条,含 blocked 原因)。
 *  投影口径:guard 以空参数求值——依赖提交参数的谓词(如 title-not-taken)在投影中
 *  恒过;真正裁决以 exec 时的 guard 层为准,拒绝仍会带原因回流(拒绝即教育)。 */
export interface GuardResultEntry {
  action: string;
  blocked: boolean;
  reason?: string;
  guards: GuardEvaluation[];
}

export interface SirenLink {
  rel: string[];
  href: string;
}

/** Siren 实体(子实体额外带 rel 与直达 href)。 */
export interface SirenEntity {
  class: string[];
  rel?: string[];
  href?: string;
  properties: Record<string, unknown>;
  actions: SirenAction[];
  links: SirenLink[];
  'guard-results'?: GuardResultEntry[];
  entities?: SirenEntity[];
}

export interface ProjectDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
  guards: GuardRegistry;
  /** 按出生版本解析的注册表(T4 Phase B,与 JudgeDeps 同口径;缺省回退 flows)。 */
  versions?: DefinitionVersionTable;
  /** href 前缀(如 "http://localhost:3100" 或 "/_meta");缺省相对路径。 */
  baseHref?: string;
}

function entityHref(base: string | undefined, rel: string): string {
  return `${base ?? ''}/api/entity?rel=${rel}`;
}

function execHref(base: string | undefined): string {
  return `${base ?? ''}/api/exec`;
}

function toSirenAction(
  action: ActionDefinition,
  nodeFields: readonly FieldDefinition[],
  base: string | undefined,
): SirenAction {
  const sirenAction: SirenAction = {
    name: action.name,
    title: action.title,
    method: action.method ?? 'POST',
    href: execHref(base),
    fields: fieldDefinitionsToJsonSchema(mergeFieldDefinitions(nodeFields, action.fields ?? [])),
  };
  if (action['requires-confirmation'] !== undefined) {
    sirenAction['requires-confirmation'] = action['requires-confirmation'];
  }
  return sirenAction;
}

function guardResultsFor(
  actions: readonly ActionDefinition[],
  instance: EngineSnapshot['instances'][string],
  snapshot: EngineSnapshot,
  guards: GuardRegistry,
): GuardResultEntry[] {
  return actions.map((action) => {
    const evaluations = evaluateGuards(action, instance, snapshot, {}, guards);
    const failed = evaluations.filter((evaluation) => !evaluation.pass);
    const entry: GuardResultEntry = {
      action: action.name,
      blocked: failed.length > 0,
      guards: evaluations,
    };
    if (failed.length > 0) {
      entry.reason = `guard 不满足: ${failed.map((f) => `${f.name}=false`).join(', ')}`;
    }
    return entry;
  });
}

/** 实例实体投影(节点 = 界面:动作、guard、字段全部来自当前节点声明——
 *  声明按实例出生版本解析:在途实例看到的动作面是它的出生定义)。 */
function projectInstance(
  instance: EngineSnapshot['instances'][string],
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const flow = flowForInstance(deps, instance);
  const node = flow?.nodes.find((candidate) => candidate.name === instance.node);
  const actions = node?.actions ?? [];
  const links: SirenLink[] = [
    { rel: ['self'], href: entityHref(deps.baseHref, instance.rel) },
  ];
  // 成员反查所属集合(导航回链)。
  for (const [collection, members] of Object.entries(snapshot.collections)) {
    if (members.includes(instance.rel)) {
      links.push({ rel: ['collection'], href: entityHref(deps.baseHref, collection) });
    }
  }
  return {
    class: ['flow-instance', instance.flow],
    properties: {
      rel: instance.rel,
      flow: instance.flow,
      node: instance.node,
      title: node?.title ?? instance.node,
      fields: fieldValues(instance.fields),
    },
    actions: actions.map((action) =>
      toSirenAction(action, node?.fields ?? [], deps.baseHref),
    ),
    links,
    'guard-results': guardResultsFor(actions, instance, snapshot, deps.guards),
  };
}

/** 集合实体投影:entities[] 子实体(嵌入投影 + 直达 href)。 */
function projectCollection(
  rel: string,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const members = snapshot.collections[rel] ?? [];
  const entities = members.flatMap((member) => {
    const instance = snapshot.instances[member];
    if (instance === undefined) return [];
    const projected = projectInstance(instance, snapshot, deps);
    return [{ ...projected, rel: ['item'], href: entityHref(deps.baseHref, member) }];
  });
  return {
    class: ['collection', rel],
    properties: { rel, count: members.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, rel) }],
    'guard-results': [],
    entities,
  };
}

/**
 * 确认实体投影(spec 架构决定 2):properties 含目标 rel/action/params/提议者/
 * 信道/状态;pending 时挂 approve/reject 动作(guards: actor-is-human;reject 的
 * reason 必填且非空);非 pending(approved/rejected)是审计视图——无动作、无
 * guard-results(重复审批在引擎层仍被拒)。
 * guard 求值上下文以目标实例为 instance;投影无 actor 上下文,actor-is-human
 * 按 fail-closed 求值为 false(与实例投影的"空参数求值"同口径——真正裁决在
 * exec 时,同一个谓词的两个投影)。
 */
function projectConfirmation(
  confirmation: ConfirmationSnapshot,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const pending = confirmation.status === 'pending';
  const confirmationActions = pending
    ? [CONFIRMATION_APPROVE_ACTION, CONFIRMATION_REJECT_ACTION]
    : [];
  const target = snapshot.instances[confirmation.targetRel];
  const guardResults =
    pending && target !== undefined
      ? guardResultsFor(confirmationActions, target, snapshot, deps.guards)
      : [];
  return {
    class: ['confirmation', confirmation.status],
    properties: {
      id: confirmation.id,
      'target-rel': confirmation.targetRel,
      'target-action': confirmation.targetAction,
      params: fieldValues(confirmation.params ?? {}),
      'proposed-by': confirmation.proposedBy,
      ...(confirmation.channel !== undefined ? { channel: confirmation.channel } : {}),
      status: confirmation.status,
      // 送达状态(T3 Phase C:notification-delivered 折叠而来;仅已送达时注入,
      // 保持未送达实体的 properties 形状稳定)。
      ...(confirmation.notified === true ? { notified: true } : {}),
    },
    actions: confirmationActions.map((action) => toSirenAction(action, [], deps.baseHref)),
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, confirmationRel(confirmation.id)) },
      { rel: ['target'], href: entityHref(deps.baseHref, confirmation.targetRel) },
    ],
    'guard-results': guardResults,
  };
}

/**
 * inbox 集合投影(spec 架构决定 5):全部 pending confirmations 的集合实体,
 * 子实体直达(rel=["item"] + href)。已决策(approved/rejected)的确认不进
 * inbox——收件箱是待办视图,审计走事件日志。
 * properties.delivered:已送达(notify capability 完成)的条数(T3 Phase C)。
 */
function projectInbox(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const pending = Object.values(snapshot.confirmations ?? {}).filter(
    (confirmation) => confirmation.status === 'pending',
  );
  const delivered = pending.filter((confirmation) => confirmation.notified === true).length;
  const entities = pending.map((confirmation) => ({
    ...projectConfirmation(confirmation, snapshot, deps),
    rel: ['item'],
    href: entityHref(deps.baseHref, confirmationRel(confirmation.id)),
  }));
  return {
    class: ['collection', 'inbox'],
    properties: { rel: 'inbox', count: pending.length, delivered },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'inbox') }],
    'guard-results': [],
    entities,
  };
}

/**
 * rel → Siren 实体;未知 rel 返回 undefined(HTTP 层映射 404)。
 * 解析顺序:meta 前缀(定义层显式意图,优先于实例表——lifecycle 实例与定义
 * 实体同 rel,投影必须是定义视图)→ 实例 → 业务集合 → 确认实体
 * (confirmation:<id>)→ inbox 视图。
 */
export function project(
  snapshot: EngineSnapshot,
  rel: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  if (rel === 'meta/self' || rel.startsWith('meta/')) {
    return projectMeta(snapshot, rel, deps);
  }
  const instance = snapshot.instances[rel];
  if (instance !== undefined) {
    return projectInstance(instance, snapshot, deps);
  }
  if (rel in snapshot.collections) {
    return projectCollection(rel, snapshot, deps);
  }
  const confirmation = snapshot.confirmations?.[rel];
  if (confirmation !== undefined) {
    return projectConfirmation(confirmation, snapshot, deps);
  }
  if (rel === 'inbox') {
    return projectInbox(snapshot, deps);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// meta 平面投影(T4:A.2 定义实体形状;进入定义层必须显式意图)
// ---------------------------------------------------------------------------

/** action-definition 子实体属性(A.2 原样:声明全文,不裁剪)。 */
function actionDefinitionProperties(action: ActionDefinition): Record<string, unknown> {
  return {
    name: action.name,
    title: action.title,
    method: action.method ?? 'POST',
    ...(action.to !== undefined ? { to: action.to } : {}),
    guards: [...(action.guards ?? [])],
    ...(action['requires-confirmation'] !== undefined
      ? { 'requires-confirmation': action['requires-confirmation'] }
      : {}),
    effect: actionEffects(action),
    ...(action.fields !== undefined && action.fields.length > 0 ? { fields: action.fields } : {}),
  };
}

/** node-definition 子实体(内嵌 action-definition 子实体)。 */
function projectNodeDefinition(node: FlowDefinition['nodes'][number]): SirenEntity {
  return {
    class: ['meta', 'node-definition'],
    rel: ['node'],
    properties: { name: node.name, title: node.title ?? node.name },
    actions: [],
    links: [],
    entities: node.actions.map((action) => ({
      class: ['meta', 'action-definition'],
      rel: ['action'],
      properties: actionDefinitionProperties(action),
      actions: [],
      links: [],
    })),
  };
}

/** 状态对应的编辑动词(自举:动作声明取自 lifecycle 常量的对应节点)。 */
function lifecycleActionsForStatus(status: LifecycleStatus): ActionDefinition[] {
  const nodeName = status === 'draft' ? 'draft' : status === 'active' ? 'active' : undefined;
  if (nodeName === undefined) return [];
  const node = DEFINITION_LIFECYCLE_FLOW.nodes.find((candidate) => candidate.name === nodeName);
  return node?.actions ?? [];
}

/** 投影可见的 lifecycle 状态(含瞬态 validating:审计视图,无编辑动作)。 */
type LifecycleStatus = DefinitionEntry['status'] | 'validating';

/**
 * 定义实体投影(A.2 原样形状):class meta/flow-definition,properties
 * {name,version,status,initial,terminal},entities 节点子实体(含
 * action-definition),actions 编辑动词(按状态取 lifecycle 对应节点声明)。
 */
function projectDefinitionEntity(
  rel: string,
  properties: Record<string, unknown>,
  definition: FlowDefinition,
  status: LifecycleStatus,
  instance: EngineSnapshot['instances'][string] | undefined,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const actions = lifecycleActionsForStatus(status);
  return {
    class: ['meta', 'flow-definition'],
    properties: {
      ...properties,
      status,
      initial: definition.initial,
      terminal: terminalNodes(definition),
    },
    entities: definition.nodes.map(projectNodeDefinition),
    actions: actions.map((action) => toSirenAction(action, [], deps.baseHref)),
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, rel) }],
    'guard-results':
      instance !== undefined ? guardResultsFor(actions, instance, snapshot, deps.guards) : [],
  };
}

/** meta/self:definition-lifecycle 自身定义的只读视图(+种子 guard 集)。 */
function projectSelf(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  return {
    class: ['meta', 'flow-definition'],
    properties: {
      name: DEFINITION_LIFECYCLE_FLOW.name,
      version: 1,
      status: 'active',
      initial: DEFINITION_LIFECYCLE_FLOW.initial,
      // validating 的引擎内边参与推导(它无 exec 动作,否则会被误判 terminal)。
      terminal: terminalNodes(DEFINITION_LIFECYCLE_FLOW, LIFECYCLE_INTERNAL_EDGES),
      guards: Object.keys(deps.guards),
    },
    entities: DEFINITION_LIFECYCLE_FLOW.nodes.map(projectNodeDefinition),
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'meta/self') }],
    'guard-results': [],
  };
}

/** meta/flow:<name>:definitions 表条目 + lifecycle 实例 → 定义实体。 */
function projectFlowDefinition(
  snapshot: EngineSnapshot,
  name: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  const entry = snapshot.definitions?.[name];
  if (entry === undefined) return undefined;
  const rel = `meta/flow:${name}`;
  const instance = snapshot.instances[rel];
  return projectDefinitionEntity(
    rel,
    { name: entry.name, version: entry.version, ...(entry.bornBy !== undefined ? { bornBy: entry.bornBy } : {}) },
    entry.definition,
    entry.status,
    instance,
    snapshot,
    deps,
  );
}

/** meta/flows:全部定义实体的集合(子实体直达)。 */
function projectFlows(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const entries = Object.values(snapshot.definitions ?? {});
  const entities = entries.map((entry) => {
    const projected = projectFlowDefinition(snapshot, entry.name, deps)!;
    return { ...projected, rel: ['item'], href: entityHref(deps.baseHref, `meta/flow:${entry.name}`) };
  });
  return {
    class: ['collection', 'meta/flows'],
    properties: { rel: 'meta/flows', count: entries.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'meta/flows') }],
    'guard-results': [],
    entities,
  };
}

/**
 * 激活实体投影(A.2 激活请求形状):properties {id,status,artifact,checks,
 * requested-by,version,flow};pending 时挂 approve/reject(声明取自 lifecycle
 * 常量 pending-approval 节点,含 reject 的 reason 必填字段);已决策
 * (approved/rejected)是审计视图——无动作、无 guard-results。
 * guard 求值上下文以目标定义的 lifecycle 实例为 instance;投影无 actor
 * 上下文,actor-is-human fail-closed(与确认实体同口径)。
 */
function projectActivation(
  activation: ActivationSnapshot,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const rel = metaActivationRel(activation.id);
  const pending = activation.status === 'pending-approval';
  const targetInstance = snapshot.instances[`meta/flow:${activation.flow}`];
  const lifecycleNode = DEFINITION_LIFECYCLE_FLOW.nodes.find(
    (candidate) => candidate.name === 'pending-approval',
  );
  const actions = pending ? (lifecycleNode?.actions ?? []) : [];
  return {
    class: ['meta', 'activation', activation.status],
    properties: {
      id: activation.id,
      flow: activation.flow,
      status: activation.status,
      version: activation.version,
      artifact: activation.artifact,
      checks: activation.checks,
      'requested-by': activation.requestedBy,
      ...(activation.approvedBy !== undefined ? { 'approved-by': activation.approvedBy } : {}),
      ...(activation.rejectedReason !== undefined
        ? { 'rejected-reason': activation.rejectedReason }
        : {}),
    },
    actions: actions.map((action) => toSirenAction(action, [], deps.baseHref)),
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, rel) },
      { rel: ['target'], href: entityHref(deps.baseHref, `meta/flow:${activation.flow}`) },
    ],
    'guard-results':
      pending && targetInstance !== undefined
        ? guardResultsFor(actions, targetInstance, snapshot, deps.guards)
        : [],
  };
}

/** meta/activations:激活队列(仅 pending;已决策走审计视图与事件日志)。 */
function projectActivations(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const pending = Object.values(snapshot.activations ?? {}).filter(
    (activation) => activation.status === 'pending-approval',
  );
  const entities = pending.map((activation) => ({
    ...projectActivation(activation, snapshot, deps),
    rel: ['item'],
    href: entityHref(deps.baseHref, metaActivationRel(activation.id)),
  }));
  return {
    class: ['collection', 'meta/activations'],
    properties: { rel: 'meta/activations', count: pending.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'meta/activations') }],
    'guard-results': [],
    entities,
  };
}

/**
 * meta 平面路由:self / flows / flow:<name> / activation:<id> / activations。
 * 未知 meta rel → undefined(HTTP 层映射 404)。
 */
function projectMeta(
  snapshot: EngineSnapshot,
  rel: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  if (rel === 'meta/self') return projectSelf(snapshot, deps);
  if (rel === 'meta/flows') return projectFlows(snapshot, deps);
  if (rel === 'meta/activations') return projectActivations(snapshot, deps);
  if (rel.startsWith('meta/flow:')) {
    return projectFlowDefinition(snapshot, rel.slice('meta/flow:'.length), deps);
  }
  if (rel.startsWith('meta/activation:')) {
    const activation = snapshot.activations?.[rel];
    return activation === undefined ? undefined : projectActivation(activation, snapshot, deps);
  }
  return undefined;
}
