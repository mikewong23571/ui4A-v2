/**
 * exec/execPlan 编排管线(T55/D76 自 service.ts bootEngine 闭包迁出,行为逐字):
 * service.ts 只留装配(boot/依赖闭包/串行队列)+ 入口壳,本模块持有编排段——
 * 别名解析 → 三面路由(confirmation 人类裁决 / thread / meta vs 业务 gates)→
 * 拒绝留痕 → 挂起物化 → coding-result 预检 → spawn 准备 → 落库 → T52 选择性
 * refold → 派发 → 回执投影。单原子队列保持声明:本模块在队列回调内被调用,
 * 不自建队列、不重入 enqueue(D34「裁决器即并发控制」)。
 */
import {
  actionRejectedEvent,
  executeMeta,
  executePlan,
  executeWithGates,
  project,
  THREADS_REL,
  THREAD_REL_PREFIX,
  type ConfirmationDeps,
  type EngineEvent,
  type ExecRequest,
  type ExecuteDeps,
  type MetaDeps,
  type ProjectDeps,
  type SuspendedConfirmation,
} from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import type { DbExecutor } from '@ui4a/db/events';
import { resolveFlowRelAlias } from '../flow-entry';
import { materializeSpawnArtifacts } from '../service-artifacts';
import {
  execConfirmationDecision,
  materializeSuspension,
  persistRejection,
} from '../service-confirmation';
import { resolveCodingResultDecision } from './service-coding-result';
import {
  appendBatchWithSeq,
  applyForeignGaps,
  refoldApplicationDeprecations,
  refreshFromLog,
  type CoreEventLogState,
} from '../service-event-log';
import type { engineEventToAppend } from '../service-event-append';
import type { ExecOutcome, PlanServiceOutcome } from '../service-outcome';
import { CONFIRMATION_REL_PREFIX, isMetaRel, paramsWithOrigins } from '../service-request';
import { dispatchSpawnPlan, prepareSpawnPlan } from './service-spawn';
import { execThreadAction } from '../service-thread';
import { runWebProductionDeploymentPreflight } from '../../production-deployment-preflight';

export interface ExecCoreDeps {
  db: DbExecutor;
  logState: CoreEventLogState;
  toAppend: typeof engineEventToAppend;
  gateDeps: () => ExecuteDeps;
  confirmDeps: () => ConfirmationDeps;
  projectDeps: () => ProjectDeps;
  metaDeps: () => MetaDeps;
  dispatchNotify: (confirmation: SuspendedConfirmation) => void;
  scheduleRecipes: (snapshot: EngineSnapshot) => void;
}

export async function execCore(
  deps: ExecCoreDeps,
  request: ExecRequest,
): Promise<ExecOutcome> {
  const { db, logState, toAppend } = deps;
  // 先同步外部写者进度再裁决(裁决器只见全序日志的最新折叠态);
  // 已在串行队列内,直接调用(不重入 enqueue)。
  await refreshFromLog(db, logState, deps.scheduleRecipes);

  // exec 同样吃 flow 别名:裁决与日志都记实例 rel(不产生幽灵实体)。
  const aliased: ExecRequest = {
    ...request,
    rel: resolveFlowRelAlias(request.rel, logState.snapshot) ?? request.rel,
  };

  // 确认实体上的动作走人类裁决入口(approve/reject;铁律 5:审批不委托)。
  if (aliased.rel.startsWith(CONFIRMATION_REL_PREFIX)) {
    return execConfirmationDecision(
      db,
      logState,
      { toAppend, confirmDeps: deps.confirmDeps, projectDeps: deps.projectDeps },
      aliased,
    );
  }

  if (aliased.rel === THREADS_REL || aliased.rel.startsWith(THREAD_REL_PREFIX)) {
    return execThreadAction(db, logState, { toAppend, projectDeps: deps.projectDeps }, aliased);
  }

  // meta 平面(rel 前缀路由,T4 Phase B):编辑动词/生命周期动词过同一
  // executeMeta 编排——同一裁决器(lifecycle 常量自举)、同一日志、同一
  // 串行队列;后续事件落库/投影与业务 exec 共用同一套代码路径。
  const outcome = isMetaRel(aliased.rel)
    ? executeMeta(aliased, logState.snapshot, deps.metaDeps())
    : executeWithGates(aliased, logState.snapshot, deps.gateDeps());

  if (outcome.kind === 'rejected') {
    // 拒绝即数据(I6):不改状态,结构化原因入日志;detail 携带 layer,
    // HTTP 响应与本事件同源(同一 verdict 对象),口径必然一致。
    return persistRejection(db, logState, toAppend, aliased, outcome);
  }

  if (outcome.kind === 'suspended') {
    return materializeSuspension({
      db,
      logState,
      toAppend,
      projectDeps: deps.projectDeps,
      outcome,
      dispatchNotify: deps.dispatchNotify,
    });
  }

  const decision = await resolveCodingResultDecision({
    db,
    logState,
    toAppend,
    aliased,
    events: outcome.events,
  });
  if ('kind' in decision) {
    return decision;
  }

  const spawnPlan = await prepareSpawnPlan({
    db,
    logState,
    aliased,
    effectiveEvents: decision.effectiveEvents,
    productionConfig: runWebProductionDeploymentPreflight(),
  });  const effectiveSeqs = await appendBatchWithSeq(
    db,
    logState,
    spawnPlan.effectiveEvents.map((event) => toAppend(event, spawnPlan.preparedDispatches.get(event))),
  );
  logState.snapshot = outcome.snapshot;
  refoldApplicationDeprecations(logState, spawnPlan.effectiveEvents, effectiveSeqs);
  if (spawnPlan.effectiveEvents.some((event) => event.kind === 'definition-activated')) {
    deps.scheduleRecipes(logState.snapshot);
  }
  await materializeSpawnArtifacts(db, logState, spawnPlan.effectiveEvents, aliased, spawnPlan.artifactModel);
  await dispatchSpawnPlan({
    db,
    logState,
    plan: spawnPlan,
    effectiveSeqs,
    aliased,
    gateDeps: deps.gateDeps,
  });
  applyForeignGaps(logState);

  // 受影响实体:append 产出新实例时返回新实体,否则返回执行实体的新投影。
  const appended = spawnPlan.effectiveEvents[0]?.appended ?? [];
  const targetRel = appended.length > 0 ? appended[appended.length - 1]! : aliased.rel;
  // T52 终验缺陷 A 修复(D71.3):受治理停用的受影响面是集合——伴随事件
  // application-deprecated 使 meta/application:<name> 与「从未安装」同形
  // (存在性隐藏恒 undefined,不是内部错误);回执改投影收缩后的
  // meta/applications 集合(停用即离场,成员不含停用名)。其余 kind 保持
  // 通用不变式:undefined 即内部不变式破坏,不静默放行。
  const receiptRel =
    spawnPlan.effectiveEvents.at(-1)?.kind === 'application-deprecated'
      ? 'meta/applications'
      : targetRel;
  const entity = project(logState.snapshot, receiptRel, deps.projectDeps());
  if (entity === undefined) {
    throw new Error(`exec 后目标实体 "${receiptRel}" 不可投影(内部不变式破坏)`);
  }
  return { kind: 'accepted', entity, appended };
}

export async function execPlanCore(
  deps: ExecCoreDeps,
  steps: readonly ExecRequest[],
): Promise<PlanServiceOutcome> {
  const { db, logState, toAppend } = deps;
  // 单事务:整个计划一次入串行队列(与 exec 无交错;批量裁决是一个 atom)。
  await refreshFromLog(db, logState, deps.scheduleRecipes);

  // 步级 flow 别名与 exec 同口径(flow:article-drafting → 唯一实例 rel)。
  const aliased = steps.map((step) => ({
    ...step,
    rel: resolveFlowRelAlias(step.rel, logState.snapshot) ?? step.rel,
  }));

  const outcome = executePlan(aliased, logState.snapshot, deps.gateDeps());

  // 落库顺序 = 日志顺序:各步伴随事件 → 拒绝步留痕 → 批量裁决记录标记。
  const batch = outcome.events.map((event) => toAppend(event));
  const rejected = outcome.results.find((result) => result.outcome === 'rejected');
  if (rejected !== undefined && rejected.rejection !== undefined) {
    const request = aliased[rejected.step - 1]!;
    batch.push(
      toAppend({
        ...actionRejectedEvent(request, rejected.rejection, {
          plan: { step: rejected.step },
        }),
        params: paramsWithOrigins(request),
      }),
    );
  }
  batch.push(toAppend(outcome.record));
  await appendBatchWithSeq(db, logState, batch);
  logState.snapshot = outcome.snapshot;
  applyForeignGaps(logState);

  // entities 摘要:executed 步的目标与追加 rel(保序去重)。
  const entities: string[] = [];
  for (const result of outcome.results) {
    if (result.outcome !== 'executed') continue;
    if (!entities.includes(result.rel)) entities.push(result.rel);
    for (const rel of result.appended ?? []) {
      if (!entities.includes(rel)) entities.push(rel);
    }
  }

  if (outcome.kind === 'plan-suspended') {
    // 挂起步的 notify 派发(尽力而为,fire-and-forget,与 exec 同口径)。
    void deps.dispatchNotify(outcome.confirmation);
    return {
      kind: 'plan-suspended',
      results: outcome.results,
      entities,
      confirmation: outcome.confirmation,
    };
  }
  return { kind: outcome.kind, results: outcome.results, entities };
}

