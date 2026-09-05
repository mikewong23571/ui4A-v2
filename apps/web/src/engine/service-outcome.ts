/**
 * service 契约类型叶子模块(T55/D76 解环):ExecOutcome/PlanServiceOutcome/
 * EngineRuntime 的类型定义自 service.ts 迁出,零反向依赖 service.ts——
 * service-confirmation/service-thread 与 drafts 族此前以
 * `import type { ... } from './service'` 反指 hub,形成 madge 环(基线 8 环中
 * 7 个 service 相关)。接口形状与本迁移前逐字一致(EngineRuntime 不强拆,
 * 仅位置下沉);service.ts 保留 re-export 作为 hub 公共面。
 */
import type {
  ExecRequest,
  RawCollectionQuery,
  SirenEntity,
  Sitemap,
  SuspendedConfirmation,
  JudgeLayer,
  PlanStepResult,
} from '@ui4a/engine';
import type { EngineSnapshot, FrozenRenderSpec } from '@ui4a/shared';

import type { RenderSpec } from '../render/spec';
import type { FreezeSpecResult } from './service-render-specs';
import type { MetaSitemap } from './service-sitemaps';

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

export interface EngineRuntime {
  /** 当前内存快照(boot/exec/增量 fold 维护;只读视图,不触库——需外部写者进度用 readSnapshot)。 */
  getSnapshot(): EngineSnapshot;
  /** 读路径快照:先增量 fold worker 等外部写者追加的事件,再返回(spec 决定 4)。 */
  readSnapshot(): Promise<EngineSnapshot>;
  /**
   * rel → Siren 实体(含 guard-results 注入);返回前增量 fold 新事件;未知 rel 返回 undefined。
   * rawQuery(T38 集合读面查询):分页/过滤原始参数,经引擎解析与目标裁决后
   * 驱动成员集合切片;不带参数 = 全量;非法参数/非成员集合目标抛 CollectionQueryError。
   */
  getEntity(rel: string, rawQuery?: RawCollectionQuery): Promise<SirenEntity | undefined>;
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
