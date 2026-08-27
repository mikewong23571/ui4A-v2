/**
 * Siren 业务平面投影:实例/集合/确认/inbox/委托/渲染 spec(arch-brief §2 四件组装)。
 * 纯函数;rel → Siren 实体,未知 rel 返回 undefined(HTTP 层映射 404)。
 */
import type {
  ConfirmationSnapshot,
  DelegationSnapshot,
  EngineSnapshot,
  FrozenRenderSpec,
} from '@ui4a/shared';
import { fieldValues } from '@ui4a/shared';

import {
  CONFIRMATION_APPROVE_ACTION,
  CONFIRMATION_REJECT_ACTION,
  confirmationRel,
} from '../../execution/confirmation';
import { DELEGATIONS_REL, delegationRel } from '../../delegation/delegation';
import { flowForInstance } from '../../execution/judge';
import {
  RENDER_SPECS_REL,
  RENDER_SPEC_REL_PREFIX,
  readRenderSpecsOf,
  renderSpecRel,
} from '../../projection/render-spec';
import { mergeFieldDefinitions } from '../schema';
import {
  THREADS_REL,
  THREAD_REL_PREFIX,
  projectWorkThread,
  projectWorkThreads,
} from '../../projection/work-thread';
import { entityHref, fallbackPresentationRole, guardResultsFor, toSirenAction } from './build';
import { projectMeta } from './project-meta';
import type { ProjectDeps, SirenEntity, SirenFieldPresentation, SirenLink } from './types';

function collectionIdentity(title: string): Record<string, unknown> {
  return {
    title,
    presentation: {
      fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
    },
  };
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
  const actions = (node?.actions ?? []).filter((action) => action.internal === undefined);
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
      rel: confirmationRel(confirmation.id),
      'target-rel': confirmation.targetRel,
      'target-action': confirmation.targetAction,
      params: fieldValues(confirmation.params ?? {}),
      // 决策卡身份行(T33):任务语言身份由投影携带;已决策确认不进收件箱,
      // 不需要身份行(保持 decided 形状稳定)。
      ...(pending
        ? { identity: `${confirmation.targetAction} · 由 ${confirmation.proposedBy.actor} 提议` }
        : {}),
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
    properties: {
      rel: 'inbox',
      ...collectionIdentity('在等我'),
      count: pending.length,
      delivered,
    },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'inbox'), title: '在等我' }],
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
      // T33"在动"进度行:机械计数派生(successes/steps + 状态),投影数据。
      resume: `${delegation.successes}/${delegation.steps} · ${delegation.status}`,
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
    properties: {
      rel: DELEGATIONS_REL,
      ...collectionIdentity('在动'),
      count: entries.length,
    },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, DELEGATIONS_REL), title: '在动' }],
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
 * 解析顺序:capability 工件(artifact:<name>)→ meta 前缀(定义层显式意图,
 * 优先于实例表——lifecycle 实例与定义实体同 rel,投影必须是定义视图)→
 * 工作线集合与工作线实体(thread:/threads,T26)→ 实例 → 业务集合 → 确认实体
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
  if (rel === THREADS_REL) return projectWorkThreads(snapshot, deps);
  if (rel.startsWith(THREAD_REL_PREFIX)) {
    const thread = snapshot.threads?.[rel.slice(THREAD_REL_PREFIX.length)];
    return thread === undefined ? undefined : projectWorkThread(thread, snapshot, deps);
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
