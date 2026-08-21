/**
 * 引擎服务层:单例 engine runtime,把纯引擎(裁决/效果/投影)接到 PG 事件日志。
 *
 * - boot = ensureEventsTable + 幂等 seed(日志中无本种子标识才 append)+ fold(日志)→ 快照;
 * - exec(T3 Phase B 起)= executeWithGates:三层裁决(声明→guard→schema)→
 *   确认裁决(Cedar 策略,policy.cedar 文本驱动)→ 效果应用;
 *   - 拒绝:appendEvent(action-rejected,reason+detail{layer})不改状态;
 *   - 挂起:appendEvent(confirmation-requested,detail 含 Cedar 策略 id 与原因)
 *     + pending 确认实体物化,exec 结果 suspended(HTTP 层映射 202);
 *   - 通过:applyEffects → appendEvent(s) → 增量持有新快照(日志是真相,快照可重算);
 *   - confirmation:<id> 实体上的 approve/reject 是普通 exec 的声明动作(铁律 5:
 *     审批不委托,guard actor-is-human 在引擎层拒 agent,I4),内部路由到引擎的
 *     人类裁决入口(approveConfirmation/rejectConfirmation),留痕口径与业务动作一致;
 * - 串行化(单 atom):exec 全程(裁决+效果+落日志+换快照)经模块级 promise 队列串行,
 *   Next dev 多请求并发下无交错——"裁决器即并发控制";
 *   作用域=本进程:T3 引入 worker(第二个写者)前须收敛为单一写者或 DB 级串行化,届时记入 DECISIONS.md;
 * - 单例挂在 globalThis:Next dev 对每个 route 入口独立打包模块,普通模块级变量
 *   会得到多个实例(globalThis 是 Next 生态共享单例的标准做法);
 * - sitemap 从 flow 常量纯推导后缓存(定义不变则拓扑不变,版本号即缓存键)。
 */
import {
  approveConfirmation,
  deriveSitemap,
  executeWithGates,
  fold,
  project,
  rejectConfirmation,
  type Approver,
  type ConfirmationDecision,
  type ConfirmationDeps,
  type EngineEvent,
  type ExecRequest,
  type ExecuteDeps,
  type JudgeLayer,
  type LogEvent,
  type Sitemap,
  type SirenEntity,
  type SuspendedConfirmation,
} from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';
import type { FieldValue } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { appendEvent, ensureEventsTable, readLog, type DbExecutor, type EventAppend } from '../db/events';
import { getPool } from '../db/pool';
import { cedarPolicyFromDefaultFile } from '../domain/cedarPolicy';
import { businessFlows, businessFlowList } from '../domain/flows';
import { SEED_REL, seedDetail } from '../domain/seed';
import { resolveFlowRelAlias, withCollectionFlowEntryLinks } from './flow-entry';

/** exec 结果(discriminated union;HTTP 层据此映射 200/202/4xx)。 */
export type ExecOutcome =
  | { kind: 'accepted'; entity: SirenEntity; appended: string[] }
  | { kind: 'suspended'; entity: SirenEntity; confirmation: SuspendedConfirmation }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

export interface EngineRuntime {
  /** 当前快照(fold 或增量维护;只读视图)。 */
  getSnapshot(): EngineSnapshot;
  /** rel → Siren 实体(含 guard-results 注入);未知 rel 返回 undefined。 */
  getEntity(rel: string): SirenEntity | undefined;
  /** 应用 sitemap(缓存;版本号 = 内容 hash)。 */
  getSitemap(): Sitemap;
  /** 执行动作(串行单 atom):三层裁决 → 事件留痕 → 增量快照。 */
  exec(request: ExecRequest): Promise<ExecOutcome>;
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

async function seedIfMissing(db: DbExecutor): Promise<void> {
  const log = await readLog(db);
  const seeded = log.some((event) => event.kind === 'seed' && event.rel === SEED_REL);
  if (!seeded) {
    await appendEvent(db, { kind: 'seed', rel: SEED_REL, detail: seedDetail });
  }
}

async function bootEngine(db: DbExecutor): Promise<EngineRuntime> {
  await ensureEventsTable(db);
  await seedIfMissing(db);

  const events: LogEvent[] = await readLog(db);
  let snapshot = fold(events, { flows: businessFlows });
  const sitemap = deriveSitemap(businessFlowList, {
    extraSurfaces: [{ rel: 'comments', title: '评论', collection: true }],
  });
  const projectDeps = { flows: businessFlows, guards: seedGuardRegistry };
  // 确认门依赖:Cedar 策略在 boot 时装配一次(策略文件改动重启生效,T4 起 _meta 热更新)。
  const gateDeps: ExecuteDeps = {
    flows: businessFlows,
    guards: seedGuardRegistry,
    policy: cedarPolicyFromDefaultFile(),
  };
  const confirmDeps: ConfirmationDeps = { flows: businessFlows, guards: seedGuardRegistry };
  const state = engineState();

  /** 引擎事件 → 日志层追加形状(detail/reason 一并落库:fold 依赖 detail 重放)。 */
  const toAppend = (event: EngineEvent): EventAppend => ({
    kind: event.kind,
    rel: event.rel,
    action: event.action,
    actor: event.actor,
    principal: event.principal,
    channel: event.channel,
    params: event.params,
    detail: event.detail,
    reason: event.reason,
  });

  /** 拒绝留痕(action-rejected;detail 携带 layer,HTTP 响应与本事件同源)。 */
  const persistRejection = async (request: ExecRequest, verdict: {
    layer: JudgeLayer;
    reason: string;
    detail?: unknown;
  }): Promise<ExecOutcome> => {
    await appendEvent(db, {
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
      decision = approveConfirmation(snapshot, id, approver, confirmDeps);
    } else if (request.action === 'reject') {
      const reason = typeof request.params?.reason === 'string' ? request.params.reason : '';
      decision = rejectConfirmation(snapshot, id, approver, reason, confirmDeps);
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
      await appendEvent(db, toAppend(event));
    }
    snapshot = decision.snapshot;

    const targetRel =
      request.action === 'approve'
        ? (snapshot.confirmations?.[request.rel]?.targetRel ?? request.rel)
        : request.rel;
    const entity = project(snapshot, targetRel, projectDeps);
    if (entity === undefined) {
      throw new Error(`exec 后目标实体 "${targetRel}" 不可投影(内部不变式破坏)`);
    }
    return { kind: 'accepted', entity, appended: [] };
  };

  return {
    getSnapshot: () => snapshot,
    getEntity: (rel) => {
      // flow:<name> 别名(向导类 flow 投影为其实例实体)——纯服务层投影补全,
      // engine 的 project/judge 语义不动。alias 请求参数缺省仅影响 rel 解析。
      const target = resolveFlowRelAlias(rel, snapshot) ?? rel;
      const entity = project(snapshot, target, projectDeps);
      if (entity === undefined) return undefined;
      return withCollectionFlowEntryLinks(entity, businessFlowList);
    },
    getSitemap: () => sitemap,
    exec(request) {
      return enqueue(state, async () => {
        // exec 同样吃 flow 别名:裁决与日志都记实例 rel(不产生幽灵实体)。
        const aliased: ExecRequest = {
          ...request,
          rel: resolveFlowRelAlias(request.rel, snapshot) ?? request.rel,
        };

        // 确认实体上的动作走人类裁决入口(approve/reject;铁律 5:审批不委托)。
        if (aliased.rel.startsWith(CONFIRMATION_REL_PREFIX)) {
          return execConfirmationDecision(aliased);
        }

        const outcome = executeWithGates(aliased, snapshot, gateDeps);

        if (outcome.kind === 'rejected') {
          // 拒绝即数据(I6):不改状态,结构化原因入日志;detail 携带 layer,
          // HTTP 响应与本事件同源(同一 verdict 对象),口径必然一致。
          return persistRejection(aliased, outcome);
        }

        if (outcome.kind === 'suspended') {
          // 挂起(非拒绝):confirmation-requested 落库(detail 含 Cedar 策略 id
          // 与原因,spec 验收 5),pending 实体物化进快照,业务状态不动。
          for (const event of outcome.events) {
            await appendEvent(db, toAppend(event));
          }
          snapshot = outcome.snapshot;
          const rel = `confirmation:${outcome.confirmation.id}`;
          const entity = project(snapshot, rel, projectDeps);
          if (entity === undefined) {
            throw new Error(`挂起后确认实体 "${rel}" 不可投影(内部不变式破坏)`);
          }
          return { kind: 'suspended', entity, confirmation: outcome.confirmation };
        }

        for (const event of outcome.events) {
          await appendEvent(db, toAppend(event));
        }
        snapshot = outcome.snapshot;

        // 受影响实体:append 产出新实例时返回新实体,否则返回执行实体的新投影。
        const appended = outcome.events[0]?.appended ?? [];
        const targetRel = appended.length > 0 ? appended[appended.length - 1]! : aliased.rel;
        const entity = project(snapshot, targetRel, projectDeps);
        if (entity === undefined) {
          throw new Error(`exec 后目标实体 "${targetRel}" 不可投影(内部不变式破坏)`);
        }
        return { kind: 'accepted', entity, appended };
      });
    },
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
}
