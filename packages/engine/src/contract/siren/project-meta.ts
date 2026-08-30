/**
 * meta 平面投影(T4:A.2 定义实体形状;进入定义层必须显式意图):
 * self / flows / flow:<name> / activation:<id> / activations /
 * capabilities / capability:<name>(T13 Phase C)/ applications(T10)。
 * 未知 meta rel → undefined(HTTP 层映射 404)。
 */
import type {
  ActivationSnapshot,
  CapabilityDefinition,
  DefinitionEntry,
  EngineSnapshot,
} from '@ui4a/shared';
import { META_CAPABILITY_PREFIX, metaActivationRel, terminalNodes } from '@ui4a/shared';

import { DEFINITION_LIFECYCLE_FLOW, LIFECYCLE_INTERNAL_EDGES } from '../../definition/lifecycle';
import { actionEffects } from '../../core/parse';
import { exportDefinitionBundle } from '../../definition/definition-bundle';
import type { ActionDefinition, FlowDefinition } from '../../core/types';
import { projectCognitiveSemantics } from '../cognitive-semantics';
import { entityHref, guardResultsFor, toSirenAction } from './build';
import type { ProjectDeps, SirenEntity } from './types';

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
      rel,
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
      rel: 'meta/self',
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
      // T35 S7.1:flow 级业务标题随投影携带(声明了才出现,缺省字段不出现
      // 的形状稳定口径)——meta 读面以标题为主、raw id 退居次要。
      ...(entry.definition.title !== undefined ? { title: entry.definition.title } : {}),
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
    links: [
      ...entity.links,
      {
        rel: ['application'],
        href: entityHref(deps.baseHref, `meta/application:${entry.definition.app ?? 'default'}`),
      },
    ],
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
      rel,
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
function projectCapability(
  snapshot: EngineSnapshot,
  capability: CapabilityDefinition,
  deps: ProjectDeps,
): SirenEntity {
  const rel = `${META_CAPABILITY_PREFIX}${capability.name}`;
  const applications = Object.keys(snapshot.applications ?? {}).filter((name) =>
    exportDefinitionBundle(snapshot, name).capabilities.some(
      (candidate) => candidate.name === capability.name,
    ),
  );
  return {
    class: ['meta', 'capability-definition'],
    properties: {
      rel,
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
      ...(capability.executor !== undefined ? { executor: capability.executor } : {}),
    },
    actions: [],
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, rel) },
      ...applications.map((name) => ({
        rel: ['application'],
        href: entityHref(deps.baseHref, `meta/application:${name}`),
      })),
    ],
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
    ...projectCapability(snapshot, capability, deps),
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

function projectApplication(
  snapshot: EngineSnapshot,
  name: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  const application = snapshot.applications?.[name];
  if (application === undefined) return undefined;
  const rel = `meta/application:${name}`;
  const bundle = exportDefinitionBundle(snapshot, name);
  const presentation = projectCognitiveSemantics({ declaration: application.cognitive });
  return {
    class: ['meta', 'application-definition'],
    properties: {
      rel,
      ...application,
      status: 'active',
      version: bundle.bundle.version,
      bundle,
      ...(presentation === undefined ? {} : { presentation }),
    },
    actions: [],
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, rel) },
      { rel: ['collection'], href: entityHref(deps.baseHref, 'meta/applications') },
      ...bundle.flows.map((flow) => ({
        rel: ['flow'],
        href: entityHref(deps.baseHref, `meta/flow:${flow.name}`),
      })),
      ...bundle.capabilities.map((capability) => ({
        rel: ['capability'],
        href: entityHref(deps.baseHref, `${META_CAPABILITY_PREFIX}${capability.name}`),
      })),
    ],
    'guard-results': [],
  };
}

function projectApplications(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const names = Object.keys(snapshot.applications ?? {});
  return {
    class: ['collection', 'meta/applications'],
    properties: { rel: 'meta/applications', count: names.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'meta/applications') }],
    entities: names.map((name) => {
      const application = snapshot.applications![name]!;
      const bundle = exportDefinitionBundle(snapshot, name);
      return {
        class: ['meta', 'application-definition-summary'],
        properties: {
          name,
          title: application.title,
          intent: application.intent,
          status: 'active',
          version: bundle.bundle.version,
          flowCount: bundle.flows.length,
          capabilityCount: bundle.capabilities.length,
          policyCount: bundle.policies.length,
        },
        actions: [],
        links: [],
        'guard-results': [],
        rel: ['item'],
        href: entityHref(deps.baseHref, `meta/application:${name}`),
      };
    }),
    'guard-results': [],
  };
}

/**
 * meta 平面路由:self / flows / flow:<name> / activation:<id> / activations /
 * capabilities / capability:<name>(T13 Phase C)。
 * 未知 meta rel → undefined(HTTP 层映射 404)。
 */
export function projectMeta(
  snapshot: EngineSnapshot,
  rel: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  if (rel === 'meta/self') return projectSelf(snapshot, deps);
  if (rel === 'meta/flows') return projectFlows(snapshot, deps);
  if (rel === 'meta/activations') return projectActivations(snapshot, deps);
  if (rel === 'meta/capabilities') return projectCapabilities(snapshot, deps);
  if (rel === 'meta/applications') return projectApplications(snapshot, deps);
  if (rel.startsWith('meta/application:')) {
    return projectApplication(snapshot, rel.slice('meta/application:'.length), deps);
  }
  if (rel.startsWith('meta/flow:')) {
    return projectFlowDefinition(snapshot, rel.slice('meta/flow:'.length), deps);
  }
  if (rel.startsWith('meta/activation:')) {
    const activation = snapshot.activations?.[rel];
    return activation === undefined ? undefined : projectActivation(activation, snapshot, deps);
  }
  if (rel.startsWith(META_CAPABILITY_PREFIX)) {
    const capability = snapshot.capabilities?.[rel.slice(META_CAPABILITY_PREFIX.length)];
    return capability === undefined ? undefined : projectCapability(snapshot, capability, deps);
  }
  return undefined;
}
