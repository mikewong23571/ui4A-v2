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
  CapabilityDefinition,
  ConfirmationSnapshot,
  DefinitionEntry,
  DelegationSnapshot,
  EngineSnapshot,
  FrozenRenderSpec,
  GuardEvaluation,
  GuardRegistry,
} from '@ui4a/shared';
import {
  fieldValues,
  META_CAPABILITY_PREFIX,
  metaActivationRel,
  terminalNodes,
} from '@ui4a/shared';

import {
  CONFIRMATION_APPROVE_ACTION,
  CONFIRMATION_REJECT_ACTION,
  confirmationRel,
} from './confirmation';
import { DELEGATIONS_REL, delegationRel } from './delegation';
import { evaluateGuards, flowForInstance } from './judge';
import type { DefinitionVersionTable } from './judge';
import { DEFINITION_LIFECYCLE_FLOW, LIFECYCLE_INTERNAL_EDGES } from './lifecycle';
import { actionEffects } from './parse';
import {
  RENDER_SPECS_REL,
  RENDER_SPEC_REL_PREFIX,
  readRenderSpecsOf,
  renderSpecRel,
} from './render-spec';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from './schema';
import type { ActionDefinition, FieldDefinition, FlowDefinition } from './types';

export interface SirenFieldPresentation {
  /** Binding path into this Siren entity. It is a reference, never a copied field value. */
  path: string;
  title: string;
  role?: NonNullable<FieldDefinition['presentation']>['role'];
  contentMediaType?: string;
}

function fallbackPresentationRole(
  fieldName: string,
): NonNullable<FieldDefinition['presentation']>['role'] {
  const normalized = fieldName.toLowerCase();
  if (['title', 'name', 'label', 'identity'].includes(normalized)) return 'identity';
  if (['body', 'content', 'description', 'summary'].includes(normalized)) {
    return 'primary-content';
  }
  if (['status', 'state'].includes(normalized)) return 'status';
  return 'metadata';
}

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
  const collectedNodeFields = action['collect-node-fields'] === false ? [] : nodeFields;
  const sirenAction: SirenAction = {
    name: action.name,
    title: action.title,
    method: action.method ?? 'POST',
    href: execHref(base),
    fields: fieldDefinitionsToJsonSchema(
      mergeFieldDefinitions(collectedNodeFields, action.fields ?? []),
    ),
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
  const fieldDefinitions = mergeFieldDefinitions(flow?.fields ?? [], node?.fields ?? []);
  const fields = fieldValues(instance.fields);
  const definitionsByName = new Map(fieldDefinitions.map((field) => [field.name, field]));
  const presentationFieldNames = [
    ...fieldDefinitions.map((field) => field.name),
    ...Object.keys(fields).filter((name) => !definitionsByName.has(name)),
  ];
  const fieldPresentations: SirenFieldPresentation[] = presentationFieldNames.map((name) => {
    const field = definitionsByName.get(name);
    return {
      path: `properties.fields.${name}`,
      title: field?.title ?? name,
      role: field?.presentation?.role ?? fallbackPresentationRole(name),
      ...(field?.contentMediaType === undefined
        ? {}
        : { contentMediaType: field.contentMediaType }),
    };
  });
  const identityPresentation = fieldPresentations.find((field) => field.role === 'identity');
  const identityName = identityPresentation?.path.split('.').at(-1);
  const explicitIdentity = identityName === undefined ? undefined : fields[identityName];
  const actions = node?.actions ?? [];
  const links: SirenLink[] = [{ rel: ['self'], href: entityHref(deps.baseHref, instance.rel) }];
  // 成员反查所属集合(导航回链)。
  for (const [collection, members] of Object.entries(snapshot.collections)) {
    if (members.includes(instance.rel)) {
      links.push({ rel: ['collection'], href: entityHref(deps.baseHref, collection) });
    }
  }
  for (const artifact of Object.values(snapshot.artifacts ?? {})) {
    if (artifact.source.rel === instance.rel) {
      links.push({
        rel: ['artifact', artifact.capability],
        href: entityHref(deps.baseHref, artifact.rel),
      });
    }
  }
  return {
    class: ['flow-instance', instance.flow],
    properties: {
      rel: instance.rel,
      flow: instance.flow,
      node: instance.node,
      title: node?.title ?? instance.node,
      identity: explicitIdentity ?? flow?.title ?? instance.rel,
      status: instance.node,
      fields,
      presentation: { fields: fieldPresentations },
    },
    actions: actions.map((action) => toSirenAction(action, node?.fields ?? [], deps.baseHref)),
    links,
    'guard-results': guardResultsFor(actions, instance, snapshot, deps.guards),
  };
}

/** 集合实体投影:entities[] 子实体(嵌入投影 + 直达 href)。 */
function projectCollection(rel: string, snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
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

function projectCapabilityArtifact(
  rel: string,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity | undefined {
  const artifact = snapshot.artifacts?.[rel];
  if (artifact === undefined) return undefined;
  return {
    class: ['capability-artifact', artifact.capability],
    properties: {
      rel,
      id: artifact.id,
      capability: artifact.capability,
      source: artifact.source,
      model: artifact.model,
      'output-schema': artifact.outputSchema,
      content: artifact.content,
      'content-hash': artifact.contentHash,
      'created-by': artifact.createdBy,
    },
    actions: [],
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, rel) },
      { rel: ['source'], href: entityHref(deps.baseHref, artifact.source.rel) },
    ],
    'guard-results': [],
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
  const targetFlow = target === undefined ? undefined : flowForInstance(deps, target);
  const targetNode = targetFlow?.nodes.find((node) => node.name === target?.node);
  const targetAction = targetNode?.actions.find(
    (action) => action.name === confirmation.targetAction,
  );
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
      ...(confirmation.riskLevel !== undefined ||
      targetAction?.['requires-confirmation'] !== undefined
        ? { 'risk-level': confirmation.riskLevel ?? targetAction?.['requires-confirmation'] }
        : {}),
      ...(confirmation.policy !== undefined ? { policy: confirmation.policy } : {}),
      ...(confirmation.policyReason !== undefined
        ? { 'policy-reason': confirmation.policyReason }
        : {}),
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
 * 委托实体投影(T5 / spec 架构决定 2):class [delegation, status],
 * properties 含 goal/driver-kind/start-rel/principal/status/steps/successes
 * (+summary/reason);无动作(委托的每步操作走事件日志,不经实体动作面)。
 */
function projectDelegation(delegation: DelegationSnapshot, deps: ProjectDeps): SirenEntity {
  return {
    class: ['delegation', delegation.status],
    properties: {
      id: delegation.id,
      goal: delegation.goal,
      'driver-kind': delegation.driverKind,
      ...(delegation.model !== undefined ? { model: delegation.model } : {}),
      'start-rel': delegation.startRel,
      ...(delegation.principal !== undefined ? { principal: delegation.principal } : {}),
      status: delegation.status,
      steps: delegation.steps,
      successes: delegation.successes,
      ...(delegation.summary !== undefined ? { summary: delegation.summary } : {}),
      ...(delegation.reason !== undefined ? { reason: delegation.reason } : {}),
    },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, delegationRel(delegation.id)) }],
    'guard-results': [],
  };
}

/** delegations 集合投影(舰队页数据源):全部委托的集合实体,子实体直达。 */
function projectDelegations(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const entries = Object.values(snapshot.delegations ?? {});
  const entities = entries.map((delegation) => ({
    ...projectDelegation(delegation, deps),
    rel: ['item'],
    href: entityHref(deps.baseHref, delegationRel(delegation.id)),
  }));
  return {
    class: ['collection', DELEGATIONS_REL],
    properties: { rel: DELEGATIONS_REL, count: entries.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, DELEGATIONS_REL) }],
    'guard-results': [],
    entities,
  };
}

/**
 * 已凝固渲染 spec 实体投影(T7):properties 含 concern/component/bind/
 * requested-by;无动作(凝固是数据不是操作,重生/改版走生成路径与
 * freezeSpec 服务层入口)。bind 原样直出(零字面引用树,渲染器解引用)。
 */
function projectRenderSpec(frozen: FrozenRenderSpec, deps: ProjectDeps): SirenEntity {
  return {
    class: ['render-spec', 'frozen'],
    properties: {
      concern: frozen.concern,
      component: frozen.component,
      bind: frozen.bind,
      'requested-by': frozen.requestedBy,
    },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, renderSpecRel(frozen.concern)) }],
    'guard-results': [],
  };
}

/** render-specs 集合投影(最小:concern 集合;画布经合同查已凝固 spec)。 */
function projectRenderSpecs(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const entries = readRenderSpecsOf(snapshot);
  const entities = entries.map((frozen) => ({
    ...projectRenderSpec(frozen, deps),
    rel: ['item'],
    href: entityHref(deps.baseHref, renderSpecRel(frozen.concern)),
  }));
  return {
    class: ['collection', RENDER_SPECS_REL],
    properties: { rel: RENDER_SPECS_REL, count: entries.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, RENDER_SPECS_REL) }],
    'guard-results': [],
    entities,
  };
}

/**
 * rel → Siren 实体;未知 rel 返回 undefined(HTTP 层映射 404)。
 * 解析顺序:meta 前缀(定义层显式意图,优先于实例表——lifecycle 实例与定义
 * 实体同 rel,投影必须是定义视图)→ 实例 → 业务集合 → 确认实体
 * (confirmation:<id>)→ 委托实体(delegation:<id>)→ inbox 视图 →
 * delegations 集合视图(T5)→ 已凝固渲染 spec(render-spec:<concern>,
 * T7)→ render-specs 集合视图(T7)。
 */
export function project(
  snapshot: EngineSnapshot,
  rel: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  if (rel.startsWith('artifact:')) return projectCapabilityArtifact(rel, snapshot, deps);
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
  const delegation = snapshot.delegations?.[rel];
  if (delegation !== undefined) {
    return projectDelegation(delegation, deps);
  }
  if (rel === 'inbox') {
    return projectInbox(snapshot, deps);
  }
  if (rel === DELEGATIONS_REL) {
    return projectDelegations(snapshot, deps);
  }
  if (rel.startsWith(RENDER_SPEC_REL_PREFIX)) {
    const concern = rel.slice(RENDER_SPEC_REL_PREFIX.length);
    const frozen = snapshot.renderSpecs?.[concern];
    return frozen === undefined ? undefined : projectRenderSpec(frozen, deps);
  }
  if (rel === RENDER_SPECS_REL) {
    return projectRenderSpecs(snapshot, deps);
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

/** meta/flow:<name>:definitions 表条目 + lifecycle 实例 → 定义实体(+版本历史摘要子实体)。 */
function projectFlowDefinition(
  snapshot: EngineSnapshot,
  name: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  const entry = snapshot.definitions?.[name];
  if (entry === undefined) return undefined;
  const rel = `meta/flow:${name}`;
  const instance = snapshot.instances[rel];
  const entity = projectDefinitionEntity(
    rel,
    {
      name: entry.name,
      version: entry.version,
      ...(entry.bornBy !== undefined ? { bornBy: entry.bornBy } : {}),
    },
    entry.definition,
    entry.status,
    instance,
    snapshot,
    deps,
  );
  // 版本历史摘要子实体(T13 Phase B)排在节点子实体之后——子实体按 class
  // 各表其区(node-definition / definition-version),properties 的 A.2 形状不动。
  return {
    ...entity,
    entities: [
      ...(entity.entities ?? []),
      ...versionSummariesOf(snapshot, entry).map(projectVersionSummary),
    ],
  };
}

/**
 * 版本历史摘要(T13 Phase B;definitionVersions + activations 两表推导):
 * - 版本号升序;status:active = 条目活跃指针(最后激活版),其余 superseded
 *   (flow 级 draft/deprecated 是条目状态,在 properties.status,不进版本区);
 * - source = 沉淀本版的事件口径:approved 激活在场 → definition-activated
 *   (携带激活 id 与审批者,与 definition-activated 事件的 detail 同口径),
 *   否则 definition-seeded(boot 种子);
 * - definition = 该版定义全文(KB 级 JSON,体积可控——按版本取定义的读取
 *   路径即内嵌于此,两版对比 Task 2 取两版子实体即可,无需另开端点);
 * - 历史表缺项(老日志/fixture 快照):回退条目活跃指针,单版本 active、
 *   无 source(来源不可证,不造数据);definition 回退条目工作副本——与
 *   activeDefinitionOf 的回退同口径(seed 后未编辑时与活跃内容同文)。
 */
interface DefinitionVersionSummary {
  version: number;
  status: 'active' | 'superseded';
  source?: 'definition-seeded' | 'definition-activated';
  activationId?: string;
  decidedBy?: ActivationSnapshot['approvedBy'];
  definition: FlowDefinition;
}

/** 沉淀某版本的 approved 激活(definition-activated 来源;无则为种子版)。 */
function approvedActivationOf(
  snapshot: EngineSnapshot,
  name: string,
  version: number,
): ActivationSnapshot | undefined {
  return Object.values(snapshot.activations ?? {}).find(
    (candidate) =>
      candidate.flow === name && candidate.version === version && candidate.status === 'approved',
  );
}

function versionSummariesOf(
  snapshot: EngineSnapshot,
  entry: DefinitionEntry,
): DefinitionVersionSummary[] {
  const table = snapshot.definitionVersions?.[entry.name] ?? {};
  const versions = Object.keys(table)
    .map((key) => Number(key))
    .sort((a, b) => a - b);
  if (versions.length === 0) {
    return [{ version: entry.version, status: 'active', definition: entry.definition }];
  }
  return versions.map((version) => {
    const definition = table[version];
    if (definition === undefined) {
      // 版本号枚举自该表,键必在场(同 meta.ts withEntry 的响亮失败口径)。
      throw new Error(`definitionVersions 表缺 "${entry.name}" v${version}(引擎内部一致性)`);
    }
    const activation = approvedActivationOf(snapshot, entry.name, version);
    const summary: DefinitionVersionSummary = {
      version,
      status: version === entry.version ? 'active' : 'superseded',
      source: activation === undefined ? 'definition-seeded' : 'definition-activated',
      definition,
    };
    if (activation !== undefined) {
      summary.activationId = activation.id;
      if (activation.approvedBy !== undefined) {
        summary.decidedBy = activation.approvedBy;
      }
    }
    return summary;
  });
}

/** 摘要 → properties(缺省字段不出现,形状稳定口径与 confirmation 投影同;definition 大块置后)。 */
function versionSummaryProperties(summary: DefinitionVersionSummary): Record<string, unknown> {
  return {
    version: summary.version,
    status: summary.status,
    ...(summary.source !== undefined ? { source: summary.source } : {}),
    ...(summary.activationId !== undefined ? { activation: summary.activationId } : {}),
    ...(summary.decidedBy !== undefined ? { 'decided-by': summary.decidedBy } : {}),
    definition: summary.definition,
  };
}

/**
 * definition-version 摘要子实体(rel=version)。
 * 有意不挂 href:rule driver 的 navigableRels 把子实体 href 纳入 agent 可导航
 * 候选——版本实体是 BIOS 数据面,不是 agent 决策面(S2 实测:版本 href 会让
 * 非法提案被拒后的 agent 在定义实体与版本实体间漫游至 max-steps,而非终局
 * failed)。按版本取定义走 properties.definition 内嵌全文,无独立版本 rel。
 */
function projectVersionSummary(summary: DefinitionVersionSummary): SirenEntity {
  return {
    class: ['meta', 'definition-version'],
    rel: ['version'],
    properties: versionSummaryProperties(summary),
    actions: [],
    links: [],
  };
}

/** meta/flows:全部定义实体的集合(子实体直达)。 */
function projectFlows(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const entries = Object.values(snapshot.definitions ?? {});
  const entities = entries.map((entry) => {
    const projected = projectFlowDefinition(snapshot, entry.name, deps)!;
    return {
      ...projected,
      rel: ['item'],
      href: entityHref(deps.baseHref, `meta/flow:${entry.name}`),
    };
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
      // 机械 diff 纯数据原样入 properties(渲染零 AI:结构化数据 → 内建组件树)。
      ...(activation.diff !== undefined ? { diff: activation.diff } : {}),
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
 * capability 定义实体投影(T13 Phase C;spec 架构决定 3):class
 * meta/capability-definition,properties 属性表形状 {name,title,kind,intent}
 * (+可选 input/output,缺省不出现——形状稳定口径与 confirmation 投影同)。
 * 只读:无动作、guard-results 空(编辑动词归后续,spec 架构决定 5 口径)。
 */
function projectCapability(capability: CapabilityDefinition, deps: ProjectDeps): SirenEntity {
  const rel = `${META_CAPABILITY_PREFIX}${capability.name}`;
  return {
    class: ['meta', 'capability-definition'],
    properties: {
      name: capability.name,
      title: capability.title,
      kind: capability.kind,
      intent: capability.intent,
      ...(capability.input !== undefined ? { input: capability.input } : {}),
      ...(capability.output !== undefined ? { output: capability.output } : {}),
      ...(capability.inputSchema !== undefined ? { 'input-schema': capability.inputSchema } : {}),
      ...(capability.outputSchema !== undefined
        ? { 'output-schema': capability.outputSchema }
        : {}),
      ...(capability.scope !== undefined ? { scope: capability.scope } : {}),
    },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, rel) }],
    'guard-results': [],
  };
}

/**
 * meta/capabilities:capability 目录集合(子实体直达)。capabilities 表缺省
 * (过渡期,seed 前的老快照)→ 空目录 count 0——面恒在场,成员随表列出
 * (与 meta/flows 集合同口径)。
 */
function projectCapabilities(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const entries = Object.values(snapshot.capabilities ?? {});
  const entities = entries.map((capability) => ({
    ...projectCapability(capability, deps),
    rel: ['item'],
    href: entityHref(deps.baseHref, `${META_CAPABILITY_PREFIX}${capability.name}`),
  }));
  return {
    class: ['collection', 'meta/capabilities'],
    properties: { rel: 'meta/capabilities', count: entries.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'meta/capabilities') }],
    'guard-results': [],
    entities,
  };
}

/**
 * meta 平面路由:self / flows / flow:<name> / activation:<id> / activations /
 * capabilities / capability:<name>(T13 Phase C)。
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
  if (rel === 'meta/capabilities') return projectCapabilities(snapshot, deps);
  if (rel.startsWith('meta/flow:')) {
    return projectFlowDefinition(snapshot, rel.slice('meta/flow:'.length), deps);
  }
  if (rel.startsWith('meta/activation:')) {
    const activation = snapshot.activations?.[rel];
    return activation === undefined ? undefined : projectActivation(activation, snapshot, deps);
  }
  if (rel.startsWith(META_CAPABILITY_PREFIX)) {
    const capability = snapshot.capabilities?.[rel.slice(META_CAPABILITY_PREFIX.length)];
    return capability === undefined ? undefined : projectCapability(capability, deps);
  }
  return undefined;
}
