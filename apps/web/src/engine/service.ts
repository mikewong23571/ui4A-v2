/**
 * 引擎服务层:单例 engine runtime,把纯引擎(裁决/效果/投影)接到 PG 事件日志。
 *
 * - production boot 只读校验 versioned migration + explicit bootstrap receipt，再
 *   fold(日志)→ 快照；local demo/test 可自动执行同一 migration/bootstrap writer;
 * - 定义解析(T4 Phase B):业务 exec/judge/project/sitemap 一律吃 fold 快照的
 *   活跃定义(activeDefinitionOf:definitions 条目只持活跃指针,内容在
 *   definitionVersions 历史);生产运行无代码业务定义 fallback;
 * - exec(T3 Phase B 起)= executeWithGates:三层裁决(声明→guard→schema)→
 *   确认裁决(Cedar 策略,policy.cedar 文本驱动)→ 效果应用;
 *   - 拒绝:appendEvent(action-rejected,reason+detail{layer})不改状态;
 *   - 挂起:appendEvent(confirmation-requested,detail 含 Cedar 策略 id 与原因)
 *     + pending 确认实体物化,exec 结果 suspended(HTTP 层映射 202),随后
 *     **尽力而为**派发 notifyWorkflow(Temporal client;失败不阻塞 202,见 temporal/notify.ts);
 *   - 通过:applyEffects → appendEvent(s) → 增量持有新快照(日志是真相,快照可重算);
 *   - confirmation:<id> 实体上的 approve/reject 是普通 exec 的声明动作(铁律 5:
 *     审批不委托,guard actor-is-human 在引擎层拒 agent,I4),内部路由到引擎的
 *     人类裁决入口(approveConfirmation/rejectConfirmation),留痕口径与业务动作一致;
 * - execPlan(T6)= executePlan 批量裁决:整个计划一次入串行队列(单事务),
 *   逐步裁决、每步吃前步产出快照("不是信任计划,是批量裁决计划");
 *   落库顺序 = 各步伴随事件 → 拒绝步 action-rejected(detail 带计划步号)→
 *   plan-executed 标记(一条批量裁决记录);挂起步 notify 派发与 exec 同口径;
 * - 双写者(T3 Phase C / spec 决定 4):worker 直接 appendEvent 同一 PG
 *   (notification-delivered 等)。web 以 lastSeq 追踪已折叠进度:
 *   - 自身 append 后推进 lastSeq(不重折叠自己的事件);
 *   - 读路径(getEntity/readSnapshot)与 exec 开头先查 max(seq),有新事件则
 *     readLog(afterSeq=lastSeq) 增量 fold 进快照(fold(events, deps, initial)
 *     与全量重放同构,I5);worker 写的事件**不需重启**立即可见;
 * - 串行化(单 atom):exec 与增量 fold 全程经模块级 promise 队列串行,
 *   Next dev 多请求并发下无交错——"裁决器即并发控制";两写者的 PG 端一致性由
 *   bigserial seq 全序保证,web 侧按序 fold;
 * - 单例挂在 globalThis:Next dev 对每个 route 入口独立打包模块,普通模块级变量
 *   会得到多个实例(globalThis 是 Next 生态共享单例的标准做法);
 * - sitemap 从快照活跃定义纯推导,按活跃集内容 hash 缓存(定义激活即重生成,
 *   版本号=内容 hash,S2 的根基)。
 */
import {
  activeDefinitionOf,
  actionRejectedEvent,
  assertMetaBootstrapIntegrity,
  executeMeta,
  executeWithGates,
  executePlan,
  project,
  readRenderSpecsOf,
  THREADS_REL,
  THREAD_REL_PREFIX,
  type ConfirmationDeps,
  type EngineEvent,
  type ExecRequest,
  type ExecuteDeps,
  type FlowDefinition,
  type JudgeLayer,
  type LogEvent,
  type MetaDeps,
  type PlanStepResult,
  type ProjectDeps,
  type Sitemap,
  type SirenEntity,
  type SuspendedConfirmation,
} from '@ui4a/engine';
import type { DeploymentEnvironment, EngineSnapshot, FrozenRenderSpec } from '@ui4a/shared';
import type { FieldValue } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { readLog, type DbExecutor, type EventAppend } from '../db/events';
import { assertApplicationBootstrapReady, prepareDatabaseForApplication } from '../db/migrations';
import { getPool } from '../db/pool';
import { getProductionPool } from '../db/production-pool';
import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';
import {
  resetRecipeCoordinatorForTests,
  scheduleRecipesForSnapshot,
} from './presentation/recipes-runtime';
import { cedarPolicyFromDefaultFile } from '../domain/cedarPolicy';
import { bootstrapAndVerifyApplication } from './bootstrap';

export { bootstrapAndVerifyApplication } from './bootstrap';
import type { RenderSpec } from '../render/spec';
import { dispatchNotify } from '../temporal/notify';
import { completeFlowEntity, resolveFlowRelAlias } from './flow-entry';
import { preflightCodingResultDecision } from './agent/coding-result-decision';
import {
  createAndDispatchAgentRun,
  prepareNativeAgentDispatch,
  type PreparedNativeAgentDispatch,
} from './agent/native-agent-dispatch';
import { codingExecutorProfileRegistryFromEnvironment } from './agent/coding-executor-config';
import {
  appendBatchWithSeq,
  applyForeignGaps,
  createCoreEventLogState,
  refreshFromLog,
} from './service-event-log';
import { artifactModelFor, materializeSpawnArtifacts } from './service-artifacts';
import { execConfirmationDecision, persistRejection } from './service-confirmation';
import { execThreadAction } from './service-thread';
import { createSitemapReaders, type MetaSitemap } from './service-sitemaps';
import { freezeSpecCore, toRenderSpec, type FreezeSpecResult } from './service-render-specs';

export { LlmArtifactConfigurationError } from './service-artifacts';
export type { MetaSitemap } from './service-sitemaps';
export type { FreezeSpecResult } from './service-render-specs';

/**
 * exec 结果(discriminated union;HTTP 层据此映射 200/202/4xx)。
 * accepted.subject:被操作主体实体的裁决后投影(仅主体≠受影响实体时携带,
 * 如 approve 主体=confirmation、受影响=目标)——主体的 collection 回链
 * (如 inbox)是渲染层精确失效的唯一合同来源(T35 F-31)。
 */
export type ExecOutcome =
  | { kind: 'accepted'; entity: SirenEntity; appended: string[]; subject?: SirenEntity }
  | { kind: 'suspended'; entity: SirenEntity; confirmation: SuspendedConfirmation }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

/**
 * exec-plan 结果(T6 批量裁决;HTTP 层映射 completed/rejected → 200,
 * suspended → 202——请求被完整处理,分步报告在 body,拒绝是步级数据)。
 * entities:受影响实体摘要(executed 步的目标与追加 rel,保序去重)。
 */
export type PlanServiceOutcome =
  | { kind: 'plan-completed'; results: PlanStepResult[]; entities: string[] }
  | { kind: 'plan-rejected'; results: PlanStepResult[]; entities: string[] }
  | {
      kind: 'plan-suspended';
      results: PlanStepResult[];
      entities: string[];
      confirmation: SuspendedConfirmation;
    };

/** 定义平面 rel(meta/self 或 meta/ 前缀;HTTP 层的跨站路由键)。 */
export function isMetaRel(rel: string): boolean {
  return rel === 'meta/self' || rel.startsWith('meta/') || rel.startsWith('draft:');
}

export interface EngineRuntime {
  /** 当前内存快照(boot/exec/增量 fold 维护;只读视图,不触库——需外部写者进度用 readSnapshot)。 */
  getSnapshot(): EngineSnapshot;
  /** 读路径快照:先增量 fold worker 等外部写者追加的事件,再返回(spec 决定 4)。 */
  readSnapshot(): Promise<EngineSnapshot>;
  /** rel → Siren 实体(含 guard-results 注入);返回前增量 fold 新事件;未知 rel 返回 undefined。 */
  getEntity(rel: string): Promise<SirenEntity | undefined>;
  /** meta rel → Siren 实体(_meta 站点;href 前缀 /_meta,同引擎同日志)。 */
  getMetaEntity(rel: string): Promise<SirenEntity | undefined>;
  /** 应用 sitemap(按活跃定义集内容 hash 缓存;定义激活即重生成)。 */
  getSitemap(): Sitemap;
  /** meta 站点 sitemap(meta rel 面;按 surfaces 内容 hash 缓存)。 */
  getMetaSitemap(): MetaSitemap;
  /** 执行动作(串行单 atom):同步外部写者 → 三层裁决 → 事件留痕 → 增量快照 → notify 派发(尽力而为)。 */
  exec(request: ExecRequest): Promise<ExecOutcome>;
  /**
   * 批量裁决计划(T6):整个计划一次入串行队列(单事务)——同步外部写者 →
   * executePlan 逐步裁决 → 伴随事件 + 拒绝留痕 + plan-executed 标记一次落库 →
   * 增量快照 → (挂起时)notify 派发(尽力而为,与 exec 同口径)。
   */
  execPlan(steps: readonly ExecRequest[]): Promise<PlanServiceOutcome>;
  /**
   * 凝固渲染 spec(T7):串行队列内首冻追加 render-spec-frozen 事件并物化
   * renderSpecs 表;同 concern 二次请求直接返回已凝固(不追加事件)。
   * 入口校验(不合法抛错、不入日志):零字面校验器 + 词汇表词名 +
   * concern 键一致(spec.concern === concern)。
   */
  freezeSpec(
    concern: string,
    spec: RenderSpec,
    requestedBy?: { actor: 'human' | 'agent'; principal?: string },
  ): Promise<FreezeSpecResult>;
  /** 查询已凝固 spec(未凝固 undefined;快照读,不触库)。 */
  getFrozenSpec(concern: string): RenderSpec | undefined;
  /** 已凝固 spec 条目列表(日志序)。 */
  listFrozenSpecs(): FrozenRenderSpec[];
  /** Serialize an external adapter mutation with core exec/meta mutations. */
  runExclusive<T>(run: () => Promise<T>): Promise<T>;
}

const DEFAULT_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a';

/** 服务层自用 db(按连接串复用 pg pool)。 */
export function getDb(environment: DeploymentEnvironment = process.env): DbExecutor {
  const productionConfig = runWebProductionDeploymentPreflight(environment);
  return productionConfig === undefined
    ? getPool(environment.DATABASE_URL ?? DEFAULT_DATABASE_URL)
    : getProductionPool(productionConfig);
}

/** 请求参数 → 带出处的字段(出处缺省 intent;与 engine effects 的 originOf 同口径)。 */
export function paramsWithOrigins(request: ExecRequest): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(request.params ?? {}).map(([name, value]) => [
      name,
      { value, origin: request.paramOrigins?.[name] ?? 'intent' },
    ]),
  );
}

/** 确认实体 rel 前缀(与 engine confirmationRel 同口径;approve/reject 的路由键)。 */
export const CONFIRMATION_REL_PREFIX = 'confirmation:';

// ---- globalThis 单例(见文件头注释)----------------------------------------

interface EngineGlobalState {
  bootDb: DbExecutor | null;
  boot: Promise<EngineRuntime> | null;
  /** 串行队列尾(单 atom 语义的执行线索)。 */
  tail: Promise<unknown>;
}

// 类型断言理由:Next dev 多入口模块隔离,必须借 globalThis 跨入口共享单例。
const globalRef = globalThis as typeof globalThis & { __ui4aEngine__?: EngineGlobalState };

function engineState(): EngineGlobalState {
  if (globalRef.__ui4aEngine__ === undefined) {
    globalRef.__ui4aEngine__ = { bootDb: null, boot: null, tail: Promise.resolve() };
  }
  return globalRef.__ui4aEngine__;
}

/** 排入串行队列:previous 落败也不阻断后续(错误由各自 caller 接住)。 */
function enqueue<T>(state: EngineGlobalState, run: () => Promise<T>): Promise<T> {
  const result = state.tail.then(run, run);
  state.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function bootEngine(db: DbExecutor): Promise<EngineRuntime> {
  if (process.env.UI4A_DEPLOYMENT_PROFILE === 'production') {
    await assertApplicationBootstrapReady(db);
  } else {
    await prepareDatabaseForApplication(db);
    await bootstrapAndVerifyApplication(db);
  }

  const events: LogEvent[] = await readLog(db);
  assertMetaBootstrapIntegrity(events);
  // 核心事件日志状态(快照 + 已折叠进度 seq 高水位 + foreignGaps):自身 append
  // 推进水位;读路径/exec 开头按此增量 fold 外部写者(多写者水位铁律见下)。
  const logState = createCoreEventLogState(events);
  // Application/Flow/Catalog activation 的旁路预生成；配置/模型失败只进入
  // Presentation coordinator failure，不阻断 boot 或业务引擎。
  scheduleRecipesForSnapshot(logState.snapshot);
  const state = engineState();

  // ---- 定义解析(T4 Phase B:fold 快照即真相,代码常量仅 seed 源+顺序锚)----
  // 活跃定义 = definitionVersions[条目当前版本](activeDefinitionOf):草稿窗口
  // 的工作副本不进业务平面;每快照演进后重算(定义激活即自动切换)。
  const activeFlowList = (): FlowDefinition[] =>
    Object.keys(logState.snapshot.definitions ?? {}).flatMap((name) => {
      const active = activeDefinitionOf(logState.snapshot, name);
      return active === undefined ? [] : [active];
    });
  const activeFlows = (): Record<string, FlowDefinition> =>
    Object.fromEntries(activeFlowList().map((flow) => [flow.name, flow]));
  // 出生版本注册表(在途实例按出生定义走完):definitions 历史原样注入。
  const versions = (): Record<string, Record<number, FlowDefinition>> =>
    logState.snapshot.definitionVersions ?? {};
  const guards = seedGuardRegistry;
  // 确认门依赖:Cedar 策略在 boot 时装配一次(策略文件改动重启生效,T4 起 _meta 热更新)。
  const policy = cedarPolicyFromDefaultFile();
  const gateDeps = (): ExecuteDeps => ({
    flows: activeFlows(),
    guards,
    policy,
    versions: versions(),
  });
  const confirmDeps = (): ConfirmationDeps => ({
    flows: activeFlows(),
    guards,
    versions: versions(),
  });
  const projectDeps = (): ProjectDeps => ({ flows: activeFlows(), guards, versions: versions() });
  // meta 平面编排依赖(编辑动词裁决用 lifecycle 常量自举,executeMeta 内部注入;
  // 激活不变式的注册表缺省 KNOWN_FIELD_TYPES/KNOWN_EFFECT_TYPES)。
  const metaDeps = (): MetaDeps => ({
    guards,
    policy,
    executorProfiles: codingExecutorProfileRegistryFromEnvironment(),
  });

  // sitemap 读者(业务/meta 两面;按活跃定义集内容 hash 缓存,工厂与缓存在
  // service-sitemaps.ts,快照经 getSnapshot 惰性读取)。
  const { currentSitemap, currentMetaSitemap } = createSitemapReaders(
    () => logState.snapshot,
    activeFlowList,
  );

  const withIdentityAudit = (detail: unknown, identity: ExecRequest['identity']): unknown => {
    if (identity === undefined) return detail;
    const base =
      typeof detail === 'object' && detail !== null && !Array.isArray(detail)
        ? (detail as Record<string, unknown>)
        : detail === undefined
          ? {}
          : { value: detail };
    return { ...base, identity };
  };

  /** 引擎事件 → 日志层追加形状(identity 寄存 detail，不增加第二套 DB schema)。 */
  const toAppend = (event: EngineEvent): EventAppend => {
    const eventDetail =
      event.kind === 'spawn-requested'
        ? {
            capability: event.capability,
            ...(event.bind !== undefined ? { bind: event.bind } : {}),
            ...(event['on-done'] !== undefined ? { 'on-done': event['on-done'] } : {}),
            ...(event['on-error'] !== undefined ? { 'on-error': event['on-error'] } : {}),
          }
        : event.detail;
    return {
      kind: event.kind,
      rel: event.rel,
      action: event.action,
      actor: event.actor,
      principal: event.principal,
      channel: event.channel,
      params: event.params,
      detail: withIdentityAudit(eventDetail, event.identity),
      reason: event.reason,
    };
  };

  /**
   * 追加并推进 lastSeq(自身事件不进入增量 fold,防双算)。
   *
   * 多写者水位铁律(T5 Phase C 实测链路 bug 修复):水位只能跨过**已折叠或
   * 自身已应用**的 seq。自身 INSERT 落库时,日志里可能夹着 worker 在本次
   * exec 的 refresh 之后、INSERT 之前刚提交的外部事件(其 seq 低于自身新
   * 事件)——直接把 lastSeq 推到自身 seq 会让 refresh 的 `seq > lastSeq`
   * **永久跳过**它们(S3 并行委托实测:delegation-step 缺步 → 折叠层抛
   * 「步号不连续」、读路径全 500)。故推进前先把 (lastSeq, 自身 seq) 区间
   * 的外部事件收进 foreignGaps,随后由 applyForeignGaps 折入。
   *
   * 收集而非立即折叠的原因:exec/确认裁决随后会用**不含这些外部事件的**
   * 派生快照整体覆写 logState.snapshot(applyEffects 的纯函数产物)——立即折会被
   * 覆写冲掉;每个覆写点之后统一补折。可交换性论证:worker 直写的是
   * delegation:* 族与 notification-delivered(rel=confirmation:<id>)——
   * 前者 rel 与自身族不相交;后者与确认族 rel 相交但**字段级可交换**
   * (notified 标志不与 status/approvedBy 等字段互相覆盖),交换次序安全。
   */
  return {
    getSnapshot: () => logState.snapshot,
    readSnapshot: () =>
      enqueue(state, () => refreshFromLog(db, logState, scheduleRecipesForSnapshot)).then(
        () => logState.snapshot,
      ),
    getEntity: async (rel) => {
      // 读路径增量 fold(spec 决定 4):返回前同步 worker 等外部写者的新事件。
      await enqueue(state, () => refreshFromLog(db, logState, scheduleRecipesForSnapshot));
      // flow:<name> 读面补全(别名→实例集合兜底→集合入口链接)整体在 flow-entry
      // 的 completeFlowEntity;alias 请求参数缺省仅影响 rel 解析。
      return completeFlowEntity(rel, logState.snapshot, activeFlowList(), (target) =>
        project(logState.snapshot, target, projectDeps()),
      );
    },
    getMetaEntity: async (rel) => {
      // _meta 站点读路径:同一引擎同一日志(先同步外部写者);href 前缀 /_meta
      // (站点自洽:留在定义层;引擎 project 的 baseHref 机制,不改投影语义)。
      await enqueue(state, () => refreshFromLog(db, logState, scheduleRecipesForSnapshot));
      return project(logState.snapshot, rel, { ...projectDeps(), baseHref: '/_meta' });
    },
    getSitemap: () => currentSitemap(),
    getMetaSitemap: () => currentMetaSitemap(),
    exec(request) {
      return enqueue(state, async () => {
        // 先同步外部写者进度再裁决(裁决器只见全序日志的最新折叠态);
        // 已在串行队列内,直接调用(不重入 enqueue)。
        await refreshFromLog(db, logState, scheduleRecipesForSnapshot);

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
            { toAppend, confirmDeps, projectDeps },
            aliased,
          );
        }

        if (aliased.rel === THREADS_REL || aliased.rel.startsWith(THREAD_REL_PREFIX)) {
          return execThreadAction(db, logState, { toAppend, projectDeps }, aliased);
        }

        // meta 平面(rel 前缀路由,T4 Phase B):编辑动词/生命周期动词过同一
        // executeMeta 编排——同一裁决器(lifecycle 常量自举)、同一日志、同一
        // 串行队列;后续事件落库/投影与业务 exec 共用同一套代码路径。
        const outcome = isMetaRel(aliased.rel)
          ? executeMeta(aliased, logState.snapshot, metaDeps())
          : executeWithGates(aliased, logState.snapshot, gateDeps());

        if (outcome.kind === 'rejected') {
          // 拒绝即数据(I6):不改状态,结构化原因入日志;detail 携带 layer,
          // HTTP 响应与本事件同源(同一 verdict 对象),口径必然一致。
          return persistRejection(db, logState, toAppend, aliased, outcome);
        }

        if (outcome.kind === 'suspended') {
          // 挂起(非拒绝):confirmation-requested 落库(detail 含 Cedar 策略 id
          // 与原因,spec 验收 5),pending 实体物化进快照,业务状态不动。
          await appendBatchWithSeq(db, logState, outcome.events.map(toAppend));
          logState.snapshot = outcome.snapshot;
          applyForeignGaps(logState);
          const rel = `confirmation:${outcome.confirmation.id}`;
          const entity = project(logState.snapshot, rel, projectDeps());
          if (entity === undefined) {
            throw new Error(`挂起后确认实体 "${rel}" 不可投影(内部不变式破坏)`);
          }
          // notify 派发(尽力而为,fire-and-forget):失败不影响挂起结果/202;
          // 不入串行队列——派发不触快照,temporal/notify.ts 内部全兜底。
          void dispatchNotify(outcome.confirmation);
          return { kind: 'suspended', entity, confirmation: outcome.confirmation };
        }

        let effectiveEvents = outcome.events;
        const decisionInstance = logState.snapshot.instances[aliased.rel];
        const decisionFlow =
          decisionInstance === undefined
            ? undefined
            : activeDefinitionOf(logState.snapshot, decisionInstance.flow);
        const decisionAction = decisionFlow?.nodes
          .find((node) => node.name === decisionInstance?.node)
          ?.actions.find((action) => action.name === aliased.action);
        if (decisionAction?.decision !== undefined) {
          const decision = await preflightCodingResultDecision(
            db,
            logState.snapshot,
            aliased,
            decisionAction,
          );
          if (
            decision !== undefined &&
            (decision.decision === 'denied' || decision.decision === 'stale')
          ) {
            return persistRejection(db, logState, toAppend, aliased, {
              layer: 'guard-failed',
              reason: decision.reason,
              detail: decision,
            });
          }
          if (decision !== undefined) {
            effectiveEvents = outcome.events.map((event) =>
              event.kind === 'action-executed'
                ? {
                    ...event,
                    detail: {
                      ...(event.detail as Record<string, unknown>),
                      codingDecision: decision.receipt,
                    },
                  }
                : event,
            );
          }
        }

        const artifactModel = artifactModelFor(logState, effectiveEvents, aliased);
        const sourceInstance = logState.snapshot.instances[aliased.rel];
        const spawnPolicyScope =
          (sourceInstance === undefined
            ? undefined
            : activeDefinitionOf(logState.snapshot, sourceInstance.flow)?.app) ?? 'default';
        const spawnPrincipal = aliased.principal ?? 'local-user';
        const productionConfig = runWebProductionDeploymentPreflight();
        const preparedNativeRuns = new Map<EngineEvent, PreparedNativeAgentDispatch>();
        for (const event of effectiveEvents) {
          if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') continue;
          const capability = logState.snapshot.capabilities?.[event.capability];
          if (capability === undefined) continue;
          if (capability.executor === undefined) continue;
          if (capability.executor.agentDefinition === undefined) {
            throw new Error(
              `capability ${capability.name} executor has no Agent Definition; only canonical Agent Runs can be dispatched`,
            );
          }
          preparedNativeRuns.set(
            event,
            await prepareNativeAgentDispatch(db, {
              principal: spawnPrincipal,
              policyScope: spawnPolicyScope,
              params: aliased.params ?? {},
              capability,
              ...(productionConfig === undefined ? {} : { productionConfig }),
            }),
          );
        }
        const spawned: {
          event: EngineEvent;
          seq: number;
          prepared?: PreparedNativeAgentDispatch;
        }[] = [];
        const effectiveSeqs = await appendBatchWithSeq(db, logState, effectiveEvents.map(toAppend));
        for (const [index, event] of effectiveEvents.entries()) {
          const seq = effectiveSeqs[index]!;
          if (event.kind === 'spawn-requested') {
            const prepared = preparedNativeRuns.get(event);
            spawned.push({ event, seq, ...(prepared === undefined ? {} : { prepared }) });
          }
        }
        logState.snapshot = outcome.snapshot;
        if (effectiveEvents.some((event) => event.kind === 'definition-activated')) {
          scheduleRecipesForSnapshot(logState.snapshot);
        }
        await materializeSpawnArtifacts(db, logState, effectiveEvents, aliased, artifactModel);
        for (const { event, seq, prepared } of spawned) {
          if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') continue;
          const capability = logState.snapshot.capabilities?.[event.capability];
          if (capability?.executor === undefined) continue;
          if (prepared === undefined) {
            throw new Error('spawn dispatch missed its prepared native Agent Run');
          }
          const run = await createAndDispatchAgentRun(db, {
            prepared,
            sourceSeq: seq,
            sourceRel: aliased.rel,
            sourceAction: aliased.action,
            principal: spawnPrincipal,
            policyScope: spawnPolicyScope,
            onDoneAction: event['on-done'],
            onErrorAction: event['on-error'],
          });
          if (run.status === 'failed') {
            const callbackAction = run.source.onErrorAction;
            if (callbackAction === undefined) {
              throw new Error('failed capability dispatch has no declared on-error action');
            }
            const callback = executeWithGates(
              {
                rel: run.source.rel,
                action: callbackAction,
                actor: 'agent',
                principal: `system:capability:${run.runId}`,
                channel: 'capability-callback',
                params: {
                  runId: run.runId,
                  reason: run.failure?.reason ?? 'capability dispatch failed',
                },
              },
              logState.snapshot,
              gateDeps(),
            );
            if (callback.kind !== 'executed') {
              throw new Error(
                `failed capability dispatch callback rejected: ${
                  callback.kind === 'rejected' ? callback.reason : 'confirmation suspended'
                }`,
              );
            }
            await appendBatchWithSeq(db, logState, callback.events.map(toAppend));
            logState.snapshot = callback.snapshot;
          }
        }
        applyForeignGaps(logState);

        // 受影响实体:append 产出新实例时返回新实体,否则返回执行实体的新投影。
        const appended = effectiveEvents[0]?.appended ?? [];
        const targetRel = appended.length > 0 ? appended[appended.length - 1]! : aliased.rel;
        const entity = project(logState.snapshot, targetRel, projectDeps());
        if (entity === undefined) {
          throw new Error(`exec 后目标实体 "${targetRel}" 不可投影(内部不变式破坏)`);
        }
        return { kind: 'accepted', entity, appended };
      });
    },
    execPlan(steps) {
      // 单事务:整个计划一次入串行队列(与 exec 无交错;批量裁决是一个 atom)。
      return enqueue(state, async () => {
        await refreshFromLog(db, logState, scheduleRecipesForSnapshot);

        // 步级 flow 别名与 exec 同口径(flow:article-drafting → 唯一实例 rel)。
        const aliased = steps.map((step) => ({
          ...step,
          rel: resolveFlowRelAlias(step.rel, logState.snapshot) ?? step.rel,
        }));

        const outcome = executePlan(aliased, logState.snapshot, gateDeps());

        // 落库顺序 = 日志顺序:各步伴随事件 → 拒绝步留痕 → 批量裁决记录标记。
        const batch = outcome.events.map(toAppend);
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
          void dispatchNotify(outcome.confirmation);
          return {
            kind: 'plan-suspended',
            results: outcome.results,
            entities,
            confirmation: outcome.confirmation,
          };
        }
        return { kind: outcome.kind, results: outcome.results, entities };
      });
    },
    freezeSpec(concern, spec, requestedBy) {
      // 串行队列内先同步外部写者,主流程(校验/首冻/物化)在 service-render-specs.ts。
      return enqueue(state, async () => {
        await refreshFromLog(db, logState, scheduleRecipesForSnapshot);
        return freezeSpecCore(db, logState, concern, spec, requestedBy);
      });
    },
    getFrozenSpec: (concern) => {
      const frozen = logState.snapshot.renderSpecs?.[concern];
      return frozen === undefined ? undefined : toRenderSpec(frozen);
    },
    listFrozenSpecs: () => readRenderSpecsOf(logState.snapshot),
    runExclusive: (run) =>
      enqueue(state, async () => {
        await refreshFromLog(db, logState, scheduleRecipesForSnapshot);
        return run();
      }),
  };
}

/**
 * 获取(或启动)引擎单例。同 db 幂等(返回同一 promise);
 * 启动失败(如 db 不可达)清除缓存,下次调用重试。
 */
export function getEngine(db: DbExecutor): Promise<EngineRuntime> {
  const state = engineState();
  if (state.boot !== null && state.bootDb === db) {
    return state.boot;
  }
  state.bootDb = db;
  state.boot = bootEngine(db);
  state.boot.catch(() => {
    if (state.bootDb === db) {
      state.boot = null;
      state.bootDb = null;
    }
  });
  return state.boot;
}

/** 测试专用:清空单例与串行队列(beforeEach TRUNCATE 后重新 boot+seed)。 */
export function resetEngineForTests(): void {
  const state = engineState();
  state.boot = null;
  state.bootDb = null;
  state.tail = Promise.resolve();
  resetRecipeCoordinatorForTests();
}
