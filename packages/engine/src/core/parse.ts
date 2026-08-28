/**
 * flow 定义的解析与校验("machine-as-JSON 的解析")。
 *
 * 结构校验(unknown → FlowDefinition)+ 语义校验(节点存在性/唯一性/引用完整性)
 * + 规范化(默认值补齐:method=POST、guards=[]、fields=[]、effect 数组化、
 * app 缺省 → 'default'(T10 架构决定 2))。
 * T4 的 meta 平台激活不变式(edge-targets-exist 等)在本层之上叠加。
 */
import { KNOWN_EFFECT_TYPES, KNOWN_FIELD_TYPES } from '@ui4a/shared';
import type { ApplicationDefinition, CapabilityDefinition } from '@ui4a/shared';

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
const FIELD_TYPES: ReadonlySet<FieldType> = KNOWN_FIELD_TYPES;

const EFFECT_TYPES: ReadonlySet<string> = KNOWN_EFFECT_TYPES;

const FIELD_PRESENTATION_ROLES: ReadonlySet<string> = new Set([
  'identity',
  'status',
  'primary-content',
  'metadata',
  'relation',
]);

/** 解析失败:携带全部 issues(一次性报告,便于定义编辑流展示)。 */
export class FlowParseError extends Error {
  readonly issues: FlowIssue[];

  constructor(issues: FlowIssue[]) {
    super(`非法 flow 定义:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'FlowParseError';
    this.issues = issues;
  }
}

/** application 定义解析失败:携带全部 issues(与 FlowParseError 同构)。 */
export class AppParseError extends Error {
  readonly issues: FlowIssue[];

  constructor(issues: FlowIssue[]) {
    super(`非法 application 定义:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'AppParseError';
    this.issues = issues;
  }
}

/** capability 定义解析失败:携带全部 issues(与 AppParseError 同构)。 */
export class CapabilityParseError extends Error {
  readonly issues: FlowIssue[];

  constructor(issues: FlowIssue[]) {
    super(`非法 capability 定义:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'CapabilityParseError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function submissionIssue(value: unknown, path: string): FlowIssue | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !['draft', 'direct', 'none'].includes(String(value.mode))) {
    return { path, message: 'submission.mode 必须是 draft/direct/none' };
  }
  for (const key of ['actors', 'scopes'] as const) {
    const rows = value[key];
    if (
      rows !== undefined &&
      (!Array.isArray(rows) || rows.some((row) => typeof row !== 'string'))
    ) {
      return { path: `${path}.${key}`, message: `${key} 必须是字符串数组` };
    }
  }
  return undefined;
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
  // app 归属(T10 架构决定 2):存在时必须为字符串;空字符串留给激活不变式拒绝。
  if (input.app !== undefined && typeof input.app !== 'string') {
    issues.push({ path: 'app', message: 'app 必须是字符串' });
  }
  const flowSubmission = submissionIssue(input.submission, 'submission');
  if (flowSubmission !== undefined) issues.push(flowSubmission);
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
    if (Array.isArray(node.actions)) {
      node.actions.forEach((action, actionIndex) => {
        if (!isRecord(action)) return;
        const issue = submissionIssue(
          action.submission,
          `nodes[${index}].actions[${actionIndex}].submission`,
        );
        if (issue !== undefined) issues.push(issue);
        if (action.internal !== undefined && action.internal !== 'capability-callback') {
          issues.push({
            path: `nodes[${index}].actions[${actionIndex}].internal`,
            message: 'internal 只允许 capability-callback',
          });
        }
        if (
          action.decision !== undefined &&
          action.decision !== 'accept-capability-result' &&
          action.decision !== 'reject-capability-result'
        ) {
          issues.push({
            path: `nodes[${index}].actions[${actionIndex}].decision`,
            message: 'decision 必须是 accept-capability-result/reject-capability-result',
          });
        }
      });
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
  validateFields(flow.fields ?? [], 'fields', issues);
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

function validateFields(fields: FieldDefinition[], path: string, issues: FlowIssue[]): void {
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
    if (field.persist !== undefined && typeof field.persist !== 'boolean') {
      issues.push({ path: `${fieldPath}.persist`, message: 'persist 必须是 boolean' });
    }
    if (
      field.presentation !== undefined &&
      (typeof field.presentation !== 'object' ||
        field.presentation === null ||
        !FIELD_PRESENTATION_ROLES.has(field.presentation.role))
    ) {
      issues.push({
        path: `${fieldPath}.presentation.role`,
        message: '未知字段呈现角色',
      });
    }
    if (
      field.contentMediaType !== undefined &&
      (typeof field.contentMediaType !== 'string' || field.contentMediaType.trim() === '')
    ) {
      issues.push({
        path: `${fieldPath}.contentMediaType`,
        message: 'contentMediaType 必须是非空字符串',
      });
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
    if (effect.type === 'set-field') {
      const hasValue = Object.prototype.hasOwnProperty.call(effect, 'value');
      const hasParam = typeof effect['from-param'] === 'string' && effect['from-param'] !== '';
      if (hasValue === hasParam) {
        issues.push({
          path: effectPath,
          message: 'set-field 必须且只能声明 value 或 from-param 之一',
        });
      }
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

/** 动作的效果列表(规范化:单/缺省效果数组化;有 to 无 effect 时补 transition)。 */
export function actionEffects(action: ActionDefinition): EffectDefinition[] {
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
  return effects;
}

/**
 * flow 的 append 效果目标集合(去重;效果声明的纯推导,零发明)。
 * 导航投影两个方向共用同一口径:实例→产物集合正向链(siren/project)与
 * 集合→flow 入口回链(web flow-entry)。
 */
export function appendedCollections(flow: FlowDefinition): string[] {
  const collections = new Set<string>();
  for (const node of flow.nodes) {
    for (const action of node.actions) {
      for (const effect of actionEffects(action)) {
        if (effect.type === 'append') collections.add(effect.collection);
      }
    }
  }
  return [...collections];
}

function normalizeAction(action: ActionDefinition): ActionDefinition {
  return {
    ...action,
    method: action.method ?? 'POST',
    guards: [...(action.guards ?? [])],
    fields: [...(action.fields ?? [])],
    effect: actionEffects(action),
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
    app: record.app ?? 'default',
    title: record.title ?? record.name,
    fields: [...(record.fields ?? [])],
    nodes: record.nodes.map(normalizeNode),
  };
}

/** application 定义的结构校验(与 structuralIssues 同构:形状级,逐字段收集)。 */
function applicationStructuralIssues(input: unknown): FlowIssue[] {
  const issues: FlowIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: '(root)', message: 'application 定义必须是对象' }];
  }
  if (typeof input.name !== 'string' || input.name === '') {
    issues.push({ path: 'name', message: 'application name 必须是非空字符串' });
  }
  if (typeof input.title !== 'string' || input.title === '') {
    issues.push({ path: 'title', message: 'title 必须是非空字符串' });
  }
  if (typeof input.intent !== 'string' || input.intent === '') {
    issues.push({ path: 'intent', message: 'intent 必须是非空字符串' });
  }
  if (input.entry !== undefined && (typeof input.entry !== 'string' || input.entry === '')) {
    issues.push({ path: 'entry', message: 'entry 必须是非空字符串' });
  }
  const submission = submissionIssue(input.submission, 'submission');
  if (submission !== undefined) issues.push(submission);
  return issues;
}

/**
 * 解析未知输入为 ApplicationDefinition(T10 架构决定 1):
 * name/title/intent 必填非空字符串,entry 可选(若存在必须是非空字符串);
 * 非法时抛 AppParseError(issues 全量携带)。显式值原样保留,不做额外归一化。
 */
export function parseApplicationDefinition(input: unknown): ApplicationDefinition {
  const issues = applicationStructuralIssues(input);
  if (issues.length > 0) {
    throw new AppParseError(issues);
  }
  // 形状已逐字段校验,单点断言(同 parseFlowDefinition 的 `input as FlowDefinition` 口径)。
  const record = input as ApplicationDefinition;
  return {
    name: record.name,
    title: record.title,
    intent: record.intent,
    ...(record.entry !== undefined ? { entry: record.entry } : {}),
    ...(record.submission !== undefined ? { submission: record.submission } : {}),
  };
}

/** capability 类别注册表(arch-brief 第七层三类动词:转换/提取/效应)。 */
const CAPABILITY_KINDS: ReadonlySet<string> = new Set(['transform', 'extract', 'effect']);

/** capability 定义的结构校验(与 applicationStructuralIssues 同构:形状级,逐字段收集)。 */
function capabilityStructuralIssues(input: unknown): FlowIssue[] {
  const issues: FlowIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: '(root)', message: 'capability 定义必须是对象' }];
  }
  if (typeof input.name !== 'string' || input.name === '') {
    issues.push({ path: 'name', message: 'capability name 必须是非空字符串' });
  }
  if (typeof input.title !== 'string' || input.title === '') {
    issues.push({ path: 'title', message: 'title 必须是非空字符串' });
  }
  if (typeof input.kind !== 'string' || !CAPABILITY_KINDS.has(input.kind)) {
    issues.push({ path: 'kind', message: 'kind 必须是 transform/extract/effect 之一' });
  }
  if (typeof input.intent !== 'string' || input.intent === '') {
    issues.push({ path: 'intent', message: 'intent 必须是非空字符串' });
  }
  if (input.input !== undefined && (typeof input.input !== 'string' || input.input === '')) {
    issues.push({ path: 'input', message: 'input 必须是非空字符串' });
  }
  if (input.output !== undefined && (typeof input.output !== 'string' || input.output === '')) {
    issues.push({ path: 'output', message: 'output 必须是非空字符串' });
  }
  if (input.inputSchema !== undefined && !isRecord(input.inputSchema)) {
    issues.push({ path: 'inputSchema', message: 'inputSchema 必须是 JSON Schema 对象' });
  }
  if (input.outputSchema !== undefined && !isRecord(input.outputSchema)) {
    issues.push({ path: 'outputSchema', message: 'outputSchema 必须是 JSON Schema 对象' });
  }
  if (input.scope !== undefined) {
    if (!isRecord(input.scope)) {
      issues.push({ path: 'scope', message: 'scope 必须是对象' });
    } else {
      for (const key of ['applications', 'flows'] as const) {
        const values = input.scope[key];
        if (
          values !== undefined &&
          (!Array.isArray(values) ||
            values.some((value) => typeof value !== 'string' || value === ''))
        ) {
          issues.push({ path: `scope.${key}`, message: `${key} 必须是非空字符串数组` });
        }
      }
    }
  }
  if (input.executor !== undefined) {
    if (!isRecord(input.executor)) {
      issues.push({ path: 'executor', message: 'executor 必须是对象' });
    } else {
      const executorFields = new Set(['class', 'profile', 'agentDefinition', 'requiredFeatures']);
      for (const key of Object.keys(input.executor)) {
        if (!executorFields.has(key)) {
          issues.push({
            path: `executor.${key}`,
            message: `executor.${key} 是部署字段或未知字段，不能进入 Application 合同`,
          });
        }
      }
      if (typeof input.executor.class !== 'string' || input.executor.class === '') {
        issues.push({ path: 'executor.class', message: 'executor.class 必须是非空字符串' });
      }
      if (typeof input.executor.profile !== 'string' || input.executor.profile === '') {
        issues.push({ path: 'executor.profile', message: 'executor.profile 必须是非空字符串' });
      }
      if (
        input.executor.agentDefinition !== undefined &&
        (typeof input.executor.agentDefinition !== 'string' ||
          !/^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(input.executor.agentDefinition))
      ) {
        issues.push({
          path: 'executor.agentDefinition',
          message: 'executor.agentDefinition 必须是 exact name@positive-version ref',
        });
      }
      if (
        input.executor.requiredFeatures !== undefined &&
        (!Array.isArray(input.executor.requiredFeatures) ||
          input.executor.requiredFeatures.some((feature) => typeof feature !== 'string'))
      ) {
        issues.push({
          path: 'executor.requiredFeatures',
          message: 'executor.requiredFeatures 必须是字符串数组',
        });
      }
    }
  }
  return issues;
}

/**
 * 解析未知输入为 CapabilityDefinition(T13 架构决定 3,与 parseApplicationDefinition 同构):
 * name/title/kind/intent 必填非空字符串,kind 必须 ∈ transform/extract/effect;
 * input/output 可选(若存在必须是非空字符串);非法时抛 CapabilityParseError
 * (issues 全量携带)。显式值原样保留,不做额外归一化。
 */
export function parseCapabilityDefinition(input: unknown): CapabilityDefinition {
  const issues = capabilityStructuralIssues(input);
  if (issues.length > 0) {
    throw new CapabilityParseError(issues);
  }
  // 形状已逐字段校验,单点断言(同 parseApplicationDefinition 口径)。
  const record = input as CapabilityDefinition;
  return {
    name: record.name,
    title: record.title,
    kind: record.kind,
    intent: record.intent,
    ...(record.input !== undefined ? { input: record.input } : {}),
    ...(record.output !== undefined ? { output: record.output } : {}),
    ...(record.inputSchema !== undefined ? { inputSchema: record.inputSchema } : {}),
    ...(record.outputSchema !== undefined ? { outputSchema: record.outputSchema } : {}),
    ...(record.scope !== undefined ? { scope: record.scope } : {}),
    ...(record.executor !== undefined ? { executor: record.executor } : {}),
  };
}
