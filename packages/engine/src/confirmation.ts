/**
 * 确认门(T3 Phase A):guard 第三语义"挂起"的裁决与应用
 * (arch-brief §3:通过 / 拒绝 / 挂起;§9.1 确认门切片)。
 *
 * 分工:
 * - confirmGate 是纯策略函数(requires-confirmation 是**策略标注不是状态谓词**:
 *   谓词答"状态允许吗",标注答"这个 actor 是否需要委托人确认");
 *   内置规则 `high + actor=agent → 需确认`,human 直通;Phase B 的 Cedar 策略
 *   实现同一 ConfirmationPolicy 接口注入替换(策略即数据);
 * - suspendForConfirmation 把挂起物化为 `confirmation:<id>` pending 实体 +
 *   confirmation-requested 事件(含原请求全文),效果不应用;
 * - approveConfirmation / rejectConfirmation(本文件后半)是人类裁决入口:
 *   铁律 5"审批不委托"——approve/reject 的 guard 是 actor-is-human,
 *   agent 身份的审批在引擎层被拒绝(I4)且由调用方留痕。
 *
 * 全部纯函数:读快照、产出新快照与事件,不落日志、不触达 capability。
 */
import type { ConfirmationSnapshot, EngineSnapshot, GuardRegistry } from '@ui4a/shared';

import Ajv from 'ajv';

import { applyEffects, paramsToFields } from './effects';
import type { EngineEvent } from './effects';
import { evaluateGuards, type ExecRequest, type JudgeLayer } from './judge';
import { actionEffects } from './parse';
import { fieldDefinitionsToJsonSchema } from './schema';
import type { ActionDefinition, FlowDefinition } from './types';

// ---------------------------------------------------------------------------
// 确认裁决(策略层)
// ---------------------------------------------------------------------------

/** 确认裁决结论(required=false 即直通)。 */
export interface ConfirmationVerdict {
  required: boolean;
  /** 人类可读原因(入事件留痕:为什么挂起/为什么直通)。 */
  reason: string;
  /** 策略标识(内置 "builtin:*";Phase B Cedar 为 "cedar:*"),审计与测试锚点。 */
  policy: string;
}

/**
 * 确认策略函数:exec 三层裁决全过后、效果应用前求值。
 * Phase B 起 Cedar isAuthorized 求值实现此接口(决策与原因入事件 detail)。
 */
export type ConfirmationPolicy = (
  request: ExecRequest,
  action: ActionDefinition,
) => ConfirmationVerdict;

/**
 * 内置策略:`requires-confirmation === 'high' && actor === 'agent'` → 需确认;
 * human 直通;无标注直通;actor 缺省按 human(与 exec 日志口径一致)。
 */
export const builtinConfirmationPolicy: ConfirmationPolicy = (request, action) => {
  const level = action['requires-confirmation'];
  if (level === undefined) {
    return {
      required: false,
      reason: '动作未声明 requires-confirmation,直接执行',
      policy: 'builtin:none',
    };
  }
  if ((request.actor ?? 'human') === 'human') {
    return {
      required: false,
      reason: `actor=human 直通(requires-confirmation=${level})`,
      policy: 'builtin:human-pass',
    };
  }
  if (level === 'high') {
    return {
      required: true,
      reason: `requires-confirmation=high 且 actor=agent,需人类确认`,
      policy: 'builtin:high-agent',
    };
  }
  return {
    required: false,
    reason: `requires-confirmation=${level} 在内置策略下不触发确认(仅 high 挂起)`,
    policy: `builtin:${level}-agent-pass`,
  };
};

/** 确认裁决入口(缺省内置策略)。 */
export function confirmGate(
  request: ExecRequest,
  action: ActionDefinition,
  policy: ConfirmationPolicy = builtinConfirmationPolicy,
): ConfirmationVerdict {
  return policy(request, action);
}

// ---------------------------------------------------------------------------
// 挂起物化(pending 实体 + confirmation-requested 事件)
// ---------------------------------------------------------------------------

/** 确认 id 分配:确定性计数 c1/c2/…(时钟是 capability,不用时间戳;与 append 命名同构)。 */
export function nextConfirmationId(confirmations: Readonly<Record<string, unknown>>): string {
  let counter = Object.keys(confirmations).length + 1;
  while (confirmations[`confirmation:c${counter}`] !== undefined) {
    counter += 1;
  }
  return `c${counter}`;
}

/** confirmation-requested 事件的 detail 载荷(原请求全文 + 策略判定)。 */
export interface ConfirmationRequestDetail {
  id: string;
  targetRel: string;
  targetAction: string;
  policy: string;
  policyReason: string;
  /** 原请求全文(arch-brief §3:确认链路留痕提议者 actor/principal/信道)。 */
  request: ExecRequest;
}

/** exec 结果里的挂起摘要(任务合同:{id, targetRel, targetAction, params, proposedBy, channel, policyReason})。 */
export interface SuspendedConfirmation {
  id: string;
  targetRel: string;
  targetAction: string;
  /** 原请求参数(原始值视图)。 */
  params: Record<string, unknown>;
  proposedBy: { actor: 'human' | 'agent'; principal?: string };
  channel?: string;
  policyReason: string;
}

/** 挂起物化结果:新快照(pending 实体已入表)+ 待追加事件。 */
export interface SuspendOutcome {
  snapshot: EngineSnapshot;
  events: EngineEvent[];
  confirmation: SuspendedConfirmation;
}

/**
 * 把通过三层裁决、被确认门拦下的动作物化为 pending 确认实体:
 * 效果不应用,产出 confirmation-requested 事件(含原请求全文与策略原因)。
 */
export function suspendForConfirmation(
  request: ExecRequest,
  action: ActionDefinition,
  verdict: ConfirmationVerdict,
  snapshot: EngineSnapshot,
): SuspendOutcome {
  const table = snapshot.confirmations ?? {};
  const id = nextConfirmationId(table);
  const rel = `confirmation:${id}`;
  const actor = request.actor ?? 'human';
  const paramFields = paramsToFields(request);

  const detail: ConfirmationRequestDetail = {
    id,
    targetRel: request.rel,
    targetAction: request.action,
    policy: verdict.policy,
    policyReason: verdict.reason,
    request,
  };
  const event: EngineEvent = {
    kind: 'confirmation-requested',
    rel,
    action: request.action,
    actor,
    principal: request.principal,
    channel: request.channel,
    ...(Object.keys(paramFields).length > 0 ? { params: paramFields } : {}),
    detail,
  };
  const confirmation: ConfirmationSnapshot = {
    id,
    targetRel: request.rel,
    targetAction: request.action,
    ...(Object.keys(paramFields).length > 0 ? { params: paramFields } : {}),
    proposedBy: { actor, ...(request.principal !== undefined ? { principal: request.principal } : {}) },
    ...(request.channel !== undefined ? { channel: request.channel } : {}),
    status: 'pending',
    policy: verdict.policy,
    policyReason: verdict.reason,
  };

  return {
    snapshot: {
      instances: snapshot.instances,
      collections: snapshot.collections,
      confirmations: { ...table, [rel]: confirmation },
      // T4:definitions/activations 表随行(挂起不改定义平面状态)。
      definitions: { ...snapshot.definitions },
      activations: { ...(snapshot.activations ?? {}) },
      // T4 Phase B:definitionVersions 同口径随行(内容不改)。
      definitionVersions: { ...(snapshot.definitionVersions ?? {}) },
    },
    events: [event],
    confirmation: {
      id,
      targetRel: request.rel,
      targetAction: request.action,
      params: Object.fromEntries(
        Object.entries(paramFields).map(([name, entry]) => [name, entry.value]),
      ),
      proposedBy: { actor, ...(request.principal !== undefined ? { principal: request.principal } : {}) },
      ...(request.channel !== undefined ? { channel: request.channel } : {}),
      policyReason: verdict.reason,
    },
  };
}

// ---------------------------------------------------------------------------
// approve / reject(人类裁决入口;铁律 5:审批不委托)
// ---------------------------------------------------------------------------

/** 裁决者(approve/reject 的发起人;guard actor-is-human 确保 actor=human)。 */
export interface Approver {
  actor: 'human' | 'agent';
  principal?: string;
}

/** 确认实体上的 approve 动作声明(Siren 投影与 guard 求值共用)。 */
export const CONFIRMATION_APPROVE_ACTION: ActionDefinition = {
  name: 'approve',
  title: '批准',
  guards: ['actor-is-human'],
};

/** 确认实体上的 reject 动作声明(reason 必填且非空)。 */
export const CONFIRMATION_REJECT_ACTION: ActionDefinition = {
  name: 'reject',
  title: '驳回',
  guards: ['actor-is-human'],
  fields: [
    { name: 'reason', type: 'textarea', required: true, minLength: 1, semantics: 'intent' },
  ],
};

/** confirmation-approved / confirmation-rejected 事件的 detail 载荷。 */
export interface ConfirmationDecisionDetail {
  id: string;
  /** 挂起时的提议者原值(链:proposed-by → decided-by)。 */
  proposedBy: { actor: 'human' | 'agent'; principal?: string };
  /** 审批者/驳回者(approve 路径 actor 必为 human:审批不委托)。 */
  decidedBy: { actor: 'human' | 'agent'; principal?: string };
  /** reject:人类给出的原因(与事件 reason 同源)。 */
  reason?: string;
}

/** 裁决结果:confirmed(新快照+事件链)或 rejected(裁决层拒绝形态,留痕由调用方)。 */
export type ConfirmationDecision =
  | { kind: 'confirmed'; snapshot: EngineSnapshot; events: EngineEvent[] }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

export interface ConfirmationDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
  guards: GuardRegistry;
}

/** 确认 rel(id → confirmation:<id>)。 */
export function confirmationRel(id: string): string {
  return `confirmation:${id}`;
}

/** 定位确认实体(id → snapshot.confirmations)。 */
function locate(snapshot: EngineSnapshot, id: string): ConfirmationSnapshot | undefined {
  return snapshot.confirmations?.[confirmationRel(id)];
}

function reject(layer: JudgeLayer, reason: string, detail?: unknown): ConfirmationDecision {
  return detail === undefined
    ? { kind: 'rejected', layer, reason }
    : { kind: 'rejected', layer, reason, detail };
}

/**
 * 声明层等价检查:确认存在且 pending(approve/reject 只"声明"于 pending 状态;
 * 非 pending 的确认是审计实体,不可再审批)。ok=false 时携带裁决层拒绝。
 */
function adjudicateStatus(
  confirmation: ConfirmationSnapshot | undefined,
  id: string,
  actionName: string,
): { ok: true; confirmation: ConfirmationSnapshot } | { ok: false; decision: ConfirmationDecision } {
  if (confirmation === undefined) {
    return {
      ok: false,
      decision: reject('undeclared', `确认实体 "${confirmationRel(id)}" 不存在`),
    };
  }
  if (confirmation.status !== 'pending') {
    return {
      ok: false,
      decision: reject(
        'undeclared',
        `确认 "${id}" 状态为 ${confirmation.status},${actionName} 未声明于该状态(仅 pending 可审批)`,
      ),
    };
  }
  return { ok: true, confirmation };
}

/**
 * guard 层:求值动作声明的全部 guard(actor-is-human 等),任一 false 即拒。
 * 求值上下文以**目标实例**为 instance(确认不是流程实例;actor-is-human 只读 actor)。
 */
function guardCheck(
  action: ActionDefinition,
  confirmation: ConfirmationSnapshot,
  snapshot: EngineSnapshot,
  approver: Approver,
  guards: GuardRegistry,
): ConfirmationDecision | undefined {
  const target = snapshot.instances[confirmation.targetRel];
  if (target === undefined) {
    throw new Error(
      `确认 "${confirmation.id}" 的目标实体 "${confirmation.targetRel}" 不存在(日志与状态漂移)`,
    );
  }
  const evaluations = evaluateGuards(action, target, snapshot, {}, guards, approver.actor);
  const failed = evaluations.filter((evaluation) => !evaluation.pass);
  if (failed.length > 0) {
    const summary = failed.map((evaluation) => `${evaluation.name}=false`).join(', ');
    return reject('guard-failed', `guard 不满足: ${summary}`, evaluations);
  }
  return undefined;
}

function decidedByOf(approver: Approver): Approver {
  return {
    actor: approver.actor,
    ...(approver.principal !== undefined ? { principal: approver.principal } : {}),
  };
}

/**
 * human approve → 应用**原目标动作效果**(复用 applyEffects;挂起时的三层裁决
 * 已通过,此处不重新裁决——但目标动作须仍声明于当前节点,漂移则拒绝)。
 *
 * 事件链:confirmation-approved(链:proposed-by 原值 + approved-by 审批者)
 * → action-executed(委托语义:actor=human、principal=提议者的 principal、
 * channel='confirmation'——生效动作的信道是确认门;原请求信道保留在
 * confirmation-requested 事件里,审计链完整)。
 * confirmation 状态 → approved,实体保留供审计。
 */
export function approveConfirmation(
  snapshot: EngineSnapshot,
  confirmationId: string,
  approver: Approver,
  deps: ConfirmationDeps,
): ConfirmationDecision {
  const statusCheck = adjudicateStatus(locate(snapshot, confirmationId), confirmationId, 'approve');
  if (!statusCheck.ok) return statusCheck.decision;
  const confirmation = statusCheck.confirmation;

  const guardFailed = guardCheck(CONFIRMATION_APPROVE_ACTION, confirmation, snapshot, approver, deps.guards);
  if (guardFailed !== undefined) return guardFailed;

  // 定位目标动作(与 fold.applyExecuted 同口径:按实例当前节点查声明;
  // 目标实例存在性已由 guardCheck 抛错保证)。
  const target = snapshot.instances[confirmation.targetRel];
  if (target === undefined) {
    throw new Error(`确认 "${confirmationId}" 的目标实体不存在(日志与状态漂移)`);
  }
  const flow = deps.flows[target.flow];
  const node = flow?.nodes.find((candidate) => candidate.name === target.node);
  const action = node?.actions.find((candidate) => candidate.name === confirmation.targetAction);
  if (action === undefined) {
    return reject(
      'undeclared',
      `目标动作 "${confirmation.targetAction}" 未声明于节点 "${target.node}"(确认 ${confirmationId} 挂起后状态漂移)`,
    );
  }

  // 委托语义:guard 已确保审批者是 human;生效动作归属提议者的 principal。
  const request: ExecRequest = {
    rel: confirmation.targetRel,
    action: confirmation.targetAction,
    params: Object.fromEntries(
      Object.entries(confirmation.params ?? {}).map(([name, entry]) => [name, entry.value]),
    ),
    paramOrigins: Object.fromEntries(
      Object.entries(confirmation.params ?? {}).map(([name, entry]) => [name, entry.origin]),
    ),
    actor: 'human',
    principal: confirmation.proposedBy.principal,
    channel: 'confirmation',
  };
  const outcome = applyEffects(request, actionEffects(action), snapshot, {
    flows: deps.flows,
  });

  const approvedEvent: EngineEvent = {
    kind: 'confirmation-approved',
    rel: confirmationRel(confirmationId),
    action: 'approve',
    actor: approver.actor,
    principal: approver.principal,
    channel: 'confirmation',
    detail: {
      id: confirmationId,
      proposedBy: confirmation.proposedBy,
      decidedBy: decidedByOf(approver),
    },
  };
  const rel = confirmationRel(confirmationId);
  const confirmations = {
    ...(outcome.snapshot.confirmations ?? {}),
    [rel]: {
      ...confirmation,
      status: 'approved' as const,
      approvedBy: decidedByOf(approver),
    },
  };

  return {
    kind: 'confirmed',
    snapshot: { ...outcome.snapshot, confirmations },
    events: [approvedEvent, ...outcome.events],
  };
}

/**
 * human reject(带必填原因)→ 原动作**永不生效**,confirmation 状态 → rejected
 * (实体保留)。agent 身份被 guard 拒;reason 空/缺被 schema 拒(minLength=1)。
 */
export function rejectConfirmation(
  snapshot: EngineSnapshot,
  confirmationId: string,
  approver: Approver,
  reason: string,
  deps: ConfirmationDeps,
): ConfirmationDecision {
  const statusCheck = adjudicateStatus(locate(snapshot, confirmationId), confirmationId, 'reject');
  if (!statusCheck.ok) return statusCheck.decision;
  const confirmation = statusCheck.confirmation;

  const guardFailed = guardCheck(CONFIRMATION_REJECT_ACTION, confirmation, snapshot, approver, deps.guards);
  if (guardFailed !== undefined) return guardFailed;

  // schema 层:reason 必填且非空(与 judge 的字段校验同一口径)。
  const schema = fieldDefinitionsToJsonSchema(CONFIRMATION_REJECT_ACTION.fields ?? []);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate({ reason })) {
    return reject('schema-invalid', '参数不符合动作字段 schema', validate.errors);
  }

  const rejectedEvent: EngineEvent = {
    kind: 'confirmation-rejected',
    rel: confirmationRel(confirmationId),
    action: 'reject',
    actor: approver.actor,
    principal: approver.principal,
    channel: 'confirmation',
    reason,
    detail: {
      id: confirmationId,
      proposedBy: confirmation.proposedBy,
      decidedBy: decidedByOf(approver),
      reason,
    },
  };
  const rel = confirmationRel(confirmationId);
  const confirmations = {
    ...(snapshot.confirmations ?? {}),
    [rel]: { ...confirmation, status: 'rejected' as const, rejectedReason: reason },
  };

  return {
    kind: 'confirmed',
    snapshot: {
      instances: snapshot.instances,
      collections: snapshot.collections,
      confirmations,
      // T4:definitions/activations 表随行(驳回不改定义平面状态)。
      definitions: { ...snapshot.definitions },
      activations: { ...(snapshot.activations ?? {}) },
      // T4 Phase B:definitionVersions 同口径随行(内容不改)。
      definitionVersions: { ...(snapshot.definitionVersions ?? {}) },
    },
    events: [rejectedEvent],
  };
}
