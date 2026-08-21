/**
 * notifyWorkflow(T3 Phase C / spec 架构决定 4):确认挂起后的通知编排。
 *
 * arch-brief §9.1:notify 是第一个 capability——Temporal activity 承载,
 * 重试/超时由平台免费提供(此处声明 startToCloseTimeout 与重试上限)。
 * 单 activity 编排:worker 落 notification-delivered 事件到同一 PG 事件日志
 * (通知也是提议,走同一日志,spec 决定 4 双写者方案)。
 *
 * 重放确定性(arch-brief §4):workflow 不做任何依赖时间的分支——
 * 无 sleep/timer/信号,只是一次 activity 调用;activity 幂等
 * (notification-delivered 按 rel 去重),重试与重跑均不双写。
 *
 * 注意:workflow 模块由 Temporal 独立打包,不得引入 Node API;
 * activities 只经 proxyActivities 的接口引用(import type)。
 */
import { proxyActivities } from '@temporalio/workflow';

import type { NotifyActivities } from './activities';

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
