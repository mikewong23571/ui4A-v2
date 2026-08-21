/**
 * 激活不变式检查器(T4 Phase A Task 3;arch-brief §10 A.5 种子集)。
 *
 * validateDefinition(draft, registries) → checks:六项逐条、全量报告不短路
 * (与 guard 求值同口径:每项都要有结果,checks 入 activation 实体与
 * definition-submitted 事件 detail——"非法动作被拒绝、非法定义也应被拒绝"
 * 的定义层落点)。
 *
 * 六项:edge-targets-exist / guards-registered / field-types-known /
 * effect-known / initial-exists / terminal-reachable。
 * 纯函数:只读草稿与注册表。
 */
import type { ActivationCheck, FlowDefinition, GuardRegistry } from '@ui4a/shared';
import { KNOWN_EFFECT_TYPES, KNOWN_FIELD_TYPES, reachableNodes, terminalNodes } from '@ui4a/shared';
import type { FieldType } from './types';

/** 检查器依赖的注册表(meta/registries 的运行时子集)。 */
export interface DefinitionRegistries {
  /** 谓词注册表(guards-registered 按键集校验)。 */
  guards: GuardRegistry;
  /** 已知字段类型;缺省 KNOWN_FIELD_TYPES。 */
  fieldTypes?: ReadonlySet<FieldType>;
  /** 已知效果类型;缺省 KNOWN_EFFECT_TYPES。 */
  effectTypes?: ReadonlySet<string>;
}

interface EffectLike {
  type: string;
  to?: unknown;
}

/** 动作的效果列表(单/缺省数组化,不规范化——校验看声明原样)。 */
function effectsOf(action: { effect?: unknown }): EffectLike[] {
  if (action.effect === undefined || action.effect === null) return [];
  const list = Array.isArray(action.effect) ? action.effect : [action.effect];
  return list.filter((e): e is EffectLike => typeof e === 'object' && e !== null);
}

/** 激活不变式检查器:返回六项检查结果(pass + 失败明细)。 */
export function validateDefinition(
  draft: FlowDefinition,
  registries: DefinitionRegistries,
): ActivationCheck[] {
  const fieldTypes = registries.fieldTypes ?? KNOWN_FIELD_TYPES;
  const effectTypes = registries.effectTypes ?? KNOWN_EFFECT_TYPES;
  const guardNames = new Set(Object.keys(registries.guards));
  const nodeNames = new Set(draft.nodes.map((node) => node.name));

  const edgeIssues: string[] = [];
  const guardIssues: string[] = [];
  const fieldTypeIssues: string[] = [];
  const effectIssues: string[] = [];

  // 流级字段。
  for (const field of draft.fields ?? []) {
    if (!fieldTypes.has(field.type)) {
      fieldTypeIssues.push(`fields[${field.name}]: 未知字段类型 "${String(field.type)}"`);
    }
  }

  for (const node of draft.nodes) {
    for (const field of node.fields ?? []) {
      if (!fieldTypes.has(field.type)) {
        fieldTypeIssues.push(`nodes[${node.name}].fields[${field.name}]: 未知字段类型 "${String(field.type)}"`);
      }
    }
    for (const action of node.actions) {
      const where = `nodes[${node.name}].actions[${action.name}]`;
      // 边目标:action.to 与 transition 效果的 to 都必须落在节点集。
      if (action.to !== undefined && !nodeNames.has(action.to)) {
        edgeIssues.push(`${where}.to: 目标节点 "${action.to}" 不存在`);
      }
      for (const field of action.fields ?? []) {
        if (!fieldTypes.has(field.type)) {
          fieldTypeIssues.push(`${where}.fields[${field.name}]: 未知字段类型 "${String(field.type)}"`);
        }
      }
      for (const guard of action.guards ?? []) {
        if (!guardNames.has(guard)) {
          guardIssues.push(`${where}.guards: 谓词 "${guard}" 未注册`);
        }
      }
      const effects = effectsOf(action);
      if (effects.length === 0 && action.to === undefined) {
        // 无效果的空动作合法(纯声明);无检查项。
      }
      for (const effect of effects) {
        if (!effectTypes.has(effect.type)) {
          effectIssues.push(`${where}.effect: 未知效果类型 "${String(effect.type)}"`);
          continue;
        }
        if (effect.type === 'transition') {
          const target = (effect.to ?? action.to) as string | undefined;
          if (target === undefined) {
            edgeIssues.push(`${where}.effect: transition 缺少目标`);
          } else if (!nodeNames.has(target)) {
            edgeIssues.push(`${where}.effect: 目标节点 "${target}" 不存在`);
          }
        }
      }
    }
  }

  const initialExists = nodeNames.has(draft.initial);
  const initialIssues = initialExists
    ? undefined
    : [`initial "${draft.initial}" 不在节点集`];

  const terminals = terminalNodes(draft);
  const reachable = reachableNodes(draft);
  const reachableTerminals = terminals.filter((name) => reachable.has(name));
  const terminalIssues =
    terminals.length === 0
      ? ['流程没有任何 terminal 节点(无出边节点)']
      : reachableTerminals.length === 0
        ? [`terminal(${terminals.join(', ')})均不可从 initial "${draft.initial}" 到达`]
        : undefined;

  return [
    { name: 'edge-targets-exist', pass: edgeIssues.length === 0, ...(edgeIssues.length > 0 ? { detail: edgeIssues } : {}) },
    { name: 'guards-registered', pass: guardIssues.length === 0, ...(guardIssues.length > 0 ? { detail: guardIssues } : {}) },
    { name: 'field-types-known', pass: fieldTypeIssues.length === 0, ...(fieldTypeIssues.length > 0 ? { detail: fieldTypeIssues } : {}) },
    { name: 'effect-known', pass: effectIssues.length === 0, ...(effectIssues.length > 0 ? { detail: effectIssues } : {}) },
    { name: 'initial-exists', pass: initialExists, ...(initialIssues !== undefined ? { detail: initialIssues } : {}) },
    { name: 'terminal-reachable', pass: terminalIssues === undefined, ...(terminalIssues !== undefined ? { detail: terminalIssues } : {}) },
  ];
}
