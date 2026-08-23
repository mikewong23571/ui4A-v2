/**
 * 引擎服务层:单例 engine runtime,把纯引擎(裁决/效果/投影)接到 PG 事件日志。
 *
 * - boot = ensureEventsTable + meta application-bundle 幂等安装（具体业务定义来自
 *   独立数据制品，kernel 只做解析/校验/事件规划）+
 *   fold(日志)→ 快照;
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
import { createHash } from 'node:crypto';

import {
  activeDefinitionOf,
  applyCapabilityArtifactCreated,
  assertMetaBootstrapIntegrity,
  approveConfirmation,
  canonicalJson,
  contentVersion,
  deriveSitemap,
  executeMeta,
  executeWithGates,
  executePlan,
  fold,
  planMetaBootstrap,
  project,
  readRenderSpecsOf,
  rejectConfirmation,
  renderSpecRel,
  type Approver,
  type ConfirmationDecision,
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
  type RenderSpecFrozenDetail,
  type Sitemap,
  type SitemapSurface,
  type SirenEntity,
  type SuspendedConfirmation,
} from '@ui4a/engine';
import type { EngineSnapshot, FrozenRenderSpec } from '@ui4a/shared';
import type { FieldValue } from '@ui4a/shared';
import { metaCapabilityRel, metaFlowRel, seedGuardRegistry } from '@ui4a/shared';

import {
  appendEvent,
  ensureEventsTable,
  readLog,
  type DbExecutor,
  type EventAppend,
} from '../db/events';
import { getPool } from '../db/pool';
import { ensureCapabilityRunTables } from '../db/capability-runs';
import {
  ensureAgentDefinitionTables,
  installSeedAgentDefinition,
  rebuildAgentDefinitionProjection,
} from '../db/agent-definitions';
import { installedApplicationBundles } from '../applications/bundles';
import { installedAgentDefinitions } from '../applications/agent-definitions';
import {
  resetRecipeCoordinatorForTests,
  scheduleRecipesForSnapshot,
} from './presentation/recipes-runtime';
import { cedarPolicyFromDefaultFile } from '../domain/cedarPolicy';
import type { RenderSpec } from '../render/spec';
import { validateSpec } from '../render/validator';
import { wordOf } from '../render/registry';
import { dispatchNotify } from '../temporal/notify';
import { resolveFlowRelAlias, withCollectionFlowEntryLinks } from './flow-entry';
import {
  createAndDispatchCapabilityRun,
  preflightCapabilityExecutor,
  preflightCodingResultDecision,
} from './capability-runs';
import {
  createAndDispatchAgentRun,
  prepareNativeAgentDispatch,
  type PreparedNativeAgentDispatch,
} from './native-agent-dispatch';
import { codingExecutorProfileRegistryFromEnvironment } from './coding-executor-config';

/** exec 结果(discriminated union;HTTP 层据此映射 200/202/4xx)。 */
export type ExecOutcome =
  | { kind: 'accepted'; entity: SirenEntity; appended: string[] }
  | { kind: 'suspended'; entity: SirenEntity; confirmation: SuspendedConfirmation }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

/** 正式模型工件缺少部署 profile；调用方应映射为可恢复 503，而非内部错误。 */
export class LlmArtifactConfigurationError extends Error {
  readonly code = 'LLM_CONFIGURATION';

  constructor() {
    super('正式模型工件需要外部配置 LLM_MODEL；未写入任何业务事件，请配置后重试');
    this.name = 'LlmArtifactConfigurationError';
  }
}

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

/** meta 站点 sitemap(定义层交互拓扑:meta rel 面;跨站规则下业务面不携带)。 */
export interface MetaSitemap {
  version: string;
  site: 'meta';
  surfaces: SitemapSurface[];
}

/** 定义平面 rel(meta/self 或 meta/ 前缀;HTTP 层的跨站路由键)。 */
export function isMetaRel(rel: string): boolean {
  return rel === 'meta/self' || rel.startsWith('meta/') || rel.startsWith('draft:');
}

/**
 * 冻结结果:spec 为生效的已凝固 spec;frozen=true 本次首冻(事件已追加),
 * false = concern 已凝固,返回首冻 spec(首冻为准——"同一关注点永远同一布局")。
 */
export interface FreezeSpecResult {
  concern: string;
  frozen: boolean;
  spec: RenderSpec;
  requestedBy: { actor: 'human' | 'agent'; principal?: string };
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
export function getDb(): DbExecutor {
  return getPool(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
}

/** 请求参数 → 带出处的字段(出处缺省 intent;与 engine effects 的 originOf 同口径)。 */
function paramsWithOrigins(request: ExecRequest): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(request.params ?? {}).map(([name, value]) => [
      name,
      { value, origin: request.paramOrigins?.[name] ?? 'intent' },
    ]),
  );
}

/** 确认实体 rel 前缀(与 engine confirmationRel 同口径;approve/reject 的路由键)。 */
const CONFIRMATION_REL_PREFIX = 'confirmation:';

/** 已凝固条目 → RenderSpec(bind 在凝固入口已过零字面校验,仅类型归属)。 */
function toRenderSpec(frozen: FrozenRenderSpec): RenderSpec {
  return {
    concern: frozen.concern,
    component: frozen.component,
    // 断言理由:bind 经 freezeSpec 入口的零字面校验器把关后入日志,
    // 此处从 unknown 归属回 BindTree(渲染模块拥有该类型)。
    bind: frozen.bind as RenderSpec['bind'],
  };
}

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

/** 应用从 meta 自举：通用安装器消费版本化数据制品，service 不认识任何业务名。 */
async function bootstrapApplicationBundles(db: DbExecutor): Promise<void> {
  for (const bundle of installedApplicationBundles) {
    const log = await readLog(db);
    for (const event of planMetaBootstrap(bundle, log)) {
      await appendEvent(db, event);
    }
  }
}

/** Install repository-owned Agent Definition versions without impersonating a human approver. */
async function bootstrapAgentDefinitions(db: DbExecutor): Promise<void> {
  for (const definition of installedAgentDefinitions) {
    await installSeedAgentDefinition(db, {
      principal: 'local-user',
      policyScope: 'development',
      source: definition.source,
      artifact: definition.artifact,
      evalEvidence: definition.evaluation,
    });
  }
}

async function bootEngine(db: DbExecutor): Promise<EngineRuntime> {
  await ensureEventsTable(db);
  await ensureCapabilityRunTables(db);
  await ensureAgentDefinitionTables(db);
  await rebuildAgentDefinitionProjection(db);
  await bootstrapApplicationBundles(db);
  await bootstrapAgentDefinitions(db);

  const events: LogEvent[] = await readLog(db);
  assertMetaBootstrapIntegrity(events);
  let snapshot = fold(events, { flows: {} });
  // Application/Flow/Catalog activation 的旁路预生成；配置/模型失败只进入
  // Presentation coordinator failure，不阻断 boot 或业务引擎。
  scheduleRecipesForSnapshot(snapshot);
  // 已折叠进度(seq 高水位):自身 append 推进;读路径/exec 开头按此增量 fold 外部写者。
  let lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
  const state = engineState();

  // ---- 定义解析(T4 Phase B:fold 快照即真相,代码常量仅 seed 源+顺序锚)----
  // 活跃定义 = definitionVersions[条目当前版本](activeDefinitionOf):草稿窗口
  // 的工作副本不进业务平面;每快照演进后重算(定义激活即自动切换)。
  const activeFlowList = (): FlowDefinition[] =>
    Object.keys(snapshot.definitions ?? {}).flatMap((name) => {
      const active = activeDefinitionOf(snapshot, name);
      return active === undefined ? [] : [active];
    });
  const activeFlows = (): Record<string, FlowDefinition> =>
    Object.fromEntries(activeFlowList().map((flow) => [flow.name, flow]));
  // 出生版本注册表(在途实例按出生定义走完):definitions 历史原样注入。
  const versions = (): Record<string, Record<number, FlowDefinition>> =>
    snapshot.definitionVersions ?? {};
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

  // meta 站点 sitemap(meta rel 面;定义实体随 definitions 表动态列出,
  // capability 实体随 capabilities 表动态列出[T13 Phase C]——两面同进缓存键)。
  let metaSitemapCache: { key: string; sitemap: MetaSitemap } | undefined;
  const currentMetaSitemap = (): MetaSitemap => {
    const surfaces: SitemapSurface[] = [
      { rel: 'meta/self', title: 'definition-lifecycle(引擎自举)' },
      { rel: 'meta/flows', title: '流程定义', collection: true },
      { rel: 'meta/activations', title: '激活队列', collection: true },
      { rel: 'meta/applications', title: '应用定义', collection: true },
      ...Object.values(snapshot.applications ?? {}).map((application) => ({
        rel: `meta/application:${application.name}`,
        title: application.title,
      })),
      ...Object.values(snapshot.definitions ?? {}).map((entry) => ({
        rel: metaFlowRel(entry.name),
        title: entry.definition.title ?? entry.name,
      })),
      { rel: 'meta/capabilities', title: '能力目录', collection: true },
      ...Object.values(snapshot.capabilities ?? {}).map((capability) => ({
        rel: metaCapabilityRel(capability.name),
        title: capability.title,
      })),
    ];
    const key = contentVersion(surfaces);
    if (metaSitemapCache?.key === key) return metaSitemapCache.sitemap;
    const sitemap: MetaSitemap = { version: key, site: 'meta', surfaces };
    metaSitemapCache = { key, sitemap };
    return sitemap;
  };

  // sitemap 从快照活跃定义推导,按活跃集内容 hash 缓存(定义不变同对象引用;
  // 定义激活 → 活跃集变化 → 版本号变[S2 根基]——version 本身就是内容 hash)。
  // T10:applications 分组吃 snapshot.applications(fold 落表)且进缓存键——
  // app 定义变更(无 flow 变更)同样重生成,版本号随之 bump。
  let sitemapCache: { key: string; sitemap: Sitemap } | undefined;
  const currentSitemap = (): Sitemap => {
    const flows = activeFlowList();
    const applications = snapshot.applications;
    const capabilities = snapshot.capabilities;
    const key = contentVersion({ flows, applications, capabilities });
    if (sitemapCache?.key === key) return sitemapCache.sitemap;
    const sitemap = deriveSitemap(flows, {
      extraSurfaces: [
        { rel: 'comments', title: '评论', collection: true },
        { rel: 'inbox', title: '确认收件箱', collection: true },
        { rel: 'software-changes', title: '软件变更', collection: true, app: 'development' },
        { rel: 'agent-runs', title: 'Agent Runs', collection: true, app: 'development' },
        { rel: 'capability-runs', title: '能力执行', collection: true, app: 'development' },
      ],
      applications,
      capabilities,
    });
    sitemapCache = { key, sitemap };
    return sitemap;
  };

  /** 引擎事件 → 日志层追加形状(detail/reason 一并落库:fold 依赖 detail 重放)。 */
  const toAppend = (event: EngineEvent): EventAppend => ({
    kind: event.kind,
    rel: event.rel,
    action: event.action,
    actor: event.actor,
    principal: event.principal,
    channel: event.channel,
    params: event.params,
    detail:
      event.kind === 'spawn-requested'
        ? {
            capability: event.capability,
            ...(event.bind !== undefined ? { bind: event.bind } : {}),
            ...(event['on-done'] !== undefined ? { 'on-done': event['on-done'] } : {}),
            ...(event['on-error'] !== undefined ? { 'on-error': event['on-error'] } : {}),
          }
        : event.detail,
    reason: event.reason,
  });

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
   * 派生快照整体覆写 snapshot(applyEffects 的纯函数产物)——立即折会被
   * 覆写冲掉;每个覆写点之后统一补折。可交换性论证:worker 直写的是
   * delegation:* 族与 notification-delivered(rel=confirmation:<id>)——
   * 前者 rel 与自身族不相交;后者与确认族 rel 相交但**字段级可交换**
   * (notified 标志不与 status/approvedBy 等字段互相覆盖),交换次序安全。
   */
  let foreignGaps: LogEvent[] = [];

  /** 追加并返回自身 seq(自身事件不进增量 fold;调用方用它做在线物化)。 */
  const appendWithSeq = async (event: EventAppend): Promise<number> => {
    const { seq } = await appendEvent(db, event);
    if (seq > lastSeq) {
      const gap = (await readLog(db, lastSeq)).filter((entry) => entry.seq < seq);
      foreignGaps.push(...gap);
      lastSeq = seq;
    }
    return seq;
  };

  /**
   * 通用同步 capability materialization：LLM 已按 action schema 生成 output-param，
   * spawn bind 只声明来源字段与输出参数名；本层把它物化为可重放 artifact。
   * 不识别 capability/action 业务名，缺少完整声明时保留 spawn 事件但不造工件。
   */
  const materializeSpawnArtifacts = async (
    events: readonly EngineEvent[],
    request: ExecRequest,
    model: string | undefined,
  ): Promise<void> => {
    for (const event of events) {
      if (event.kind !== 'spawn-requested') continue;
      if (typeof event.capability !== 'string') continue;
      const sourceField = event.bind?.['source-field'];
      const outputParam = event.bind?.['output-param'];
      if (typeof sourceField !== 'string' || typeof outputParam !== 'string') continue;
      const source = snapshot.instances[request.rel]?.fields[sourceField];
      const output = request.params?.[outputParam];
      const capability = snapshot.capabilities?.[event.capability];
      if (source === undefined || output === undefined || capability === undefined) continue;
      if (model === undefined) {
        throw new Error('正式工件 materialization 缺少已预检的 LLM_MODEL(内部不变式破坏)');
      }

      const content = { [outputParam]: output };
      const canonicalContent = canonicalJson(content);
      const contentHash = `sha256:${createHash('sha256').update(canonicalContent).digest('hex')}`;
      const id = createHash('sha256')
        .update(
          canonicalJson({
            capability: event.capability,
            source: { rel: request.rel, field: sourceField },
            contentHash,
            model,
          }),
        )
        .digest('hex');
      const rel = `artifact:${id}`;
      const detail = {
        id,
        capability: event.capability,
        source: { rel: request.rel, field: sourceField },
        model,
        outputSchema: capability.outputSchema ?? { type: 'object' },
        content,
        contentHash,
        createdBy: {
          actor: request.actor ?? 'human',
          ...(request.principal !== undefined ? { principal: request.principal } : {}),
        },
      };
      const seq = await appendWithSeq({
        kind: 'capability-artifact-created',
        rel,
        actor: request.actor ?? 'human',
        principal: request.principal,
        channel: 'capability',
        detail,
      });
      snapshot = applyCapabilityArtifactCreated(snapshot, { seq, rel, detail });
    }
  };

  /**
   * 只对确实会物化正式工件的 spawn 要求模型 profile。必须在 append outcome.events
   * 之前调用，避免 action-executed/spawn-requested 已写而 artifact 未写的半成品。
   */
  const artifactModelFor = (
    events: readonly EngineEvent[],
    request: ExecRequest,
  ): string | undefined => {
    const materializes = events.some((event) => {
      if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') return false;
      const sourceField = event.bind?.['source-field'];
      const outputParam = event.bind?.['output-param'];
      if (typeof sourceField !== 'string' || typeof outputParam !== 'string') return false;
      return (
        snapshot.instances[request.rel]?.fields[sourceField] !== undefined &&
        request.params?.[outputParam] !== undefined &&
        snapshot.capabilities?.[event.capability] !== undefined
      );
    });
    if (!materializes) return undefined;
    const model = process.env.LLM_MODEL?.trim();
    if (model === undefined || model === '') throw new LlmArtifactConfigurationError();
    return model;
  };

  /** 把落库窗口内挤进来的外部事件补折进当前快照(幂等清空;所有覆写点之后调用)。 */
  const applyForeignGaps = (): void => {
    if (foreignGaps.length === 0) return;
    const gaps = foreignGaps;
    foreignGaps = [];
    snapshot = fold(gaps, { flows: {} }, snapshot);
  };

  /**
   * 增量 fold 外部写者(worker)追加的事件:PG max(seq) 高于 lastSeq 时,
   * readLog(afterSeq=lastSeq) 按序折进快照。必须在串行队列内调用
   * (与 exec 无交错);fold(initial=当前快照)与全量重放同构(I5)。
   */
  const refreshFromLog = async (): Promise<void> => {
    const result = await db.query<{ max_seq: string | number | null }>(
      "SELECT max(seq) AS max_seq FROM events WHERE domain='core'",
    );
    const maxSeq = Number(result.rows[0]?.max_seq ?? 0);
    if (maxSeq <= lastSeq) {
      applyForeignGaps(); // 上一队列操作若中途抛错可能遗留未补折的外部事件
      return;
    }
    const fresh = await readLog(db, lastSeq);
    if (fresh.length === 0) {
      applyForeignGaps();
      return;
    }
    // 先折遗留 foreignGaps 再折 fresh:gaps 构造上恒更旧(seq < 收集时的
    // lastSeq),先折保持时序;若先折 fresh,遗留 gap 与 fresh 中相邻的
    // 委托步号会触发折叠层「步号不连续」响亮报错且确定性复发(终审 M-1)。
    applyForeignGaps();
    snapshot = fold(fresh, { flows: {} }, snapshot);
    if (fresh.some((event) => event.kind === 'definition-candidate-applied')) {
      scheduleRecipesForSnapshot(snapshot);
    }
    lastSeq = Math.max(lastSeq, fresh[fresh.length - 1]!.seq);
  };

  /** 拒绝留痕(action-rejected;detail 携带 layer,HTTP 响应与本事件同源)。 */
  const persistRejection = async (
    request: ExecRequest,
    verdict: {
      layer: JudgeLayer;
      reason: string;
      detail?: unknown;
    },
  ): Promise<ExecOutcome> => {
    await appendWithSeq({
      kind: 'action-rejected',
      rel: request.rel,
      action: request.action,
      actor: request.actor ?? 'human',
      principal: request.principal,
      channel: request.channel,
      params: paramsWithOrigins(request),
      reason: verdict.reason,
      detail: { layer: verdict.layer, judge: verdict.detail },
    });
    return verdict.detail === undefined
      ? { kind: 'rejected', layer: verdict.layer, reason: verdict.reason }
      : {
          kind: 'rejected',
          layer: verdict.layer,
          reason: verdict.reason,
          detail: verdict.detail,
        };
  };

  /**
   * 确认实体上的裁决动作(rel=confirmation:<id>,仅 approve/reject):
   * 路由到引擎人类裁决入口;受影响实体:approve → 目标实体(效果已应用),
   * reject → 确认实体自身(审计视图)。guard/schema 拒绝同样留痕(I4)。
   */
  const execConfirmationDecision = async (request: ExecRequest): Promise<ExecOutcome> => {
    const id = request.rel.slice(CONFIRMATION_REL_PREFIX.length);
    const approver: Approver = {
      actor: request.actor ?? 'human',
      ...(request.principal !== undefined ? { principal: request.principal } : {}),
    };
    let decision: ConfirmationDecision;
    if (request.action === 'approve') {
      decision = approveConfirmation(snapshot, id, approver, confirmDeps());
    } else if (request.action === 'reject') {
      const reason = typeof request.params?.reason === 'string' ? request.params.reason : '';
      decision = rejectConfirmation(snapshot, id, approver, reason, confirmDeps());
    } else {
      decision = {
        kind: 'rejected',
        layer: 'undeclared',
        reason: `动作 "${request.action}" 未声明于确认实体(仅 approve/reject)`,
      };
    }
    if (decision.kind === 'rejected') {
      return persistRejection(request, decision);
    }

    for (const event of decision.events) {
      await appendWithSeq(toAppend(event));
    }
    snapshot = decision.snapshot;
    applyForeignGaps();

    const targetRel =
      request.action === 'approve'
        ? (snapshot.confirmations?.[request.rel]?.targetRel ?? request.rel)
        : request.rel;
    const entity = project(snapshot, targetRel, projectDeps());
    if (entity === undefined) {
      throw new Error(`exec 后目标实体 "${targetRel}" 不可投影(内部不变式破坏)`);
    }
    return { kind: 'accepted', entity, appended: [] };
  };

  return {
    getSnapshot: () => snapshot,
    readSnapshot: () => enqueue(state, refreshFromLog).then(() => snapshot),
    getEntity: async (rel) => {
      // 读路径增量 fold(spec 决定 4):返回前同步 worker 等外部写者的新事件。
      await enqueue(state, refreshFromLog);
      // flow:<name> 别名(向导类 flow 投影为其实例实体)——纯服务层投影补全,
      // engine 的 project/judge 语义不动。alias 请求参数缺省仅影响 rel 解析。
      const target = resolveFlowRelAlias(rel, snapshot) ?? rel;
      const entity = project(snapshot, target, projectDeps());
      if (entity === undefined) return undefined;
      // 集合入口链接同样吃快照活跃定义(append 目标随定义激活演进)。
      return withCollectionFlowEntryLinks(entity, activeFlowList());
    },
    getMetaEntity: async (rel) => {
      // _meta 站点读路径:同一引擎同一日志(先同步外部写者);href 前缀 /_meta
      // (站点自洽:留在定义层;引擎 project 的 baseHref 机制,不改投影语义)。
      await enqueue(state, refreshFromLog);
      return project(snapshot, rel, { ...projectDeps(), baseHref: '/_meta' });
    },
    getSitemap: () => currentSitemap(),
    getMetaSitemap: () => currentMetaSitemap(),
    exec(request) {
      return enqueue(state, async () => {
        // 先同步外部写者进度再裁决(裁决器只见全序日志的最新折叠态);
        // 已在串行队列内,直接调用(不重入 enqueue)。
        await refreshFromLog();

        // exec 同样吃 flow 别名:裁决与日志都记实例 rel(不产生幽灵实体)。
        const aliased: ExecRequest = {
          ...request,
          rel: resolveFlowRelAlias(request.rel, snapshot) ?? request.rel,
        };

        // 确认实体上的动作走人类裁决入口(approve/reject;铁律 5:审批不委托)。
        if (aliased.rel.startsWith(CONFIRMATION_REL_PREFIX)) {
          return execConfirmationDecision(aliased);
        }

        // meta 平面(rel 前缀路由,T4 Phase B):编辑动词/生命周期动词过同一
        // executeMeta 编排——同一裁决器(lifecycle 常量自举)、同一日志、同一
        // 串行队列;后续事件落库/投影与业务 exec 共用同一套代码路径。
        const outcome = isMetaRel(aliased.rel)
          ? executeMeta(aliased, snapshot, metaDeps())
          : executeWithGates(aliased, snapshot, gateDeps());

        if (outcome.kind === 'rejected') {
          // 拒绝即数据(I6):不改状态,结构化原因入日志;detail 携带 layer,
          // HTTP 响应与本事件同源(同一 verdict 对象),口径必然一致。
          return persistRejection(aliased, outcome);
        }

        if (outcome.kind === 'suspended') {
          // 挂起(非拒绝):confirmation-requested 落库(detail 含 Cedar 策略 id
          // 与原因,spec 验收 5),pending 实体物化进快照,业务状态不动。
          for (const event of outcome.events) {
            await appendWithSeq(toAppend(event));
          }
          snapshot = outcome.snapshot;
          applyForeignGaps();
          const rel = `confirmation:${outcome.confirmation.id}`;
          const entity = project(snapshot, rel, projectDeps());
          if (entity === undefined) {
            throw new Error(`挂起后确认实体 "${rel}" 不可投影(内部不变式破坏)`);
          }
          // notify 派发(尽力而为,fire-and-forget):失败不影响挂起结果/202;
          // 不入串行队列——派发不触快照,temporal/notify.ts 内部全兜底。
          void dispatchNotify(outcome.confirmation);
          return { kind: 'suspended', entity, confirmation: outcome.confirmation };
        }

        let effectiveEvents = outcome.events;
        const decisionInstance = snapshot.instances[aliased.rel];
        const decisionFlow =
          decisionInstance === undefined
            ? undefined
            : activeDefinitionOf(snapshot, decisionInstance.flow);
        const decisionAction = decisionFlow?.nodes
          .find((node) => node.name === decisionInstance?.node)
          ?.actions.find((action) => action.name === aliased.action);
        if (decisionAction?.decision !== undefined) {
          const decision = await preflightCodingResultDecision(
            db,
            snapshot,
            aliased,
            decisionAction,
          );
          if (
            decision !== undefined &&
            (decision.decision === 'denied' || decision.decision === 'stale')
          ) {
            return persistRejection(aliased, {
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

        const artifactModel = artifactModelFor(effectiveEvents, aliased);
        const sourceInstance = snapshot.instances[aliased.rel];
        const spawnPolicyScope =
          (sourceInstance === undefined
            ? undefined
            : activeDefinitionOf(snapshot, sourceInstance.flow)?.app) ?? 'default';
        const spawnPrincipal = aliased.principal ?? 'local-user';
        const preparedNativeRuns = new Map<EngineEvent, PreparedNativeAgentDispatch>();
        for (const event of effectiveEvents) {
          if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') continue;
          const capability = snapshot.capabilities?.[event.capability];
          if (capability === undefined) continue;
          if (capability.executor?.agentDefinition !== undefined) {
            preparedNativeRuns.set(
              event,
              await prepareNativeAgentDispatch(db, {
                principal: spawnPrincipal,
                policyScope: spawnPolicyScope,
                params: aliased.params ?? {},
                capability,
              }),
            );
          } else {
            preflightCapabilityExecutor(capability);
          }
        }
        const spawned: {
          event: EngineEvent;
          seq: number;
          prepared?: PreparedNativeAgentDispatch;
        }[] = [];
        for (const event of effectiveEvents) {
          const seq = await appendWithSeq(toAppend(event));
          if (event.kind === 'spawn-requested') {
            const prepared = preparedNativeRuns.get(event);
            spawned.push({ event, seq, ...(prepared === undefined ? {} : { prepared }) });
          }
        }
        snapshot = outcome.snapshot;
        if (effectiveEvents.some((event) => event.kind === 'definition-activated')) {
          scheduleRecipesForSnapshot(snapshot);
        }
        await materializeSpawnArtifacts(effectiveEvents, aliased, artifactModel);
        for (const { event, seq, prepared } of spawned) {
          if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') continue;
          const capability = snapshot.capabilities?.[event.capability];
          if (capability?.executor === undefined) continue;
          const run =
            prepared === undefined
              ? await createAndDispatchCapabilityRun(db, {
                  sourceSeq: seq,
                  sourceRel: aliased.rel,
                  sourceAction: aliased.action,
                  principal: spawnPrincipal,
                  policyScope: spawnPolicyScope,
                  params: aliased.params ?? {},
                  capability,
                  onDoneAction: event['on-done'],
                  onErrorAction: event['on-error'],
                  baseUrl: process.env.UI4A_PUBLIC_BASE_URL ?? 'http://localhost:3100',
                })
              : await createAndDispatchAgentRun(db, {
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
              snapshot,
              gateDeps(),
            );
            if (callback.kind !== 'executed') {
              throw new Error(
                `failed capability dispatch callback rejected: ${
                  callback.kind === 'rejected' ? callback.reason : 'confirmation suspended'
                }`,
              );
            }
            for (const callbackEvent of callback.events) {
              await appendWithSeq(toAppend(callbackEvent));
            }
            snapshot = callback.snapshot;
          }
        }
        applyForeignGaps();

        // 受影响实体:append 产出新实例时返回新实体,否则返回执行实体的新投影。
        const appended = effectiveEvents[0]?.appended ?? [];
        const targetRel = appended.length > 0 ? appended[appended.length - 1]! : aliased.rel;
        const entity = project(snapshot, targetRel, projectDeps());
        if (entity === undefined) {
          throw new Error(`exec 后目标实体 "${targetRel}" 不可投影(内部不变式破坏)`);
        }
        return { kind: 'accepted', entity, appended };
      });
    },
    execPlan(steps) {
      // 单事务:整个计划一次入串行队列(与 exec 无交错;批量裁决是一个 atom)。
      return enqueue(state, async () => {
        await refreshFromLog();

        // 步级 flow 别名与 exec 同口径(flow:article-drafting → 唯一实例 rel)。
        const aliased = steps.map((step) => ({
          ...step,
          rel: resolveFlowRelAlias(step.rel, snapshot) ?? step.rel,
        }));

        const outcome = executePlan(aliased, snapshot, gateDeps());

        // 落库顺序 = 日志顺序:各步伴随事件 → 拒绝步留痕 → 批量裁决记录标记。
        for (const event of outcome.events) {
          await appendWithSeq(toAppend(event));
        }
        const rejected = outcome.results.find((result) => result.outcome === 'rejected');
        if (rejected !== undefined && rejected.rejection !== undefined) {
          const request = aliased[rejected.step - 1]!;
          await appendWithSeq({
            kind: 'action-rejected',
            rel: request.rel,
            action: request.action,
            actor: request.actor ?? 'human',
            principal: request.principal,
            channel: request.channel,
            params: paramsWithOrigins(request),
            reason: rejected.rejection.reason,
            // 与单步 exec 的 persistRejection 同源形状,另带计划步号(审计链)。
            detail: {
              layer: rejected.rejection.layer,
              judge: rejected.rejection.detail,
              plan: { step: rejected.step },
            },
          });
        }
        await appendWithSeq(toAppend(outcome.record));
        snapshot = outcome.snapshot;
        applyForeignGaps();

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
      return enqueue(state, async () => {
        await refreshFromLog();
        // 入口校验(不合法不入日志):零字面剃刀 + 词汇表词名 + concern 键一致。
        const validation = validateSpec(spec);
        if (!validation.valid) {
          const summary = validation.errors.map((error) => `${error.path}: ${error.message}`);
          throw new Error(`render spec 校验失败:\n${summary.join('\n')}`);
        }
        if (spec.concern !== concern) {
          throw new Error(
            `凝固键不一致:concern 参数 "${concern}" 与 spec.concern "${spec.concern}" 必须相同`,
          );
        }
        if (wordOf(spec.component) === undefined) {
          throw new Error(`词条 "${spec.component}" 不在渲染词汇表(目录 /api/render/catalog)`);
        }
        const by = requestedBy ?? { actor: 'agent' as const };
        // 首冻为准:已凝固直接返回(同一关注点永远同一布局,不追加事件)。
        const existing = snapshot.renderSpecs?.[concern];
        if (existing !== undefined) {
          return {
            concern,
            frozen: false,
            spec: toRenderSpec(existing),
            requestedBy: existing.requestedBy,
          };
        }
        const detail: RenderSpecFrozenDetail = {
          concern,
          spec: { concern: spec.concern, component: spec.component, bind: spec.bind },
          requestedBy: by,
        };
        // 终审 H-1:走 appendWithSeq(多写者水位铁律)——裸 appendEvent +
        // lastSeq 推进会永久跳过 INSERT 窗口内挤入的外部事件(S5 与 S3 并跑
        // 的真实窗口);appendWithSeq 把区间收进 foreignGaps,末尾补折。
        const seq = await appendWithSeq({
          kind: 'render-spec-frozen',
          rel: renderSpecRel(concern),
          actor: by.actor,
          ...(by.principal !== undefined ? { principal: by.principal } : {}),
          detail,
        });
        // 在线增量物化(与 fold 同构:同一 applyRenderSpecFrozen)。
        snapshot = fold(
          [
            {
              seq,
              kind: 'render-spec-frozen',
              rel: renderSpecRel(concern),
              actor: by.actor,
              ...(by.principal !== undefined ? { principal: by.principal } : {}),
              detail,
            },
          ],
          { flows: {} },
          snapshot,
        );
        applyForeignGaps();
        const frozen = snapshot.renderSpecs?.[concern];
        if (frozen === undefined) {
          throw new Error(`凝固后 renderSpecs 表缺 "${concern}"(内部不变式破坏)`);
        }
        return {
          concern,
          frozen: true,
          spec: toRenderSpec(frozen),
          requestedBy: frozen.requestedBy,
        };
      });
    },
    getFrozenSpec: (concern) => {
      const frozen = snapshot.renderSpecs?.[concern];
      return frozen === undefined ? undefined : toRenderSpec(frozen);
    },
    listFrozenSpecs: () => readRenderSpecsOf(snapshot),
    runExclusive: (run) =>
      enqueue(state, async () => {
        await refreshFromLog();
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
