/**
 * 工具投影生成器(arch-brief §6"两层工具",选型 §1.1):
 *
 * - **固定协议动词**:navigate(rel)/ answer(content,sources)/ exec(action, params)/
 *   exec_plan(steps)/ clarify(question,continuation)/ present(subject,intent,…)/ done(summary)/
 *   fail(reason,evidence);
 * - **每状态动态动作工具**:当前实体 actions[] 逐个生成工具(action_ 前缀),
 *   字段 schema(action.fields,JSON Schema draft-07)原样内联为参数;
 * - guard 求值结果嵌 description("blocked: <谓词名> 失败"——拒绝即教育);
 * - navigate 的 rel 参数从实体 links(含子实体直达)生成枚举;
 * - clarify 是 Agent 协议级终态；present 只传递展示意图，规划属于 Presentation Plane。
 *
 * 输出是框架无关的 ToolDescriptor(纯 JSON Schema 载体):llm-driver 经
 * ai sdk 的 jsonSchema() 接线;HTTP 合同是唯一真相,tools/MCP 是投影。
 */
import type { SirenEntity } from '@ui4a/engine';

import { navigableRels } from './navigation';

/** 动作工具名前缀(避免与固定动词撞名,映射时剥掉)。 */
export const ACTION_TOOL_PREFIX = 'action_';

export interface ToolDescriptor {
  name: string;
  description: string;
  /** 参数 JSON Schema(draft-07 风格;动作工具 = action.fields 原样)。 */
  parameters: Record<string, unknown>;
}

const AUTHORIZATION_SCHEMA = objectSchema(
  {
    sourceMessageId: {
      type: 'string',
      minLength: 1,
      description: '被引用的 append-only user message id',
    },
    quote: {
      type: 'string',
      minLength: 1,
      description: '该 user message 中逐字复制的显式 effect 授权片段',
    },
  },
  ['sourceMessageId', 'quote'],
);

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

/** 动态 action 保留原字段 schema，只增加协议级授权证据字段。 */
function withEffectAuthorization(schema: Record<string, unknown>): Record<string, unknown> {
  const properties =
    typeof schema.properties === 'object' &&
    schema.properties !== null &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    ...schema,
    type: 'object',
    properties: { ...properties, authorization: AUTHORIZATION_SCHEMA },
    required: [...new Set([...required, 'authorization'])],
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
      name: 'answer',
      description:
        '基于授权合同观察生成临时对话回答，不产生业务副作用。阅读、总结、比较、解释' +
        '直接使用此协议出口，不需要 application action/capability；sources 必须引用观察中的事实。' +
        '复合目标中回答后仍需执行后续业务动作时设置 continue=true。',
      parameters: objectSchema(
        {
          content: { type: 'string', description: '面向用户的自然语言回答' },
          continue: {
            type: 'boolean',
            description: '复合目标中回答后仍需执行后续业务动作时设为 true',
          },
          sources: {
            type: 'array',
            description: '回答依据的合同事实引用；信息不足的回答可引用已检查的字段容器',
            items: objectSchema(
              {
                rel: { type: 'string', description: '来源实体 rel' },
                pointer: {
                  type: 'string',
                  pattern: '^/',
                  description: '来源 Siren 实体中的 JSON Pointer，如 /properties/fields/body',
                },
              },
              ['rel', 'pointer'],
            ),
          },
        },
        ['content', 'sources'],
      ),
    },
    {
      name: 'exec',
      description:
        '执行当前实体的动作(通用通道;优先使用具体动作工具 action_*)。' +
        'authorization 必须引用一条 user message 的逐字原话，不能引用 Assistant 推断。',
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
          authorization: AUTHORIZATION_SCHEMA,
        },
        ['action', 'authorization'],
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
          authorization: AUTHORIZATION_SCHEMA,
        },
        ['steps', 'authorization'],
      ),
    },
    {
      name: 'clarify',
      description:
        '协议级澄清出口，不是 application capability，不产生业务副作用。' +
        '只在目标或对象存在影响正确性的歧义时调用；continuation 保留待继续的原目标。',
      parameters: objectSchema(
        {
          question: { type: 'string', description: '向用户提出的单个明确问题' },
          continuation: objectSchema(
            {
              verb: { type: 'string', description: '待继续的原目标动词/意图' },
              targetRel: { type: 'string' },
              resource: { type: 'string' },
              fields: { type: 'object', additionalProperties: true },
            },
            ['verb'],
          ),
        },
        ['question', 'continuation'],
      ),
    },
    {
      name: 'present',
      description:
        '向独立 Presentation Plane 请求旁路呈现。模型只描述 subject、intent、constraints 和 ' +
        'delivery；runtime 添加 requestId、principal 与来源消息。Presentation Plane 使用实时 catalog ' +
        '和授权事实规划，Chat 不提供 Surface、component、binding、dependency 或事实值。',
      parameters: objectSchema(
        {
          subject: {
            type: 'string',
            minLength: 1,
            description: '需要呈现的已观察实体、集合或 flow rel',
          },
          intent: {
            type: 'string',
            minLength: 1,
            description: '面向用户任务的语义呈现意图，不包含组件选择或布局实现',
          },
          constraints: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description: '可选的人类偏好或展示约束，不包含事实值和实现细节',
          },
          delivery: {
            type: 'string',
            enum: ['inline', 'canvas', 'auto'],
            description: '期望的呈现位置',
          },
        },
        ['subject', 'intent', 'delivery'],
      ),
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
      description:
        `[${action.title}] 执行当前实体的动作 "${action.name}"${blockedNote}。` +
        'authorization 必须引用 user 的逐字授权原话。',
      parameters: withEffectAuthorization(action.fields),
    });
  }

  return tools;
}
