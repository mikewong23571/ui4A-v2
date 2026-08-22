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
  ActivationSnapshot,
  DefinitionEntry,
  DefinitionStatus,
  EngineSnapshot,
  FlowDefinition,
  GuardRegistry,
} from '@ui4a/shared';
import { flowNameFromMetaRel, metaFlowRel, metaActivationRel } from '@ui4a/shared';

import type { EngineEvent } from './effects';
import { definitionDiff } from './definition-diff';
import { executeWithGates } from './execute';
import type { ExecWithGatesOutcome } from './execute';
import type { ExecRequest } from './judge';
import { DEFINITION_LIFECYCLE, DEFINITION_LIFECYCLE_FLOW } from './lifecycle';
import type { LogEvent } from './fold';
import { validateDefinition, type DefinitionRegistries } from './invariants';
import { contentVersion } from './sitemap';

/** meta 编排依赖:谓词注册表 + 确认策略(可选;修订动词无 requires-confirmation)。 */
export interface MetaDeps {
  guards: GuardRegistry;
  policy?: Parameters<typeof executeWithGates>[2]['policy'];
  /** 激活不变式的注册表(字段/效果类型覆盖);guards 复用本 deps 的注册表。 */
  fieldTypes?: DefinitionRegistries['fieldTypes'];
  effectTypes?: DefinitionRegistries['effectTypes'];
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

/** definition-activated:approve 的落态事件(sitemap 重生成信号;机器可重放)。 */
export interface DefinitionActivatedDetail {
  name: string;
  /** 激活落实的新版本(此前为草稿目标版本)。 */
  version: number;
  /** 被批准的激活实体 id(approve 也可经 meta/activation:<id> 发起)。 */
  activationId: string;
  /** 激活后的定义全文(活跃定义 = 草稿内容)。 */
  definition: FlowDefinition;
  decidedBy: { actor: 'human' | 'agent'; principal?: string };
}

/** definition-rejected:人类驳回(reason 必填,入日志)。 */
export interface DefinitionRejectedDetail {
  name: string;
  activationId: string;
  decidedBy: { actor: 'human' | 'agent'; principal?: string };
  reason: string;
}

/**
 * definition-submitted:submit 后立即求值八项不变式的落态事件
 * (checks-pass → pending-approval + activation 物化;checks-fail → 回 draft,
 * 校验报告即 checks 中的失败项——A.4 原样)。
 */
export interface DefinitionSubmittedDetail {
  name: string;
  passed: boolean;
  checks: ActivationSnapshot['checks'];
  /** checks 全过时的激活载荷(fold 据此物化 activation 实体,载荷即真相)。 */
  activation?: {
    id: string;
    flow: string;
    version: number;
    artifact: string;
    definition: FlowDefinition;
    /** 机械 diff 纯数据(submit 时引擎侧算好;fold 从载荷还原,不重算)。 */
    diff?: ActivationSnapshot['diff'];
    requestedBy: ActivationSnapshot['requestedBy'];
  };
}

// ---------------------------------------------------------------------------
// 活跃定义解析(定义历史指针;Task 1)
// ---------------------------------------------------------------------------

/**
 * flow 的活跃定义:definitionVersions[条目当前版本](最后激活的内容)。
 *
 * 条目 definition 在草稿窗口是工作副本(revise 后被编辑动词改写),不是活跃
 * 内容——活跃内容只随 approve 移动指针。历史缺项(老日志/测试 fixture)回退
 * 条目 definition(seed 后未编辑时二者同文)。供 web 服务层组装 flows 注册表
 * (业务 exec/judge/project/sitemap 的唯一来源,fold 快照即真相)。
 */
export function activeDefinitionOf(
  snapshot: EngineSnapshot,
  flowName: string,
): FlowDefinition | undefined {
  const entry = snapshot.definitions?.[flowName];
  if (entry === undefined) return undefined;
  return snapshot.definitionVersions?.[flowName]?.[entry.version] ?? entry.definition;
}

// ---------------------------------------------------------------------------
// executeMeta
// ---------------------------------------------------------------------------

/** 激活 id 分配:确定性计数 a1/a2/…(与 confirmation c1/c2 同构)。 */
export function nextActivationId(activations: Readonly<Record<string, unknown>>): string {
  let counter = Object.keys(activations).length + 1;
  while (activations[metaActivationRel(`a${counter}`)] !== undefined) {
    counter += 1;
  }
  return `a${counter}`;
}

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
function entryOf(snapshot: EngineSnapshot, flowName: string): DefinitionEntry | undefined {
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
 * 覆盖:add-node / add-action(applyEffects 的 meta-edit 已改工作副本,此处补
 * 伴随事件 definition-edited)、revise、deprecate、submit(八项不变式 + activation
 * 物化/checks-fail 回 draft)、approve / reject(actor-is-human 铁律 5;可经
 * meta/flow:<name> 或 meta/activation:<id> 发起——A.2 把 approve/reject 挂在
 * 激活实体上,裁决仍是 lifecycle 实例同一套三层)。
 */
export function executeMeta(
  request: ExecRequest,
  snapshot: EngineSnapshot,
  deps: MetaDeps,
): MetaOutcome {
  // activation rel 归一化:审批动作的声明与 guard 在 lifecycle 实例上
  // (同一谓词的两个投影——激活实体投影挂的是同一批声明的镜像)。
  const activation = activationTargetOf(request, snapshot);
  const judgeRequest: ExecRequest =
    activation !== undefined ? { ...request, rel: metaFlowRel(activation.flow) } : request;

  const verdict = executeWithGates(judgeRequest, snapshot, {
    flows: { [DEFINITION_LIFECYCLE]: DEFINITION_LIFECYCLE_FLOW },
    guards: deps.guards,
    ...(deps.policy !== undefined ? { policy: deps.policy } : {}),
  });
  if (verdict.kind !== 'executed') {
    return verdict;
  }

  const flowName = flowNameFromMetaRel(judgeRequest.rel);
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

  if (request.action === 'submit') {
    // A.4:draft --submit--> validating,引擎内立即求值八项不变式并落态
    // (validating 是瞬态,不持久化)。checks 全过 → pending-approval +
    // activation 实体;有 fail → 回 draft(校验报告入事件)。
    const entry = entryOf(verdict.snapshot, flowName)!;
    // app-known(T10)注册表 = 快照 applications 表的键集(已激活 app 名)。
    // 该表是 Phase B(boot seed/fold 落表)产物:不存在 → 不传
    // (过渡期 app-known vacuous pass);存在 → 键集即已激活集合。
    // applyEffects 已随行该表(仅在场时携带,见 effects.ts),故读
    // verdict.snapshot 与读输入快照等价,与 entry 取数口径一致。
    const applications =
      verdict.snapshot.applications === undefined
        ? undefined
        : new Set(Object.keys(verdict.snapshot.applications));
    // capability-registered(T13)注册表 = 快照 capabilities 表的键集(已注册
    // capability 名),与 applications 同口径:Phase C 落表产物,不存在 →
    // 不传(过渡期 vacuous pass);存在 → 键集即已注册集合。applyEffects
    // 同样随行该表(仅在场时携带,见 effects.ts)。
    const capabilities =
      verdict.snapshot.capabilities === undefined
        ? undefined
        : new Set(Object.keys(verdict.snapshot.capabilities));
    const checks = validateDefinition(entry.definition, {
      guards: deps.guards,
      ...(deps.fieldTypes !== undefined ? { fieldTypes: deps.fieldTypes } : {}),
      ...(deps.effectTypes !== undefined ? { effectTypes: deps.effectTypes } : {}),
      ...(applications !== undefined ? { applications } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
    });
    const passed = checks.every((check) => check.pass);
    const detail: DefinitionSubmittedDetail = { name: flowName, passed, checks };

    let snapshot = verdict.snapshot;
    if (passed) {
      const activations = snapshot.activations ?? {};
      const id = nextActivationId(activations);
      // 机械 diff(铁律 5):基线 = 提交时的活跃定义(草稿窗口的工作副本不是
      // 活跃内容,activeDefinitionOf 按版本历史取),候选 = 草稿全文。
      // diff 由引擎(非提交者、非渲染器)算好冻结进 activation 与事件载荷。
      const before = activeDefinitionOf(snapshot, flowName) ?? entry.definition;
      const diff = definitionDiff(before, entry.definition);
      const activation: ActivationSnapshot = {
        id,
        flow: flowName,
        status: 'pending-approval',
        version: entry.version + 1,
        artifact: contentVersion(entry.definition),
        checks,
        definition: entry.definition,
        diff,
        requestedBy: {
          actor: request.actor ?? 'human',
          ...(request.principal !== undefined ? { principal: request.principal } : {}),
        },
      };
      detail.activation = {
        id,
        flow: flowName,
        version: activation.version,
        artifact: activation.artifact,
        definition: entry.definition,
        diff,
        requestedBy: activation.requestedBy,
      };
      snapshot = {
        ...snapshot,
        instances: {
          ...snapshot.instances,
          [request.rel]: { ...snapshot.instances[request.rel]!, node: 'pending-approval' },
        },
        definitions: {
          ...snapshot.definitions,
          [flowName]: { ...entry, status: 'pending-approval' },
        },
        activations: { ...activations, [metaActivationRel(id)]: activation },
      };
    } else {
      // checks-fail → 回 draft(validating --checks-fail--> draft 附校验报告)。
      snapshot = {
        ...snapshot,
        instances: {
          ...snapshot.instances,
          [request.rel]: { ...snapshot.instances[request.rel]!, node: 'draft' },
        },
        definitions: {
          ...snapshot.definitions,
          [flowName]: { ...entry, status: 'draft' },
        },
      };
    }
    return {
      kind: 'executed',
      snapshot,
      events: [...verdict.events, definitionEvent(request, 'definition-submitted', detail)],
    };
  }

  if (request.action === 'approve' || request.action === 'reject') {
    if (activation === undefined) {
      // approve/reject 也可直接打在 flow rel 上:按"该 flow 的 pending 激活"定位。
      const pending = Object.values(verdict.snapshot.activations ?? {}).find(
        (candidate) => candidate.flow === flowName && candidate.status === 'pending-approval',
      );
      if (pending === undefined) return verdict; // 理论不可达:judge 已要求 pending-approval 节点
      return decide(verdict, request, judgeRequest, flowName, pending);
    }
    return decide(verdict, request, judgeRequest, flowName, activation);
  }

  return verdict;
}

/** 审批落态:approve → active+version+1+definition-activated;reject → rejected。 */
function decide(
  verdict: Extract<MetaOutcome, { kind: 'executed' }>,
  request: ExecRequest,
  judgeRequest: ExecRequest,
  flowName: string,
  activation: ActivationSnapshot,
): { kind: 'executed'; snapshot: EngineSnapshot; events: EngineEvent[] } {
  const entry = entryOf(verdict.snapshot, flowName)!;
  const decidedBy: { actor: 'human' | 'agent'; principal?: string } = {
    actor: request.actor ?? 'human',
    ...(request.principal !== undefined ? { principal: request.principal } : {}),
  };
  const activations = {
    ...(verdict.snapshot.activations ?? {}),
    [metaActivationRel(activation.id)]:
      request.action === 'approve'
        ? { ...activation, status: 'approved' as const, approvedBy: decidedBy }
        : {
            ...activation,
            status: 'rejected' as const,
            rejectedReason: String(request.params?.reason ?? ''),
          },
  };

  if (request.action === 'approve') {
    if (activation.version !== entry.version + 1) {
      throw new Error(
        `approve 一致性:激活 ${activation.id} 目标版本 ${activation.version} ≠ 当前版本+1(${entry.version + 1})`,
      );
    }
    const detail: DefinitionActivatedDetail = {
      name: flowName,
      version: activation.version,
      activationId: activation.id,
      definition: activation.definition,
      decidedBy,
    };
    return {
      kind: 'executed',
      snapshot: {
        ...verdict.snapshot,
        definitions: {
          ...verdict.snapshot.definitions,
          [flowName]: {
            ...entry,
            status: 'active',
            version: activation.version,
            definition: activation.definition,
          },
        },
        // 版本历史沉淀:旧版本保留供在途实例按出生版本回取(仅指针移动)。
        definitionVersions: {
          ...(verdict.snapshot.definitionVersions ?? {}),
          [flowName]: {
            ...(verdict.snapshot.definitionVersions?.[flowName] ?? {}),
            [activation.version]: activation.definition,
          },
        },
        activations,
      },
      events: [...verdict.events, definitionEvent(judgeRequest, 'definition-activated', detail)],
    };
  }

  const reason = String(request.params?.reason ?? '');
  const detail: DefinitionRejectedDetail = {
    name: flowName,
    activationId: activation.id,
    decidedBy,
    reason,
  };
  return {
    kind: 'executed',
    snapshot: {
      ...verdict.snapshot,
      definitions: {
        ...verdict.snapshot.definitions,
        [flowName]: { ...entry, status: 'rejected' },
      },
      activations,
    },
    events: [
      ...verdict.events,
      { ...definitionEvent(judgeRequest, 'definition-rejected', detail), reason },
    ],
  };
}

/**
 * activation rel 解析:meta/activation:<id> 且 pending → 返回激活快照
 * (非 pending 的激活是审计实体,approve/reject 未声明于该状态 → undeclared)。
 */
function activationTargetOf(
  request: ExecRequest,
  snapshot: EngineSnapshot,
): ActivationSnapshot | undefined {
  if (!request.rel.startsWith('meta/activation:')) return undefined;
  const activation = snapshot.activations?.[request.rel];
  if (activation === undefined || activation.status !== 'pending-approval') return undefined;
  return activation;
}
