/**
 * 三层裁决器(arch-brief §3,顺序铁律不可换):
 *   ① action 是否声明于当前节点 → ② guard 谓词 → ③ 字段 schema(Ajv draft-07)。
 *
 * judge 是纯函数:读快照、不落日志、不改状态;
 * 拒绝结果携带结构化原因(拒绝即数据,I6),由调用方(HTTP 层/日志层)留痕。
 */
import Ajv from 'ajv';

import type {
  AgentCredentialSource,
  GuardEvaluation,
  GuardRegistry,
  EngineSnapshot,
} from '@ui4a/shared';

import { actionEffects } from '../core/parse';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from '../contract/schema';
import type {
  ActionDefinition,
  EffectDefinition,
  FlowDefinition,
  ParamOrigin,
} from '../core/types';

/** Verified request identity provenance. It is audit-only and never participates in judgment. */
export interface RequestIdentityAudit {
  authorizationMode: 'credential' | 'self-reported-local-demo';
  scopes: string[];
  /** Server-resolved Application scope; audit-only and never an authorization input here. */
  policyScope?: string;
  humanApprovalEligible: boolean;
  delegation?: {
    subject: string;
    actorClientId: string;
    source: AgentCredentialSource;
  };
}

/** exec 请求(事件日志字段的镜像:actor/principal/channel/参数出处)。 */
export interface ExecRequest {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
  /** 每个参数的出处;缺省按 intent 记。 */
  paramOrigins?: Record<string, ParamOrigin>;
  actor?: 'human' | 'agent';
  principal?: string;
  channel?: string;
  /** Trusted HTTP-boundary provenance; deliberately excluded from declaration/guard/schema. */
  identity?: RequestIdentityAudit;
  /** Set only by a deployment-authenticated capability callback composition. */
  trustedIngress?: 'capability-callback';
  /**
   * 上游机械 effect gate 已核验的用户原话索引。引擎不据此放行动作；它只随
   * 裁决事件留痕，审计投影会再次对 append-only user message 做引用校验。
   */
  authorization?: { sourceMessageId: string; quote: string };
}

export type JudgeLayer = 'undeclared' | 'guard-failed' | 'schema-invalid';

/** 裁决结果(discriminated union)。 */
export type JudgeResult =
  | {
      kind: 'accepted';
      /** 通过裁决的动作声明(确认门读 requires-confirmation 标注)。 */
      action: ActionDefinition;
      effects: EffectDefinition[];
      schema: Record<string, unknown>;
      /** 已按声明顺序求值且全部通过的 guard 结果，供成功审计留痕。 */
      guards: GuardEvaluation[];
    }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

/** judge 依赖:flow 注册表(须为 parseFlowDefinition 规范化后的定义)+ 谓词注册表。 */
export interface JudgeDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
  guards: GuardRegistry;
  /**
   * 按出生版本解析的注册表(T4 Phase B):flow → 版本 → 定义全文。
   * 实例带 bornVersion 且命中时优先于 flows(在途实例按出生定义走完);
   * 缺省/未命中回退 flows 活跃注册表(与既有语义一致)。
   */
  versions?: DefinitionVersionTable;
}

/** 定义版本注册表形状(flow 名 → 版本号 → 定义全文)。 */
export type DefinitionVersionTable = Readonly<
  Record<string, Readonly<Record<number, FlowDefinition>>>
>;

/**
 * 实例的定义解析(T4 Phase B):出生版本优先,活跃注册表兜底。
 * judge / Siren 投影 / transition 校验 / 确认门生效共用同一口径——
 * 同一实例在任何裁决/投影路径下看到同一份定义。
 */
export function flowForInstance(
  deps: { flows: Readonly<Record<string, FlowDefinition>>; versions?: DefinitionVersionTable },
  instance: { flow: string; bornVersion?: number },
): FlowDefinition | undefined {
  if (instance.bornVersion !== undefined && deps.versions !== undefined) {
    const born = deps.versions[instance.flow]?.[instance.bornVersion];
    if (born !== undefined) return born;
  }
  return deps.flows[instance.flow];
}

function reject(layer: JudgeLayer, reason: string, detail?: unknown): JudgeResult {
  return detail === undefined
    ? { kind: 'rejected', layer, reason }
    : { kind: 'rejected', layer, reason, detail };
}

/**
 * 求值动作的全部 guard(不短路:每个谓词都要有结果,供 guard-results 逐项注入)。
 * 注册表缺名或谓词抛错均 fail-closed(pass=false + reason)。
 * actor 为 T3 扩展:exec 裁决时传入(actor-is-human 读它);投影求值可缺省。
 * knownGuards 为 T4 扩展:注册表键集注入上下文(guards-registered 读它)。
 */
export function evaluateGuards(
  action: ActionDefinition,
  instance: EngineSnapshot['instances'][string],
  snapshot: EngineSnapshot,
  params: Readonly<Record<string, unknown>>,
  guards: GuardRegistry,
  actor?: 'human' | 'agent',
  principal?: string,
): GuardEvaluation[] {
  const knownGuards = new Set(Object.keys(guards));
  return (action.guards ?? []).map((name) => {
    const predicate = guards[name];
    if (predicate === undefined) {
      return { name, pass: false, reason: `guard "${name}" 未注册` };
    }
    try {
      return {
        name,
        pass: predicate({ instance, snapshot, params, action, actor, principal, knownGuards }),
      };
    } catch (error) {
      return {
        name,
        pass: false,
        reason: `guard "${name}" 求值异常: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
}

/** 三层裁决主入口。 */
export function judge(
  request: ExecRequest,
  snapshot: EngineSnapshot,
  deps: JudgeDeps,
): JudgeResult {
  // ① 声明层:action 声明于当前节点(实体/流程/节点/动作任一缺失同为 undeclared)。
  const instance = snapshot.instances[request.rel];
  if (instance === undefined) {
    return reject('undeclared', `实体 "${request.rel}" 不存在`);
  }
  const flow = flowForInstance(deps, instance);
  if (flow === undefined) {
    return reject('undeclared', `实体 "${request.rel}" 所属流程 "${instance.flow}" 未注册`);
  }
  const node = flow.nodes.find((candidate) => candidate.name === instance.node);
  if (node === undefined) {
    return reject('undeclared', `节点 "${instance.node}" 不在流程 "${flow.name}" 的节点集中`);
  }
  const action = node.actions.find((candidate) => candidate.name === request.action);
  if (action === undefined) {
    return reject(
      'undeclared',
      `动作 "${request.action}" 未声明于节点 "${node.name}"(流程 "${flow.name}")`,
    );
  }
  if (action.internal === 'capability-callback' && request.trustedIngress !== action.internal) {
    return reject('undeclared', `动作 "${request.action}" 未声明于公开合同(流程 "${flow.name}")`);
  }

  // ② guard 层:全部求值,任一 false 即拒,原因含谓词名与求值结果。
  const params = request.params ?? {};
  const guardResults = evaluateGuards(
    action,
    instance,
    snapshot,
    params,
    deps.guards,
    request.actor,
    request.principal,
  );
  const failed = guardResults.filter((result) => !result.pass);
  if (failed.length > 0) {
    const summary = failed.map((result) => `${result.name}=false`).join(', ');
    return reject('guard-failed', `guard 不满足: ${summary}`, guardResults);
  }

  // ③ schema 层:参数过 字段 schema(节点字段 ∪ 动作字段;Ajv draft-07,严格拒绝多余参数)。
  const schema = fieldDefinitionsToJsonSchema(
    mergeFieldDefinitions(node.fields ?? [], action.fields ?? []),
  );
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(params)) {
    return reject('schema-invalid', '参数不符合动作字段 schema', validate.errors);
  }

  return { kind: 'accepted', action, effects: actionEffects(action), schema, guards: guardResults };
}
