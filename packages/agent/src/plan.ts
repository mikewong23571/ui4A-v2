/**
 * plan 模式(T6 / spec 架构决定 4):一次决策输出整段计划 → /api/exec-plan。
 *
 * 旁路能力:不改 runAgent 既有循环——调用方(聊天入口/e2e)拿到计划后直接
 * POST /api/exec-plan(一次 HTTP 调用 = 一次决策,引擎批量裁决)。
 *
 * 两个入口:
 * - planFor(goal, sitemap):rule 侧计划生成器,**纯函数、确定性**——发布类
 *   (向导型)目标从 sitemap flow 形状推导步序列:沿推进动作链(next 等推进词)
 *   从 initial 走到终点,每步带 goal.fields 中该步 schema 声明的字段(分步
 *   组参,不发明事实),终点取与目标动词词级匹配的完成动作(如 publish);
 * - buildPlanPrompt / parsePlanResponse:LLM plan 模式接口——prompt 构造
 *   (纯函数)+ 模型 JSON 输出解析(fail-safe,不合法输出折算 {ok:false});
 *   真实模型调用留 e2e 可选。
 *
 * 口径:非向导目标(队列类如「审核」)→ undefined,调用方回退既有逐步循环
 * (队列成员 rel 不在 sitemap 里,计划生成器不冒充队列计划);向导计划从
 * flow 的 initial 推导**完整**序列——向导实例已在途中时,前序步会被引擎按
 * 当前节点裁决拒绝并截断(append-only 分步报告,调用方可见)。
 */
import type { Sitemap, SitemapAction, SitemapFlow } from '@ui4a/engine';

import { anyTokenInString, expandVerb } from './match';
import { ADVANCE_TOKENS } from './rule-driver';
import type { AgentGoal } from './types';

/** exec-plan 的步形状(POST /api/exec-plan 的 steps 元素;身份字段由调用方补)。 */
export interface PlanStep {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
}

/** 规则侧计划提案(确定性推导的产物)。 */
export interface PlanProposal {
  /** 计划来源 flow 名(向导)。 */
  flow: string;
  /** 人类可读摘要(轨迹/调试)。 */
  summary: string;
  steps: PlanStep[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** action 字段 schema(JSON Schema)的 properties 键序。 */
function schemaFieldNames(action: SitemapAction): string[] {
  const fields = action.fields;
  if (!isPlainObject(fields) || !isPlainObject(fields.properties)) return [];
  return Object.keys(fields.properties);
}

/** 目标字段字典 → 该动作 schema 声明的子集(分步组参:只带声明过的,不发明)。 */
function paramsFor(
  action: SitemapAction,
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (fields === undefined) return params;
  for (const name of schemaFieldNames(action)) {
    if (name in fields) params[name] = fields[name];
  }
  return params;
}

/** 推进动作(向导/表单的前进步):与 rule driver ③ 层同一词表。 */
function isAdvance(action: SitemapAction): boolean {
  return anyTokenInString(ADVANCE_TOKENS, `${action.name} ${action.title}`);
}

/** 完成动作:与目标动词词级匹配且不是推进动作。 */
function isCompletion(action: SitemapAction, goalTokens: readonly string[]): boolean {
  return !isAdvance(action) && anyTokenInString(goalTokens, `${action.name} ${action.title}`);
}

/**
 * 从 flow 形状推导向导计划:initial 沿推进链走到终点 + 终点完成动作。
 * 返回 undefined 表示该 flow 不构成向导计划(无推进步,或终点无完成动作)。
 */
function wizardPlan(
  flow: SitemapFlow,
  goal: AgentGoal,
  goalTokens: readonly string[],
): PlanProposal | undefined {
  const rel = `flow:${flow.name}`;
  const steps: PlanStep[] = [];
  const visited = new Set<string>();
  let node = flow.nodes.find((candidate) => candidate.name === flow.initial);

  while (node !== undefined && !visited.has(node.name)) {
    visited.add(node.name);
    const advance = node.actions.find((action) => isAdvance(action) && action.to !== undefined);
    if (advance === undefined) break;
    steps.push({ rel, action: advance.name, params: paramsFor(advance, goal.fields) });
    node = flow.nodes.find((candidate) => candidate.name === advance.to);
  }
  if (node === undefined || steps.length === 0) return undefined;

  const completion = node.actions.find((action) => isCompletion(action, goalTokens));
  if (completion === undefined) return undefined;
  steps.push({ rel, action: completion.name, params: paramsFor(completion, goal.fields) });

  return {
    flow: flow.name,
    summary: `向导 ${flow.title ?? flow.name}(${flow.name}):${steps.length} 步计划,完成动作 ${completion.name}`,
    steps,
  };
}

/**
 * rule 侧计划生成器(纯函数,确定性):目标动词与 sitemap flow 名/标题词级
 * 匹配 → 沿推进链推导向导步序列。无命中或非向导形状 → undefined(回退循环)。
 */
export function planFor(goal: AgentGoal, sitemap: Sitemap): PlanProposal | undefined {
  const goalTokens = expandVerb(goal.verb);
  const candidates = sitemap.flows.filter((flow) =>
    anyTokenInString(goalTokens, `${flow.name} ${flow.title}`),
  );
  for (const flow of candidates) {
    const proposal = wizardPlan(flow, goal, goalTokens);
    if (proposal !== undefined) return proposal;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// LLM plan 模式接口(prompt 构造 + 模型 JSON 输出解析;传输由调用方注入)
// ---------------------------------------------------------------------------

/** 单 flow 的紧凑声明(action 清单 + 字段 schema 摘要,供 prompt 注入)。 */
function describeFlow(flow: SitemapFlow): string {
  const nodes = flow.nodes
    .map((node) => {
      const actions = node.actions
        .map((action) => {
          const fields = schemaFieldNames(action);
          return `${action.name}${fields.length > 0 ? `(${fields.join(', ')})` : ''}`;
        })
        .join(', ');
      return `  - 节点 ${node.name}${node.name === flow.initial ? '(初始)' : ''}: ${actions || '(无动作)'}`;
    })
    .join('\n');
  return `### flow ${flow.name}(${flow.title ?? flow.name})\n${nodes}`;
}

/**
 * LLM plan 模式的用户 prompt(纯函数,确定性):目标 + sitemap 动作清单 +
 * 输出协议(严格 JSON {"steps":[{rel,action,params}]},字段值不得发明)。
 * 系统提示词/模型/传输由调用方装配(与 llm-driver 的 decide 协议解耦)。
 */
export function buildPlanPrompt(goal: AgentGoal, sitemap: Sitemap): string {
  return [
    '## 任务\n为下面的目标生成一段 exec-plan 计划(一次决策批量执行,引擎逐步裁决)。',
    '## 目标\n' + JSON.stringify(goal),
    '## 应用动作清单(sitemap;只能使用其中声明的动作与字段)\n' +
      sitemap.flows.map(describeFlow).join('\n'),
    '## 输出协议\n只输出一个 JSON 对象,不要输出其他文本:\n' +
      '{"steps": [{"rel": "<实体或 flow:别名>", "action": "<动作名>", "params": {<仅该动作声明过的字段>}}]}',
    '规则:1. steps 按执行顺序排列,完整覆盖目标所需的推进与完成动作(如向导的 next 步与 publish 步);',
    '2. params 的字段名必须来自动作清单括号内声明的字段,字段值取目标提供的值,不得发明;',
    '3. 向导类目标用 flow:<name> 作为 rel(引擎自动解析到实例);不要输出空 steps。',
  ].join('\n');
}

/** 解析结果:合法计划或形状错误(fail-safe,绝不抛异常)。 */
export type ParsedPlan = { ok: true; steps: PlanStep[] } | { ok: false; error: string };

const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/;

/**
 * 解析模型的计划输出:裸 JSON 或 ```json 围栏均可;步形状逐项校验
 * (rel/action 非空字符串、params 可缺省但必须是对象);params 规范化为 {}
 * (与 planFor 的步形状一致)。不合法输出 → {ok:false, error}(拒绝即数据)。
 */
export function parsePlanResponse(text: string): ParsedPlan {
  const fenced = FENCE_PATTERN.exec(text);
  const payload = fenced !== null ? fenced[1]! : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, error: '模型输出不是合法 JSON' };
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.steps)) {
    return { ok: false, error: '模型输出缺少 steps 数组' };
  }
  if (parsed.steps.length === 0) {
    return { ok: false, error: 'steps 为空(空计划不是计划)' };
  }
  const steps: PlanStep[] = [];
  for (let index = 0; index < parsed.steps.length; index += 1) {
    const step = parsed.steps[index];
    if (!isPlainObject(step)) {
      return { ok: false, error: `steps[${index}] 不是对象` };
    }
    if (typeof step.rel !== 'string' || step.rel === '') {
      return { ok: false, error: `steps[${index}].rel 必须是非空字符串` };
    }
    if (typeof step.action !== 'string' || step.action === '') {
      return { ok: false, error: `steps[${index}].action 必须是非空字符串` };
    }
    if (step.params !== undefined && !isPlainObject(step.params)) {
      return { ok: false, error: `steps[${index}].params 必须是对象` };
    }
    steps.push({
      rel: step.rel,
      action: step.action,
      params: isPlainObject(step.params) ? step.params : {},
    });
  }
  return { ok: true, steps };
}
