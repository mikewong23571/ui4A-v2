/**
 * web→Temporal 接线(T3 Phase C / spec 架构决定 4):exec 挂起后的 notify 派发。
 *
 * - dispatchNotify:SuspendedConfirmation → client.workflow.start('notifyWorkflow',
 *   taskQueue=ui4a, workflowId=notify-<id>);**尽力而为**:连接/启动失败只记
 *   日志、绝不抛出——挂起的 202 响应不被 notify 阻塞(notify 是触达,不是裁决);
 *   already-started(workflowId 重复)视为幂等成功,同样不抛;
 * - 失败不缓存连接:下次派发重连(Temporal 恢复后自愈);
 * - 派发开关:vitest 下缺省关闭(单测不派发真实 workflow);UI4A_NOTIFY_DISPATCH
 *   = on/off 显式覆盖(集成测试/实机验证用 on)。
 *
 * 参数类型 NotifyWorkflowArgs 镜像于 apps/worker/src/workflows.ts 的
 * NotifyConfirmation(跨 app 不共享包;字段变更两处同改,由集成测试对齐)。
 */
import { Client, Connection } from '@temporalio/client';

import type { SuspendedConfirmation } from '@ui4a/engine';

/** worker 侧 taskQueue 会合点(与 apps/worker/src/main.ts 同一常量)。 */
const TASK_QUEUE = 'ui4a';

/** Temporal dev server 地址(DECISIONS.md D4;env 可覆盖)。 */
function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
}

/** notifyWorkflow 参数(镜像 worker 的 NotifyConfirmation)。 */
export interface NotifyWorkflowArgs {
  id: string;
  targetRel: string;
  targetAction: string;
  proposedBy: { actor: 'human' | 'agent'; principal?: string };
  reason?: string;
}

/** SuspendedConfirmation → workflow 参数(最小载荷:丢弃 params/channel,reason=policyReason)。 */
export function notifyWorkflowArgs(confirmation: SuspendedConfirmation): NotifyWorkflowArgs {
  return {
    id: confirmation.id,
    targetRel: confirmation.targetRel,
    targetAction: confirmation.targetAction,
    proposedBy: confirmation.proposedBy,
    ...(confirmation.policyReason !== undefined ? { reason: confirmation.policyReason } : {}),
  };
}

/** 派发开关(调用时读取:测试可 vi.stubEnv 切换)。 */
export function notifyDispatchEnabled(): boolean {
  const flag = process.env.UI4A_NOTIFY_DISPATCH;
  if (flag === 'off') return false;
  if (flag === 'on') return true;
  return !process.env.VITEST;
}

// 连接懒建单例(成功才缓存;失败清除,下次重试)。
let clientPromise: Promise<Client> | null = null;

function temporalClient(): Promise<Client> {
  if (clientPromise === null) {
    clientPromise = Connection.connect({ address: temporalAddress() }).then(
      (connection) => new Client({ connection }),
    );
    clientPromise.catch(() => {
      clientPromise = null; // 失败不缓存:下次派发重连
    });
  }
  return clientPromise;
}

/** 尽力而为派发:任何失败只记日志(不抛;调用方 fire-and-forget)。 */
export async function dispatchNotify(confirmation: SuspendedConfirmation): Promise<void> {
  if (!notifyDispatchEnabled()) return;
  try {
    const client = await temporalClient();
    await client.workflow.start('notifyWorkflow', {
      args: [notifyWorkflowArgs(confirmation)],
      taskQueue: TASK_QUEUE,
      workflowId: `notify-${confirmation.id}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ui4a] notify 派发失败(尽力而为,挂起不受影响;workflowId=notify-${confirmation.id}): ${message}`,
    );
  }
}

/** 测试专用:重置懒建连接缓存(防跨用例泄漏;生产代码不调用)。 */
export function resetTemporalClientForTests(): void {
  clientPromise = null;
}

/**
 * 终止历史 notify workflow(e2e/运维卫生动作):workflowId=notify-<id> 的**在跑或
 * 已成功完成**实例会让同 id 的下一次 start 报 already-started/already-completed
 * (缺省复用策略 AllowDuplicateFailedOnly——terminated 视为可重用);确认 id 由
 * 引擎确定性分配(c1/c2/…),跨测试轮次的残留实例须先终止。不存在/不可达按
 * 尽力而为吞掉——清理不是裁决。
 */
export async function terminateStaleNotifyWorkflows(ids: readonly string[]): Promise<void> {
  let client: Client;
  try {
    client = await temporalClient();
  } catch {
    return; // Temporal 不可达:无可清理(调用方已探活,此处兜底)。
  }
  for (const id of ids) {
    await client.workflow
      .getHandle(`notify-${id}`)
      .terminate('stale cleanup')
      .catch(() => undefined);
  }
}
