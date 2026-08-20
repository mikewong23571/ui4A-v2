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
import type { ConfirmationSnapshot, EngineSnapshot } from '@ui4a/shared';

import { paramsToFields } from './effects';
import type { EngineEvent } from './effects';
import type { ExecRequest } from './judge';
import type { ActionDefinition } from './types';

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
