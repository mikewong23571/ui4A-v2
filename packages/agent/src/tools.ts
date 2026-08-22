/**
 * 工具投影生成器(arch-brief §6"两层工具",选型 §1.1):
 *
 * - **固定协议动词 7 个**:navigate(rel)/ exec(action, params)/ exec_plan(steps)/ clarify(fields)/
 *   render(spec)/ done(summary)/ fail(reason,evidence)——循环协议的工具面;
 * - **每状态动态动作工具**:当前实体 actions[] 逐个生成工具(action_ 前缀),
 *   字段 schema(action.fields,JSON Schema draft-07)原样内联为参数;
 * - guard 求值结果嵌 description("blocked: <谓词名> 失败"——拒绝即教育);
 * - navigate 的 rel 参数从实体 links(含子实体直达)生成枚举;
 * - clarify/render 是保留动词:T2 未实现 capability,description 声明禁止调用。
 *
 * 输出是框架无关的 ToolDescriptor(纯 JSON Schema 载体):llm-driver 经
 * ai sdk 的 jsonSchema() 接线;HTTP 合同是唯一真相,tools/MCP 是投影。
 */
import type { SirenEntity } from '@ui4a/engine';

import { navigableRels } from './rule-driver';

/** 动作工具名前缀(避免与固定动词撞名,映射时剥掉)。 */
export const ACTION_TOOL_PREFIX = 'action_';

/** 保留动词:T2 不实现 clarify capability / 渲染词汇表(Phase F/T7)。 */
const RESERVED_VERBS = ['clarify', 'render'] as const;

export interface ToolDescriptor {
  name: string;
  description: string;
  /** 参数 JSON Schema(draft-07 风格;动作工具 = action.fields 原样)。 */
  parameters: Record<string, unknown>;
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/** guard-results 里该动作失败的谓词名(blocked 时用于 description)。 */
function failedGuardNames(entity: SirenEntity, action: string): string[] {
  const entry = (entity['guard-results'] ?? []).find((candidate) => candidate.action === action);
  if (entry === undefined || !entry.blocked) return [];
  // 谓词名优先从逐项求值取;缺省时从 reason 抠 "谓词=false"(同源格式)。
  const fromGuards = entry.guards.filter((guard) => !guard.pass).map((guard) => guard.name);
  if (fromGuards.length > 0) return fromGuards;
  if (entry.reason !== undefined) {
    const fromReason = [...entry.reason.matchAll(/([\w:-]+)=false/g)].map(
      (match) => match[1] as string,
    );
    if (fromReason.length > 0) return fromReason;
  }
  return ['(guard 未满足)'];
}

/** 实体 → 工具投影(固定动词 + 动态动作工具;顺序:动词在前,动作随后)。 */
export function buildToolProjection(entity: SirenEntity): ToolDescriptor[] {
  const currentRel = typeof entity.properties.rel === 'string' ? entity.properties.rel : '';
  const rels = navigableRels(entity, currentRel);

  const tools: ToolDescriptor[] = [
    {
      name: 'navigate',
      description:
        '导航:切换到另一个实体(沿 links 与子实体)。rel 必须来自枚举;' +
        '集合入口(如 flow:article-drafting)也在枚举内。',
      parameters: objectSchema(
        {
          rel: {
            type: 'string',
            description: '目标实体 rel',
            ...(rels.length > 0 ? { enum: rels } : {}),
          },
        },
        ['rel'],
      ),
    },
    {
      name: 'exec',
      description: '执行当前实体的动作(通用通道;优先使用具体动作工具 action_*)。',
      parameters: objectSchema(
        {
          action: {
            type: 'string',
            description: '动作名',
            ...(entity.actions.length > 0
              ? { enum: entity.actions.map((action) => action.name) }
              : {}),
          },
          params: {
            type: 'object',
            description: '动作参数(按动作字段 schema)',
            additionalProperties: true,
          },
        },
        ['action'],
      ),
    },
    {
      name: 'exec_plan',
      description:
        '一次批量裁决多步动作。仅当用户明确要求“一次走完/一次决策/批量执行”时使用；每步仍由引擎逐条裁决，禁止用于 approve/reject 审批。',
      parameters: objectSchema(
        {
          steps: {
            type: 'array',
            minItems: 1,
            items: objectSchema(
              {
                rel: { type: 'string', description: '每步目标实体 rel' },
                action: { type: 'string', description: '动作名' },
                params: { type: 'object', additionalProperties: true },
              },
              ['rel', 'action'],
            ),
          },
        },
        ['steps'],
      ),
    },
    {
      name: 'clarify',
      description:
        '保留动词:T2 未实现 clarify capability,禁止调用。' +
        '缺少字段值时,请按字段语义自行构造合理值(枚举字段必须取 enum 内的值)。',
      parameters: objectSchema({ fields: { type: 'array', items: { type: 'string' } } }, [
        'fields',
      ]),
    },
    {
      name: 'render',
      description: '保留动词:T2 未实现渲染词汇表,禁止调用。',
      parameters: objectSchema({ spec: { type: 'string' } }, ['spec']),
    },
    {
      name: 'done',
      description:
        '目标完成时调用:仅当目标对应的完成类动作(如 publish)成功执行过后才可 done,' +
        'summary 说明达成结果;未完成时不得调用。',
      parameters: objectSchema({ summary: { type: 'string', description: '完成总结' } }, [
        'summary',
      ]),
    },
    {
      name: 'fail',
      description:
        '合同无法完成目标时调用。reason 说明缺失的 capability/action；evidence 列出已查看的实体、动作或拒绝，禁止用导航循环代替失败。',
      parameters: objectSchema(
        {
          reason: { type: 'string', description: '无法完成目标的合同原因' },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: '支持判断的实体、动作或拒绝证据',
          },
        },
        ['reason'],
      ),
    },
  ];

  for (const action of entity.actions) {
    const failed = failedGuardNames(entity, action.name);
    const blockedNote = failed.length > 0 ? ` — blocked: ${failed.join(', ')} 失败` : '';
    tools.push({
      name: `${ACTION_TOOL_PREFIX}${action.name}`,
      description: `[${action.title}] 执行当前实体的动作 "${action.name}"${blockedNote}`,
      parameters: action.fields,
    });
  }

  return tools;
}

/** 保留动词集合(供 driver 做 fail-safe 判定)。 */
export function isReservedVerb(toolName: string): boolean {
  return (RESERVED_VERBS as readonly string[]).includes(toolName);
}
