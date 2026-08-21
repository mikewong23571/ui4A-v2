/**
 * meta 执行编排(T4 Phase A):编辑动词 = 普通 exec 语义。
 *
 * executeMeta 是 definition 平面的唯一入口:
 * - 三层裁决与效果复用 executeWithGates(judge → confirmGate → applyEffects),
 *   flow 注册表恒为 lifecycle 常量(自举:编辑动词声明在 definition-lifecycle
 *   对应状态节点上,deps 不需要业务 flow);
 * - 裁决通过后按动词补充定义平面语义(revise/deprecate 的条目落态)并追加
 *   定义事件(definition-edited/-revised/-deprecated;submit/approve/reject
 *   见 Task 3/4);
 * - 拒绝结果原样透传(layer/reason 结构与业务拒绝同构,拒绝即数据 I6,
 *   由调用方入日志)。
 *
 * 纯函数:输入请求 + 快照 → 新快照 + 待追加事件(顺序即日志顺序)。
 * definition-seeded(boot 种子事件)的工厂也在本模块:Phase B 的迁移器与
 * 测试共用同一形状。
 */
import type {
  DefinitionEntry,
  DefinitionStatus,
  EngineSnapshot,
  FlowDefinition,
  GuardRegistry,
} from '@ui4a/shared';
import { flowNameFromMetaRel, metaFlowRel } from '@ui4a/shared';

import type { EngineEvent } from './effects';
import { executeWithGates } from './execute';
import type { ExecWithGatesOutcome } from './execute';
import type { ExecRequest } from './judge';
import { DEFINITION_LIFECYCLE, DEFINITION_LIFECYCLE_FLOW } from './lifecycle';
import type { LogEvent } from './fold';

/** meta 编排依赖:谓词注册表 + 确认策略(可选;修订动词无 requires-confirmation)。 */
export interface MetaDeps {
  guards: GuardRegistry;
  policy?: Parameters<typeof executeWithGates>[2]['policy'];
}

/** meta exec 结果(与业务 exec 同构:executed / suspended / rejected)。 */
export type MetaOutcome = ExecWithGatesOutcome;

// ---------------------------------------------------------------------------
// definition-seeded(boot 种子事件工厂;日志层事件,fold 落 definitions 表)
// ---------------------------------------------------------------------------

/** definition-seeded 事件的 detail 载荷(机器可重放:定义全文入日志)。 */
export interface DefinitionSeededDetail {
  name: string;
  version: number;
  status: DefinitionStatus;
  definition: FlowDefinition;
}

/**
 * 构造 definition-seeded 事件(boot 时日志无定义 → 种子定义事件;
 * Phase B 迁移器与测试共用)。缺省 version=1、status=active。
 */
export function definitionSeedEvent(
  seq: number,
  flow: FlowDefinition,
  options?: { version?: number; status?: DefinitionStatus },
): LogEvent {
  return {
    seq,
    kind: 'definition-seeded',
    rel: metaFlowRel(flow.name),
    detail: {
      name: flow.name,
      version: options?.version ?? 1,
      status: options?.status ?? 'active',
      definition: flow,
    } satisfies DefinitionSeededDetail,
  };
}

// ---------------------------------------------------------------------------
// 定义事件 detail 载荷
// ---------------------------------------------------------------------------

/** definition-edited(伴随事件:审计用;状态由同批 action-executed 重放)。 */
export interface DefinitionEditedDetail {
  name: string;
  op: string;
  params: Record<string, unknown>;
}

/** definition-revised(active → draft;版本号在 approve 时落实)。 */
export interface DefinitionRevisedDetail {
  name: string;
  /** 草稿派生自的活跃版本。 */
  bornBy: number;
  /** 修订时的活跃版本(= bornBy)。 */
  version: number;
}

/** definition-deprecated。 */
export interface DefinitionDeprecatedDetail {
  name: string;
  version: number;
}

// ---------------------------------------------------------------------------
// executeMeta
// ---------------------------------------------------------------------------

function definitionEvent(
  request: ExecRequest,
  kind: EngineEvent['kind'],
  detail: unknown,
): EngineEvent {
  return {
    kind,
    rel: request.rel,
    action: request.action,
    actor: request.actor ?? 'human',
    principal: request.principal,
    channel: request.channel,
    detail,
  };
}

/** 定位 lifecycle 实例对应的 definitions 条目(缺任一 → undefined)。 */
function entryOf(
  snapshot: EngineSnapshot,
  flowName: string,
): DefinitionEntry | undefined {
  return snapshot.definitions?.[flowName];
}

function withEntry(
  snapshot: EngineSnapshot,
  flowName: string,
  patch: (entry: DefinitionEntry) => DefinitionEntry,
): EngineSnapshot {
  const entry = entryOf(snapshot, flowName);
  if (entry === undefined) {
    throw new Error(`definitions 表缺少 "${flowName}"(引擎内部一致性)`);
  }
  return {
    ...snapshot,
    definitions: { ...snapshot.definitions, [flowName]: patch(entry) },
  };
}

/**
 * meta exec 主入口(编辑动词 + 生命周期动词)。
 *
 * Task 2 覆盖:add-node / add-action(applyEffects 的 meta-edit 已改工作副本,
 * 此处补伴随事件 definition-edited)、revise、deprecate。
 * submit(不变式校验)与 approve/reject 见 meta 模块后续任务。
 */
export function executeMeta(
  request: ExecRequest,
  snapshot: EngineSnapshot,
  deps: MetaDeps,
): MetaOutcome {
  const verdict = executeWithGates(request, snapshot, {
    flows: { [DEFINITION_LIFECYCLE]: DEFINITION_LIFECYCLE_FLOW },
    guards: deps.guards,
    ...(deps.policy !== undefined ? { policy: deps.policy } : {}),
  });
  if (verdict.kind !== 'executed') {
    return verdict;
  }

  const flowName = flowNameFromMetaRel(request.rel);
  if (flowName === undefined) return verdict;
  if (entryOf(verdict.snapshot, flowName) === undefined) return verdict;

  if (request.action === 'add-node' || request.action === 'add-action') {
    const detail: DefinitionEditedDetail = {
      name: flowName,
      op: request.action,
      params: { ...(request.params ?? {}) },
    };
    return {
      ...verdict,
      events: [...verdict.events, definitionEvent(request, 'definition-edited', detail)],
    };
  }

  if (request.action === 'revise') {
    const entry = entryOf(verdict.snapshot, flowName)!;
    const detail: DefinitionRevisedDetail = {
      name: flowName,
      bornBy: entry.version,
      version: entry.version,
    };
    return {
      kind: 'executed',
      snapshot: withEntry(verdict.snapshot, flowName, (current) => ({
        ...current,
        status: 'draft',
        bornBy: current.version,
      })),
      events: [...verdict.events, definitionEvent(request, 'definition-revised', detail)],
    };
  }

  if (request.action === 'deprecate') {
    const entry = entryOf(verdict.snapshot, flowName)!;
    const detail: DefinitionDeprecatedDetail = { name: flowName, version: entry.version };
    return {
      kind: 'executed',
      snapshot: withEntry(verdict.snapshot, flowName, (current) => ({
        ...current,
        status: 'deprecated',
      })),
      events: [...verdict.events, definitionEvent(request, 'definition-deprecated', detail)],
    };
  }

  // submit / approve / reject:Task 3/4 接管(此处到达时仅转移已发生)。
  return verdict;
}
