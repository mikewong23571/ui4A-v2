/**
 * 种子 guard 谓词(spec 架构决定 2:实现放 shared,engine 只持注册表)。
 *
 * 铁律(arch-brief §3):纯且快、只读快照、永远不调 capability——
 * capability 结果先落状态,guard 再读状态。
 */
import {
  KNOWN_EFFECT_TYPES,
  flowNameFromMetaRel,
  terminalNodes,
  type FlowDefinition,
} from './definition';
import type { GuardContext, GuardPredicate, GuardRegistry } from './guards';

/** 实例当前节点等于给定节点。 */
export function nodeIs(node: string): GuardPredicate {
  return (context: GuardContext) => context.instance.node === node;
}

/** 实例处于待处理节点(评论审核队列的入门谓词)。 */
export const isPending: GuardPredicate = nodeIs('pending');

/** 实例处于已发布节点(post-status 的可下线/可归档谓词)。 */
export const isPublished: GuardPredicate = nodeIs('published');

/**
 * 拟发布文章标题未被既有文章占用(发布向导 publish 的 guard)。
 * 跨实例只读快照演示 guard 的真实用途:状态相关而非节点同义反复——
 * 重名发布被拒并留痕,拒绝即教育(B1 的字段级自救场景)。
 */
export const titleNotTaken: GuardPredicate = (context) => {
  const candidate = context.params.title;
  if (typeof candidate !== 'string') return true;
  for (const instance of Object.values(context.snapshot.instances)) {
    if (instance.flow !== 'post-status') continue;
    if (instance.fields.title?.value === candidate) return false;
  }
  return true;
};

/** 恒真(空 guard 动作的显式占位,亦用于测试)。 */
export const alwaysTrue: GuardPredicate = () => true;

// ---------------------------------------------------------------------------
// meta 平面谓词(T4,arch-brief §10 A.3 编辑动词 guard + is-active)。
// 求值上下文 = lifecycle 实例(rel = meta/flow:<name>,node = 生命周期状态);
// 工作副本从快照 definitions 表读取。
// 投影口径(与业务谓词一致,见 siren.ts):guard 以空参数求值——依赖参数的
// 谓词对"参数缺席"vacuous pass(参数必填/形状是 schema 层职责);对
// "参数在场但畸形/未命中"fail-closed(false)。
// ---------------------------------------------------------------------------

/** definition-lifecycle 实例且处于给定生命周期状态。 */
function lifecycleAt(context: GuardContext, status: string): boolean {
  return context.instance.flow === 'definition-lifecycle' && context.instance.node === status;
}

/** lifecycle 实例处于 draft(编辑动词的前置,A.3 is-draft)。 */
export const isDraft: GuardPredicate = (context) => lifecycleAt(context, 'draft');

/** lifecycle 实例处于 active(A.2 revise 的 guard)。 */
export const isActive: GuardPredicate = (context) => lifecycleAt(context, 'active');

/** 当前定义的工作副本(definitions 表;非 meta 实例返回 undefined)。 */
function workingCopyOf(context: GuardContext): FlowDefinition | undefined {
  const name = flowNameFromMetaRel(context.instance.rel);
  if (name === undefined) return undefined;
  return context.snapshot.definitions?.[name]?.definition;
}

/** 编辑动词的目标节点名:add-node 用 name,add-action 用 node。 */
function requestedNodeName(params: Readonly<Record<string, unknown>>): string | undefined {
  const candidate = params.node ?? params.name;
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 节点存在于工作副本(add-action 的 node)。 */
export const nodeExists: GuardPredicate = (context) => {
  const requested = requestedNodeName(context.params);
  if (requested === undefined) return true; // 参数缺席:vacuous(schema 层管必填)
  const definition = workingCopyOf(context);
  if (definition === undefined) return false;
  return definition.nodes.some((node) => node.name === requested);
};

/** 节点不存在于工作副本(add-node 的唯一性)。 */
export const nodeNotExists: GuardPredicate = (context) => {
  const requested = requestedNodeName(context.params);
  if (requested === undefined) return true; // 参数缺席:vacuous
  const definition = workingCopyOf(context);
  if (definition === undefined) return false;
  return !definition.nodes.some((node) => node.name === requested);
};

/** add-action 载荷中的 action-definition(缺 → null;畸形 → undefined)。 */
function addedActionOf(
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null | undefined {
  if (params.action === undefined) return null;
  return isPlainRecord(params.action) ? params.action : undefined;
}

/**
 * 边目标存在(to-exists):add-action 的 to 指向工作副本已有节点。
 * 未声明 to 的动作无此约束(空动作/纯效果动作合法)——vacuous pass。
 */
export const toExists: GuardPredicate = (context) => {
  const action = addedActionOf(context.params);
  if (action === null) return true;
  if (action === undefined) return false;
  const target = action.to;
  if (target === undefined || target === null) return true;
  if (typeof target !== 'string') return false;
  const definition = workingCopyOf(context);
  if (definition === undefined) return false;
  return definition.nodes.some((node) => node.name === target);
};

/** 声明的 guard 名全部已注册(guards-registered;读裁决器注入的 knownGuards)。 */
export const guardsRegistered: GuardPredicate = (context) => {
  const action = addedActionOf(context.params);
  if (action === null) return true;
  if (action === undefined) return false;
  const guards = action.guards;
  if (guards === undefined || guards === null) return true;
  if (!Array.isArray(guards)) return false;
  const known = context.knownGuards;
  if (known === undefined) return false;
  return guards.every((guard) => typeof guard === 'string' && known.has(guard));
};

/** 声明的效果类型全部已知(effect-known;未声明效果 = vacuous pass)。 */
export const effectKnown: GuardPredicate = (context) => {
  const action = addedActionOf(context.params);
  if (action === null) return true;
  if (action === undefined) return false;
  const effect = action.effect;
  if (effect === undefined || effect === null) return true;
  const effects = Array.isArray(effect) ? effect : [effect];
  return effects.every(
    (candidate) =>
      isPlainRecord(candidate) &&
      typeof candidate.type === 'string' &&
      KNOWN_EFFECT_TYPES.has(candidate.type),
  );
};

/** 目标节点上尚无同名动作(action-not-exists:防重复声明)。 */
export const actionNotExists: GuardPredicate = (context) => {
  const action = addedActionOf(context.params);
  if (action === null) return true;
  if (action === undefined) return false;
  const nodeName = requestedNodeName(context.params);
  if (nodeName === undefined) return true;
  if (typeof action.name !== 'string' || action.name === '') return false;
  const definition = workingCopyOf(context);
  if (definition === undefined) return false;
  const node = definition.nodes.find((candidate) => candidate.name === nodeName);
  if (node === undefined) return false;
  return !node.actions.some((candidate) => candidate.name === action.name);
};

/**
 * 该 flow 无在途实例(no-live-instances,deprecate 的 guard):
 * 实例处于非 terminal 节点即"在途"(T4 口径:不分出生版本,terminal 由
 * 工作副本推导——无出边节点)。
 */
export const noLiveInstances: GuardPredicate = (context) => {
  const name = flowNameFromMetaRel(context.instance.rel);
  if (name === undefined) return false;
  const definition = workingCopyOf(context);
  if (definition === undefined) return false;
  const terminals = new Set(terminalNodes(definition));
  for (const instance of Object.values(context.snapshot.instances)) {
    if (instance.flow === name && !terminals.has(instance.node)) return false;
  }
  return true;
};

/**
 * 本次 exec 的行为者是人类(铁律 5"审批不委托":确认实体的 approve/reject guard)。
 * 无 actor 上下文(Siren 投影求值)时 fail-closed 为 false——
 * 投影不是裁决,真正判定永远发生在 exec 时(同一个谓词的两个投影)。
 */
export const actorIsHuman: GuardPredicate = (context) => context.actor === 'human';

/** Internal capability callbacks use a deployment-authenticated system principal. */
export const principalIsCapabilitySystem: GuardPredicate = (context) =>
  context.principal?.startsWith('system:capability:') === true;

/**
 * 正式 artifact 引用校验：动作字段以 source.kind=effect + capability 声明
 * 期望能力；参数必须引用已物化工件，且工件来源实体就是当前实例。
 * capability 输出仍是独立工件，此 guard 只授权随后 action 保存引用。
 */
export const artifactInputValid: GuardPredicate = (context) => {
  const constrained = (context.action?.fields ?? []).filter(
    (field) => field.source?.kind === 'effect' && field.source.capability !== undefined,
  );
  if (constrained.length === 0) return false;
  return constrained.every((field) => {
    const rel = context.params[field.name];
    // Siren 投影以空参数求值；必填性归 schema 层，参数缺席时不提前阻塞动作。
    if (rel === undefined) return true;
    if (typeof rel !== 'string') return false;
    const artifact = context.snapshot.artifacts?.[rel];
    return (
      artifact !== undefined &&
      artifact.capability === field.source?.capability &&
      artifact.source.rel === context.instance.rel &&
      (field.source?.from === undefined || artifact.source.field === field.source.from)
    );
  });
};

/** 种子注册表:名字 → 谓词。meta/registries 的运行时子集。 */
export const seedGuardRegistry: GuardRegistry = {
  'is-pending': isPending,
  'is-published': isPublished,
  'title-not-taken': titleNotTaken,
  'always-true': alwaysTrue,
  'actor-is-human': actorIsHuman,
  'principal-is-capability-system': principalIsCapabilitySystem,
  'artifact-input-valid': artifactInputValid,
  // T4 meta 平面(A.3 编辑动词 + is-active)。
  'is-draft': isDraft,
  'is-active': isActive,
  'node-exists': nodeExists,
  'node-not-exists': nodeNotExists,
  'to-exists': toExists,
  'guards-registered': guardsRegistered,
  'effect-known': effectKnown,
  'action-not-exists': actionNotExists,
  'no-live-instances': noLiveInstances,
};
