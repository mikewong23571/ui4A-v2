/**
 * worker workflows(T3 notify / T5 delegation)。
 *
 * notifyWorkflow(T3 Phase C / spec 架构决定 4):确认挂起后的通知编排。
 * arch-brief §9.1:notify 是第一个 capability——Temporal activity 承载,
 * 重试/超时由平台免费提供(此处声明 startToCloseTimeout 与重试上限)。
 * 单 activity 编排:worker 落 notification-delivered 事件到同一 PG 事件日志
 * (通知也是提议,走同一日志,spec 决定 4 双写者方案)。
 *
 * delegationWorkflow(T5 Phase A / spec 架构决定 1):**委托 = workflow,
 * 事件历史 = 轨迹,崩溃续跑 = 平台特性**(arch-brief §9.3/§4)。
 * 重放确定性铁律:workflow 不做任何 IO/随机/时间——决策(含 LLM 网络)与
 * 执行全部在 agentStep activity 内;workflow 只持有纯数据循环状态
 * (currentRel/trail/successes/lastRejection),每步从 activity 结果经
 * applyStepToState(纯函数)推导,语义与 @ui4a/agent 的 runAgent 逐条对齐。
 * 事件写入经 activity(worker 直连 PG,与 notify 同一双写者方案):
 * 首步前 delegation-started;每步 delegation-step;
 * 终态 delegation-completed | failed | max-steps。
 *
 * 注意:workflow 模块由 Temporal 独立打包,不得引入 Node API 与
 * @ui4a/agent 运行时代码(仅 import type);activities 只经 proxyActivities
 * 的接口引用(import type)。
 */
import {
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';

import type {
  AgentGoal,
  AgentOperation,
  EntitySummary,
  ExecSuccess,
  RejectionRecord,
  TrailStep,
} from '@ui4a/agent';
import type { NativeFunctionOutcomeV1, NativeFunctionWorkflowInputV1 } from '@ui4a/shared';

import type {
  DelegationActivities,
  NativeFunctionActivities,
  NotifyActivities,
} from './activities';
import type {
  AgentExecutionNeedsInput,
  AgentExecutionWaitingApproval,
  AgentQuestionAnswerSignal,
  AgentResourceDecisionSignal,
  AgentResumeResolution,
  AgentRunActivities,
  AgentRunWorkflowArgs,
  AgentRunWorkflowResult,
} from './agents/host/contracts';
import {
  matchQuestionAnswer,
  matchResourceDecision,
  resolutionIdempotencyKey,
  suspensionIdempotencyKey,
  type AgentQuestionAnswerInbox,
  type AgentResourceDecisionInbox,
} from './agents/host/protocol';
import { agentRunFinalizeIdempotencyKey } from './agents/host/finalize';

/** 确认摘要(workflow 参数;镜像于 apps/web/src/temporal/notify.ts 的 NotifyWorkflowArgs)。 */
export interface NotifyConfirmation {
  id: string;
  targetRel: string;
  targetAction: string;
  proposedBy: { actor: 'human' | 'agent'; principal?: string };
  reason?: string;
}

const { notify } = proxyActivities<NotifyActivities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3 },
});

/** 送达一条确认通知:单 activity,幂等;同名 workflowId 重跑安全。 */
export async function notifyWorkflow(confirmation: NotifyConfirmation): Promise<void> {
  await notify(confirmation);
}

// ---------------------------------------------------------------------------
// nativeFunctionWorkflow(T43:Capability Port local Adapter)
// ---------------------------------------------------------------------------

function functionFailure(
  input: NativeFunctionWorkflowInputV1,
  error: unknown,
): NativeFunctionOutcomeV1 {
  return {
    schemaVersion: 1,
    status: 'failed',
    failure: {
      code: 'execution-failed',
      reason: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
    attempt: input.profile.limits.maximumAttempts,
  };
}

/** Durable single-Activity Function execution with a non-cancellable governed finalize. */
export async function nativeFunctionWorkflow(
  input: NativeFunctionWorkflowInputV1,
): Promise<NativeFunctionOutcomeV1> {
  const execute = proxyActivities<Pick<NativeFunctionActivities, 'executeNativeFunctionActivity'>>({
    startToCloseTimeout: `${input.profile.limits.startToCloseTimeoutMs}ms`,
    retry: { maximumAttempts: input.profile.limits.maximumAttempts },
  });
  const finalize = proxyActivities<
    Pick<NativeFunctionActivities, 'finalizeNativeFunctionActivity'>
  >({
    startToCloseTimeout: '30 seconds',
    retry: { maximumAttempts: 5 },
  });
  try {
    let outcome: NativeFunctionOutcomeV1;
    try {
      outcome = await execute.executeNativeFunctionActivity(input);
    } catch (error) {
      if (isCancellation(error)) throw error;
      outcome = functionFailure(input, error);
    }
    await finalize.finalizeNativeFunctionActivity({ context: input, outcome });
    return outcome;
  } catch (error) {
    if (!isCancellation(error)) throw error;
    const outcome: NativeFunctionOutcomeV1 = {
      schemaVersion: 1,
      status: 'cancelled',
      reason: error instanceof Error ? error.message : String(error),
      attempt: 1,
    };
    await CancellationScope.nonCancellable(() =>
      finalize.finalizeNativeFunctionActivity({ context: input, outcome }),
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// agentRunWorkflow(T19:generic Host)
// ---------------------------------------------------------------------------

export type {
  AgentQuestionAnswerSignal,
  AgentResourceDecisionSignal,
  AgentRunActivities,
  AgentRunWorkflowArgs,
  AgentRunWorkflowResult,
};

/** Answer the currently pending question. The resolution is persisted by an activity before resume. */
export const answerAgentQuestionSignal =
  defineSignal<[AgentQuestionAnswerSignal]>('answerAgentQuestion');

/** Decide one requested per-Run resource grant. This does not approve the terminal result. */
export const decideAgentResourceGrantSignal = defineSignal<[AgentResourceDecisionSignal]>(
  'decideAgentResourceGrant',
);

const agentPrepare = proxyActivities<Pick<AgentRunActivities, 'prepareAgentRun'>>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});
const agentExecute = proxyActivities<Pick<AgentRunActivities, 'executeAgentRun'>>({
  startToCloseTimeout: '1 hour',
  heartbeatTimeout: '15 seconds',
  retry: { maximumAttempts: 3 },
});
const agentCollectVerify = proxyActivities<
  Pick<AgentRunActivities, 'collectAgentRun' | 'verifyAgentRun'>
>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});
const agentSuspend = proxyActivities<
  Pick<AgentRunActivities, 'recordAgentRunSuspension' | 'recordAgentRunResolution'>
>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5 },
});
const agentFinalize = proxyActivities<Pick<AgentRunActivities, 'finalizeAgentRun'>>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5 },
});

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function awaitQuestionAnswer(
  context: AgentRunWorkflowArgs,
  suspension: AgentExecutionNeedsInput,
  answers: AgentQuestionAnswerInbox,
): Promise<AgentResumeResolution> {
  await condition(() => matchQuestionAnswer(suspension, answers) !== undefined);
  const resolution = matchQuestionAnswer(suspension, answers);
  if (resolution === undefined)
    throw new Error('question answer disappeared from Workflow history');
  await agentSuspend.recordAgentRunResolution({
    context,
    suspension,
    resolution,
    idempotencyKey: resolutionIdempotencyKey(context.runId, suspension),
  });
  return resolution;
}

async function awaitResourceDecision(
  context: AgentRunWorkflowArgs,
  suspension: AgentExecutionWaitingApproval,
  decisions: AgentResourceDecisionInbox,
): Promise<AgentResumeResolution> {
  await condition(() => matchResourceDecision(suspension, decisions) !== undefined);
  const resolution = matchResourceDecision(suspension, decisions);
  if (resolution === undefined)
    throw new Error('resource decision disappeared from Workflow history');
  await agentSuspend.recordAgentRunResolution({
    context,
    suspension,
    resolution,
    idempotencyKey: resolutionIdempotencyKey(context.runId, suspension),
  });
  return resolution;
}

async function runAgentHost(args: AgentRunWorkflowArgs): Promise<AgentRunWorkflowResult> {
  if (!Number.isInteger(args.limits.maxSuspensions) || args.limits.maxSuspensions < 0) {
    return {
      status: 'failed',
      code: 'invalid-host-limits',
      reason: 'maxSuspensions must be a non-negative integer',
    };
  }

  const answers: Record<string, AgentQuestionAnswerSignal> = {};
  const decisions: Record<string, AgentResourceDecisionSignal> = {};
  setHandler(answerAgentQuestionSignal, (answer) => {
    answers[answer.questionId] ??= answer;
  });
  setHandler(decideAgentResourceGrantSignal, (decision) => {
    decisions[decision.requestId] ??= decision;
  });

  let phase = 'prepare';
  try {
    const prepared = await agentPrepare.prepareAgentRun(args);
    let resolution: AgentResumeResolution | undefined;
    let suspensions = 0;

    while (true) {
      phase = 'execute';
      const execution = await agentExecute.executeAgentRun({
        context: args,
        prepared,
        ...(resolution === undefined ? {} : { resolution }),
      });
      resolution = undefined;

      if (execution.status === 'failed' || execution.status === 'cancelled') return execution;
      if (execution.status === 'completed') {
        phase = 'collect';
        const collected = await agentCollectVerify.collectAgentRun({
          context: args,
          prepared,
          execution,
        });
        phase = 'verify';
        return agentCollectVerify.verifyAgentRun({ context: args, collected });
      }

      suspensions += 1;
      if (suspensions > args.limits.maxSuspensions) {
        return {
          status: 'failed',
          code: 'suspension-limit-exceeded',
          reason: `agent run exceeded ${args.limits.maxSuspensions} suspensions`,
        };
      }
      phase = 'suspend';
      await agentSuspend.recordAgentRunSuspension({
        context: args,
        suspension: execution,
        idempotencyKey: suspensionIdempotencyKey(args.runId, execution),
      });
      resolution =
        execution.status === 'needs-input'
          ? await awaitQuestionAnswer(args, execution, answers)
          : await awaitResourceDecision(args, execution, decisions);
    }
  } catch (error) {
    if (isCancellation(error)) throw error;
    return { status: 'failed', code: `${phase}-failed`, reason: failureReason(error) };
  }
}

/**
 * Generic durable Agent Host.
 *
 * All activities receive the same birth-pinned context. Questions and grant requests suspend in
 * Workflow history, but their pending/resolution events are persisted through idempotent activities.
 * A cancellation receives a non-cancellable terminal callback before the Workflow remains CANCELLED.
 */
export async function agentRunWorkflow(
  args: AgentRunWorkflowArgs,
): Promise<AgentRunWorkflowResult> {
  try {
    const outcome = await runAgentHost(args);
    await agentFinalize.finalizeAgentRun({
      context: args,
      outcome,
      idempotencyKey: agentRunFinalizeIdempotencyKey(args.runId),
    });
    return outcome;
  } catch (error) {
    if (!isCancellation(error)) throw error;
    await CancellationScope.nonCancellable(() =>
      agentFinalize.finalizeAgentRun({
        context: args,
        outcome: { status: 'cancelled', reason: failureReason(error) },
        idempotencyKey: agentRunFinalizeIdempotencyKey(args.runId),
      }),
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// delegationWorkflow(T5 Phase A:委托实体 = workflow)
// ---------------------------------------------------------------------------

/** 产品委托只运行真实 LLM；scripted/mock driver 仅能经 activity 测试依赖注入。 */
export type DelegationDriverKind = 'llm';

/** delegationWorkflow 参数(起点集合/合同本源/步数上限;goal 即 @ui4a/agent 的 AgentGoal)。 */
export interface DelegationWorkflowArgs {
  goal: AgentGoal;
  driverKind: DelegationDriverKind;
  /** 引擎合同本源,如 http://localhost:3100(activity 内 fetch /api/entity+/api/exec)。 */
  baseUrl: string;
  /** 派发方 Situation 的应用注意力；缺省表示未定位。 */
  scope?: string;
  /** 出生时固定的工作线引用；每个新步骤重新读取授权合同。 */
  contextRel?: string;
  /** 起始实体 rel，缺省为应用发现目录。 */
  startRel?: string;
  principal?: string;
  /** 步数上限(缺省 24,与 runAgent 同口径)。 */
  maxSteps?: number;
}

/** 委托终态(与终事件 delegation-completed|failed|max-steps 一一对应)。 */
export type DelegationOutcome = 'completed' | 'failed' | 'max-steps';

/** delegationWorkflow 返回(舰队长轮询的最小摘要;轨迹在事件日志)。 */
export interface DelegationRunResult {
  delegationId: string;
  outcome: DelegationOutcome;
  steps: number;
  successes: number;
  summary?: string;
  reason?: string;
}

/** delegation-started activity 参数。 */
export interface DelegationStartArgs {
  delegationId: string;
  goal: AgentGoal;
  driverKind: DelegationDriverKind;
  model?: string;
  startRel: string;
  contextRel?: string;
  principal?: string;
}

/** delegation-completed|failed|max-steps activity 参数。 */
export interface DelegationFinishArgs {
  delegationId: string;
  outcome: DelegationOutcome;
  steps: number;
  successes: number;
  principal?: string;
  summary?: string;
  reason?: string;
}

/** workflow 侧循环状态(纯数据,workflow 本地变量持有;每步经 applyStepToState 推导)。 */
export interface DelegationLoopState {
  currentRel: string;
  trail: TrailStep[];
  successes: ExecSuccess[];
  lastRejection?: RejectionRecord;
}

/** agentStep activity 参数(状态全量传入:driver 决策的完整上下文原料)。 */
export interface AgentStepArgs {
  delegationId: string;
  step: number;
  goal: AgentGoal;
  driverKind: DelegationDriverKind;
  baseUrl: string;
  scope?: string;
  contextRel?: string;
  principal?: string;
  currentRel: string;
  trail: TrailStep[];
  successes: ExecSuccess[];
  lastRejection?: RejectionRecord;
}

/** agentStep activity 结果(与 delegation-step 事件 detail 同构——幂等恢复载荷)。 */
export interface AgentStepResult {
  op: AgentOperation;
  outcome: TrailStep['outcome'];
  entitySummary?: EntitySummary;
  rejection?: RejectionRecord;
  /**
   * 推理自述(T11 / spec 架构决定 3;审计留痕,非循环状态——applyStepToState
   * 不消费):llm driver 决策时经 DecideSink 回调捕获(Phase C streamText 改造
   * 起填真值);scripted/mock 路径与端点不返回时不产生(落库恒 null)。幂等恢复载荷与
   * detail 同构:旧事件无此字段,恢复结果同样不带。
   */
  reasoning?: string | null;
  /**
   * 当前实体不可得的 fail 出口(runAgent 同口径:不产轨迹步、不落步事件)——
   * workflow 收到后不推导状态,直接落 delegation-failed 终态。
   */
  unrecorded?: true;
}

/**
 * 步结果 → 新循环状态(纯函数;runAgent 循环体的状态迁移部分,逐条对齐):
 * - navigate 成功:currentRel 切换,轨迹记目标 rel;
 * - exec 成功:successes 追加(完成类动作判定的原料);
 * - 拒绝(navigate 404 / exec 4xx):lastRejection 回流——单步消费,
 *   下一步推导时被本步结果覆盖(拒绝只影响紧接着的下一步);
 * - done/fail:轨迹记终步(终态事件由 workflow 随后落)。
 */
export function applyStepToState(
  state: DelegationLoopState,
  step: number,
  result: AgentStepResult,
): DelegationLoopState {
  // 实体不可得的 fail 出口(runAgent 同口径:不产轨迹步)——状态原样返回,
  // 使 trail 步数与 delegation-step 事件计数始终一致(终态计数交叉核对的前提)。
  if (result.unrecorded === true) {
    return state;
  }
  const rel = result.op.kind === 'navigate' ? result.op.rel : state.currentRel;
  const trailStep: TrailStep = {
    step,
    rel,
    op: result.op,
    outcome: result.outcome,
    ...(result.entitySummary !== undefined ? { entity: result.entitySummary } : {}),
    ...(result.rejection !== undefined ? { rejection: result.rejection } : {}),
  };
  return {
    currentRel:
      result.op.kind === 'navigate' && result.outcome === 'navigated'
        ? result.op.rel
        : state.currentRel,
    trail: [...state.trail, trailStep],
    successes:
      result.op.kind === 'exec' && result.outcome === 'executed'
        ? [
            ...state.successes,
            { rel: state.currentRel, action: result.op.action, params: result.op.params },
          ]
        : result.op.kind === 'exec-plan' && result.outcome === 'executed'
          ? [
              ...state.successes,
              ...result.op.steps.map(({ rel, action, params }) => ({ rel, action, params })),
            ]
          : state.successes,
    lastRejection: result.rejection,
  };
}

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_START_REL = 'applications';

const { startDelegation, agentStep, finishDelegation } = proxyActivities<DelegationActivities>({
  // agentStep 兼容 LLM 决策(网络可达数十秒);被杀后续跑延迟 ≤ 此超时
  //(StartToClose 从任务投递起算,worker 死后到期即重试)。
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 10 },
});

/**
 * 委托执行 workflow:agent 循环的 durable 宿主。
 * 循环骨架与 runAgent 同构(startRel 起步 → 每步决策+执行 → done/fail/maxSteps 终止);
 * 决策与执行在 agentStep activity(确定性),事件经 activity 入同一 PG 日志,
 * 崩溃续跑由 Temporal durable execution 承担(S3-续跑的平台形态)。
 */
export async function delegationWorkflow(
  args: DelegationWorkflowArgs,
): Promise<DelegationRunResult> {
  const delegationId = workflowInfo().workflowId;
  const maxSteps = args.maxSteps ?? DEFAULT_MAX_STEPS;
  const startRel = args.startRel ?? DEFAULT_START_REL;

  // 首事件(rel=delegation:<workflowId>;幂等,重放安全)。
  await startDelegation({
    delegationId,
    goal: args.goal,
    driverKind: 'llm',
    startRel,
    contextRel: args.contextRel,
    principal: args.principal,
  });
  let state: DelegationLoopState = { currentRel: startRel, trail: [], successes: [] };
  for (let step = 1; step <= maxSteps; step += 1) {
    const result = await agentStep({
      delegationId,
      step,
      goal: args.goal,
      driverKind: 'llm',
      baseUrl: args.baseUrl,
      scope: args.scope,
      contextRel: args.contextRel,
      principal: args.principal,
      currentRel: state.currentRel,
      trail: state.trail,
      successes: state.successes,
      lastRejection: state.lastRejection,
    });
    // unrecorded(实体不可得)经 applyStepToState 原样返回——无轨迹步,
    // 下面的 fail 分支以当前计数落 delegation-failed(与 runAgent 语义一致)。
    state = applyStepToState(state, step, result);
    const steps = state.trail.length;
    const successes = state.successes.length;

    if (result.op.kind === 'answer') {
      const summary = result.op.content;
      await finishDelegation({
        delegationId,
        outcome: 'completed',
        steps,
        successes,
        principal: args.principal,
        summary,
      });
      return { delegationId, outcome: 'completed', steps, successes, summary };
    }
    if (result.op.kind === 'clarify') {
      const summary = result.op.question;
      await finishDelegation({
        delegationId,
        outcome: 'completed',
        steps,
        successes,
        principal: args.principal,
        summary,
      });
      return { delegationId, outcome: 'completed', steps, successes, summary };
    }
    if (result.op.kind === 'done') {
      const summary = result.op.summary;
      await finishDelegation({
        delegationId,
        outcome: 'completed',
        steps,
        successes,
        principal: args.principal,
        summary,
      });
      return { delegationId, outcome: 'completed', steps, successes, summary };
    }
    if (result.op.kind === 'fail') {
      const reason = result.op.reason;
      await finishDelegation({
        delegationId,
        outcome: 'failed',
        steps,
        successes,
        principal: args.principal,
        reason,
      });
      return { delegationId, outcome: 'failed', steps, successes, reason };
    }
    if (result.outcome === 'suspended') {
      const summary = '动作已挂起，等待人类在收件箱确认';
      await finishDelegation({
        delegationId,
        outcome: 'completed',
        steps,
        successes,
        principal: args.principal,
        summary,
      });
      return { delegationId, outcome: 'completed', steps, successes, summary };
    }
  }

  const steps = state.trail.length;
  const successes = state.successes.length;
  const reason = `达到步数上限 ${maxSteps} 未收到 done/fail`;
  await finishDelegation({
    delegationId,
    outcome: 'max-steps',
    steps,
    successes,
    principal: args.principal,
    reason,
  });
  return { delegationId, outcome: 'max-steps', steps, successes, reason };
}
