/**
 * web→Temporal 委托派发(T5 Phase B / spec 架构决定 5):/api/chat mode=delegated
 * 的 dispatch 面。
 *
 * - dispatchDelegation:goal/driverKind/startRel/principal/baseUrl →
 *   client.workflow.start('delegationWorkflow', workflowId=delegation-<uuid>,
 *   taskQueue=ui4a);返回 delegationId(uuid 部分;事件日志 rel=delegation:<id> 的
 *   同一 id)——**委托 = workflow,事件历史 = 轨迹**(arch-brief §9.3);
 * - 与 notify 的关键差异:派发失败**向上抛**——委托没派出去必须据实告警
 *   (调用方 /api/chat 映射 503);notify 是 fire-and-forget 触达,语义不同;
 * - 失败不缓存连接:下次派发重连(Temporal 恢复后自愈);
 * - 读路径(/api/delegations)不经过这里:事件日志是唯一真相,Temporal client
 *   只用于 dispatch(单写者、可重放的读侧零 Temporal 依赖)。
 *
 * 参数类型镜像 apps/worker/src/workflows.ts 的 DelegationWorkflowArgs(跨 app
 * 不共享包;字段变更两处同改,由集成测试对齐)。
 */
import type { AgentGoal } from '@ui4a/agent';
import { Client, Connection } from '@temporalio/client';

/** worker 侧 taskQueue 会合点(与 apps/worker/src/main.ts 同一常量)。 */
const TASK_QUEUE = 'ui4a';

/** delegationWorkflow 的 driver 极小集(worker 侧 DelegationDriverKind 镜像)。 */
export type DelegationDriverKind = 'rule' | 'llm';

/** 派发参数(镜像 worker 的 DelegationWorkflowArgs;delegationId 由本层生成)。 */
export interface DelegationDispatchArgs {
  goal: AgentGoal;
  /** auto 已在上层解析(rule|llm;inline 的 resolveDriverKind 同口径)。 */
  driverKind: DelegationDriverKind;
  /** 引擎合同本源(activity 内 fetch /api/entity+/api/exec 的回环本源)。 */
  baseUrl: string;
  startRel?: string;
  principal?: string;
  maxSteps?: number;
}

/** Temporal dev server 地址(DECISIONS.md D4;env 可覆盖)。 */
function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
}

// 连接懒建单例(成功才缓存;失败清除,下次重试)——与 notify.ts 同模式
// (web 侧两个 Temporal capability 各持一条连接,互不耦合)。
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

/**
 * 派发一个委托 workflow,返回 delegationId(**即 workflowId,含 delegation- 前缀**:
 * worker 侧事件 rel=delegation:<workflowInfo().workflowId>,/api/delegations/<id>
 * 与该约定对齐——手工验证实测锚定,前缀不可剥)。
 */
export async function dispatchDelegation(
  args: DelegationDispatchArgs,
): Promise<{ delegationId: string }> {
  const delegationId = `delegation-${crypto.randomUUID()}`;
  const client = await temporalClient();
  await client.workflow.start('delegationWorkflow', {
    args: [args],
    taskQueue: TASK_QUEUE,
    workflowId: delegationId,
  });
  return { delegationId };
}

/** 测试专用:重置懒建连接缓存(防跨用例泄漏;生产代码不调用)。 */
export function resetTemporalDelegationClientForTests(): void {
  clientPromise = null;
}
