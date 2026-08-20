/**
 * 三层裁决器(arch-brief §3,顺序铁律不可换):
 *   ① action 是否声明于当前节点 → ② guard 谓词 → ③ 字段 schema(Ajv draft-07)。
 *
 * judge 是纯函数:读快照、不落日志、不改状态;
 * 拒绝结果携带结构化原因(拒绝即数据,I6),由调用方(HTTP 层/日志层)留痕。
 */
import Ajv from 'ajv';

import type { GuardEvaluation, GuardRegistry, EngineSnapshot } from '@ui4a/shared';

import { actionEffects } from './parse';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from './schema';
import type { ActionDefinition, EffectDefinition, FlowDefinition, ParamOrigin } from './types';

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
    }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

/** judge 依赖:flow 注册表(须为 parseFlowDefinition 规范化后的定义)+ 谓词注册表。 */
export interface JudgeDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
  guards: GuardRegistry;
}

function reject(layer: JudgeLayer, reason: string, detail?: unknown): JudgeResult {
  return detail === undefined
    ? { kind: 'rejected', layer, reason }
    : { kind: 'rejected', layer, reason, detail };
}

/**
 * 求值动作的全部 guard(不短路:每个谓词都要有结果,供 guard-results 逐项注入)。
 * 注册表缺名或谓词抛错均 fail-closed(pass=false + reason)。
 */
export function evaluateGuards(
  action: ActionDefinition,
  instance: EngineSnapshot['instances'][string],
  snapshot: EngineSnapshot,
  params: Readonly<Record<string, unknown>>,
  guards: GuardRegistry,
): GuardEvaluation[] {
  return (action.guards ?? []).map((name) => {
    const predicate = guards[name];
    if (predicate === undefined) {
      return { name, pass: false, reason: `guard "${name}" 未注册` };
    }
    try {
      return { name, pass: predicate({ instance, snapshot, params }) };
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
  const flow = deps.flows[instance.flow];
  if (flow === undefined) {
    return reject('undeclared', `实体 "${request.rel}" 所属流程 "${instance.flow}" 未注册`);
  }
  const node = flow.nodes.find((candidate) => candidate.name === instance.node);
  if (node === undefined) {
    return reject(
      'undeclared',
      `节点 "${instance.node}" 不在流程 "${flow.name}" 的节点集中`,
    );
  }
  const action = node.actions.find((candidate) => candidate.name === request.action);
  if (action === undefined) {
    return reject(
      'undeclared',
      `动作 "${request.action}" 未声明于节点 "${node.name}"(流程 "${flow.name}")`,
    );
  }

  // ② guard 层:全部求值,任一 false 即拒,原因含谓词名与求值结果。
  const params = request.params ?? {};
  const guardResults = evaluateGuards(action, instance, snapshot, params, deps.guards);
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

  return { kind: 'accepted', action, effects: actionEffects(action), schema };
}
