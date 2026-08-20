/**
 * 引擎服务层:单例 engine runtime,把纯引擎(裁决/效果/投影)接到 PG 事件日志。
 *
 * - boot = ensureEventsTable + 幂等 seed(日志中无本种子标识才 append)+ fold(日志)→ 快照;
 * - exec = judge → 拒绝:appendEvent(action-rejected,reason+detail{layer})不改状态;
 *   通过:applyEffects → appendEvent(s) → 增量持有新快照(日志是真相,快照可重算);
 * - 串行化(单 atom):exec 全程(judge+效果+落日志+换快照)经模块级 promise 队列串行,
 *   Next dev 多请求并发下无交错——"裁决器即并发控制";
 * - 单例挂在 globalThis:Next dev 对每个 route 入口独立打包模块,普通模块级变量
 *   会得到多个实例(globalThis 是 Next 生态共享单例的标准做法);
 * - sitemap 从 flow 常量纯推导后缓存(定义不变则拓扑不变,版本号即缓存键)。
 */
import {
  applyEffects,
  deriveSitemap,
  fold,
  judge,
  project,
  type ExecRequest,
  type JudgeLayer,
  type LogEvent,
  type Sitemap,
  type SirenEntity,
} from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';
import type { FieldValue } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { appendEvent, ensureEventsTable, readLog, type DbExecutor } from '../db/events';
import { getPool } from '../db/pool';
import { businessFlows, businessFlowList } from '../domain/flows';
import { SEED_REL, seedDetail } from '../domain/seed';
import { resolveFlowRelAlias, withCollectionFlowEntryLinks } from './flow-entry';

/** exec 结果(discriminated union;HTTP 层据此映射 200/4xx)。 */
export type ExecOutcome =
  | { kind: 'accepted'; entity: SirenEntity; appended: string[] }
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
  const judgeDeps = { flows: businessFlows, guards: seedGuardRegistry };
  const state = engineState();

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
        const verdict = judge(aliased, snapshot, judgeDeps);

        if (verdict.kind === 'rejected') {
          // 拒绝即数据(I6):不改状态,结构化原因入日志;detail 携带 layer,
          // HTTP 响应与本事件同源(同一 verdict 对象),口径必然一致。
          await appendEvent(db, {
            kind: 'action-rejected',
            rel: aliased.rel,
            action: aliased.action,
            actor: aliased.actor ?? 'human',
            principal: aliased.principal,
            channel: aliased.channel,
            params: paramsWithOrigins(aliased),
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
        }

        const outcome = applyEffects(aliased, verdict.effects, snapshot, {
          flows: businessFlows,
        });
        for (const event of outcome.events) {
          await appendEvent(db, {
            kind: event.kind,
            rel: event.rel,
            action: event.action,
            actor: event.actor,
            principal: event.principal,
            channel: event.channel,
            params: event.params,
          });
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
