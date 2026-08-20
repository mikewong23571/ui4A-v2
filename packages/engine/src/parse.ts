/**
 * flow 定义的解析与校验("machine-as-JSON 的解析")。
 *
 * 结构校验(unknown → FlowDefinition)+ 语义校验(节点存在性/唯一性/引用完整性)
 * + 规范化(默认值补齐:method=POST、guards=[]、fields=[]、effect 数组化)。
 * T4 的 meta 平台激活不变式(edge-targets-exist 等)在本层之上叠加。
 */
import type {
  ActionDefinition,
  EffectDefinition,
  FieldDefinition,
  FieldType,
  FlowDefinition,
  NodeDefinition,
} from './types';

/** 校验问题(结构化,供激活 guard 与日志留痕)。 */
export interface FlowIssue {
  path: string;
  message: string;
}

/** 已知字段类型注册表(将来由 meta/registries 扩展)。 */
const FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  'text',
  'textarea',
  'select',
  'number',
  'boolean',
  'date',
]);

const EFFECT_TYPES: ReadonlySet<string> = new Set(['transition', 'set-field', 'append', 'spawn']);

/** 解析失败:携带全部 issues(一次性报告,便于定义编辑流展示)。 */
export class FlowParseError extends Error {
  readonly issues: FlowIssue[];

  constructor(issues: FlowIssue[]) {
    super(`非法 flow 定义:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'FlowParseError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 结构校验:形状对不对(字段类型级)。 */
function structuralIssues(input: unknown): FlowIssue[] {
  const issues: FlowIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: '(root)', message: 'flow 定义必须是对象' }];
  }
  if (typeof input.name !== 'string' || input.name === '') {
    issues.push({ path: 'name', message: 'flow name 必须是非空字符串' });
  }
  if (typeof input.initial !== 'string' || input.initial === '') {
    issues.push({ path: 'initial', message: 'initial 必须是非空字符串' });
  }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    issues.push({ path: 'nodes', message: 'nodes 必须是非空数组' });
    return issues;
  }
  input.nodes.forEach((node, index) => {
    if (!isRecord(node)) {
      issues.push({ path: `nodes[${index}]`, message: '节点必须是对象' });
      return;
    }
    if (typeof node.name !== 'string' || node.name === '') {
      issues.push({ path: `nodes[${index}].name`, message: '节点 name 必须是非空字符串' });
    }
    if (!Array.isArray(node.actions)) {
      issues.push({ path: `nodes[${index}].actions`, message: 'actions 必须是数组' });
    }
  });
  return issues;
}

/** 语义校验:引用完整性、唯一性、词汇表命中(输入已是形状合法的定义)。 */
export function validateFlowDefinition(flow: FlowDefinition): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodeNames = new Set<string>();

  flow.nodes.forEach((node) => nodeNames.add(node.name));
  if (!nodeNames.has(flow.initial)) {
    issues.push({ path: 'initial', message: `initial "${flow.initial}" 不在节点集中` });
  }
  if (new Set(flow.nodes.map((n) => n.name)).size !== flow.nodes.length) {
    issues.push({ path: 'nodes', message: '存在重复节点名' });
  }

  const flowFieldNames = new Set((flow.fields ?? []).map((f) => f.name));
  flow.nodes.forEach((node) => {
    validateFields(node.fields ?? [], `nodes[${node.name}].fields`, issues);

    const actionNames = new Set<string>();
    for (const field of node.fields ?? []) {
      if (flowFieldNames.has(field.name)) {
        issues.push({
          path: `nodes[${node.name}].fields`,
          message: `字段 "${field.name}" 与流级字段重复`,
        });
      }
    }

    node.actions.forEach((action, actionIndex) => {
      const actionPath = `nodes[${node.name}].actions[${action.name ?? actionIndex}]`;
      if (actionNames.has(action.name)) {
        issues.push({ path: actionPath, message: '节点内存在重复 action 名' });
      }
      actionNames.add(action.name);

      if (action.to !== undefined && !nodeNames.has(action.to)) {
        issues.push({
          path: `${actionPath}.to`,
          message: `目标节点 "${action.to}" 不存在`,
        });
      }
      (action.guards ?? []).forEach((guard, guardIndex) => {
        if (typeof guard !== 'string' || guard === '') {
          issues.push({
            path: `${actionPath}.guards[${guardIndex}]`,
            message: 'guard 名必须是非空字符串',
          });
        }
      });
      if (
        action['requires-confirmation'] !== undefined &&
        !['low', 'medium', 'high'].includes(action['requires-confirmation'])
      ) {
        issues.push({
          path: `${actionPath}.requires-confirmation`,
          message: '取值必须是 low/medium/high',
        });
      }
      validateFields(action.fields ?? [], `${actionPath}.fields`, issues);
      validateEffects(action, actionPath, nodeNames, issues);
    });
  });
  return issues;
}

function validateFields(
  fields: FieldDefinition[],
  path: string,
  issues: FlowIssue[],
): void {
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const fieldPath = `${path}[${field.name ?? index}]`;
    if (seen.has(field.name)) {
      issues.push({ path: fieldPath, message: '存在重复字段名' });
    }
    seen.add(field.name);
    if (typeof field.name !== 'string' || field.name === '') {
      issues.push({ path: fieldPath, message: '字段 name 必须是非空字符串' });
    }
    if (!FIELD_TYPES.has(field.type)) {
      issues.push({ path: `${fieldPath}.type`, message: `未知字段类型 "${String(field.type)}"` });
    }
    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      issues.push({
        path: `${fieldPath}.options`,
        message: 'select 字段必须声明非空 options',
      });
    }
  });
}

function validateEffects(
  action: ActionDefinition,
  actionPath: string,
  nodeNames: ReadonlySet<string>,
  issues: FlowIssue[],
): void {
  const effects = Array.isArray(action.effect)
    ? action.effect
    : action.effect !== undefined
      ? [action.effect]
      : [];
  effects.forEach((effect, index) => {
    const effectPath = `${actionPath}.effect[${index}]`;
    if (!isRecord(effect) || typeof effect.type !== 'string' || !EFFECT_TYPES.has(effect.type)) {
      issues.push({
        path: effectPath,
        message: `未知 effect 类型 "${String((effect as { type?: unknown })?.type)}"`,
      });
      return;
    }
    if (effect.type === 'transition') {
      const target = effect.to ?? action.to;
      if (target === undefined) {
        issues.push({
          path: `${effectPath}.to`,
          message: 'transition 缺少目标(自身与 action.to 均未声明)',
        });
      } else if (!nodeNames.has(target)) {
        issues.push({
          path: `${effectPath}.to`,
          message: `目标节点 "${target}" 不存在`,
        });
      }
    }
    if (effect.type === 'set-field' && (typeof effect.field !== 'string' || effect.field === '')) {
      issues.push({ path: `${effectPath}.field`, message: 'set-field 缺少 field' });
    }
    if (
      effect.type === 'append' &&
      (typeof effect.collection !== 'string' || effect.collection === '')
    ) {
      issues.push({ path: `${effectPath}.collection`, message: 'append 缺少 collection' });
    }
    if (
      effect.type === 'spawn' &&
      (typeof effect.capability !== 'string' || effect.capability === '')
    ) {
      issues.push({ path: `${effectPath}.capability`, message: 'spawn 缺少 capability' });
    }
  });
}

/** 规范化:补默认值,effect 统一数组并让 transition 继承 action.to。 */
function normalizeAction(action: ActionDefinition): ActionDefinition {
  const rawEffects = Array.isArray(action.effect)
    ? action.effect
    : action.effect !== undefined
      ? [action.effect]
      : [];
  const effects: EffectDefinition[] = rawEffects.map((effect) => {
    if (effect.type === 'transition' && effect.to === undefined && action.to !== undefined) {
      return { ...effect, to: action.to };
    }
    return effect;
  });
  if (effects.length === 0 && action.to !== undefined) {
    effects.push({ type: 'transition', to: action.to });
  }
  return {
    ...action,
    method: action.method ?? 'POST',
    guards: [...(action.guards ?? [])],
    fields: [...(action.fields ?? [])],
    effect: effects,
  };
}

function normalizeNode(node: NodeDefinition): NodeDefinition {
  return {
    ...node,
    title: node.title ?? node.name,
    fields: [...(node.fields ?? [])],
    actions: node.actions.map(normalizeAction),
  };
}

/**
 * 解析未知输入为规范化的 FlowDefinition;结构或语义非法时抛 FlowParseError
 * (issues 全量携带)。T4 起 flow 定义进入事件日志,本函数即定义入口的守门人。
 */
export function parseFlowDefinition(input: unknown): FlowDefinition {
  const structural = structuralIssues(input);
  if (structural.length > 0) {
    throw new FlowParseError(structural);
  }
  const record = input as FlowDefinition;
  const semantic = validateFlowDefinition(record);
  if (semantic.length > 0) {
    throw new FlowParseError(semantic);
  }
  return {
    ...record,
    title: record.title ?? record.name,
    fields: [...(record.fields ?? [])],
    nodes: record.nodes.map(normalizeNode),
  };
}
