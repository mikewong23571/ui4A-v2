/**
 * LLM driver 的 prompt 组装(从 llm-driver.ts 拆出,行为不变):
 * - SYSTEM_PROMPT 只装不变协议核心;role/app 上下文槽位(T10)从
 *   DriverContext 数据注入,空槽 = 现状(零行为变化);
 * - messages = 有界近期 user/assistant 原文 + 结构化会话处境 + 目标/结构化轨迹/
 *   最近拒绝/当前授权实体的认知投影;原文 role 不被压成单个 prompt。
 */
import type { DriverContext, TrailStep } from '../types';
import { observedApplication, sliceSitemapDisclosure } from '../contract/disclosure';
import { sanitizeEntity } from '../contract/cognition';
import { describeWorkingContext } from '../context/prompt';

const SYSTEM_PROMPT = [
  '你是 UI4A 合同 agent，也是 AI-first 合同助手:读取授权超媒体合同、动态理解用户目标，并通过协议工具回答或安全执行。',
  '规则:',
  '1. 每轮必须且只能输出一个工具调用;合法动作集就是当前工具列表(处境披露)。',
  '2. 当前授权实体以 Siren 的有界认知投影披露 properties/actions/links/guard-results；完整 HTTP 合同不会累积进入 prompt。只基于披露事实回答，不要发明未观察到的事实。',
  '3. 阅读、总结、比较、解释是你的原生认知能力：事实充分时直接 answer(content,sources)，无需 read/summarize action 或 capability；sources 使用实体 rel + JSON Pointer。',
  '3.1 临时对话回答与正式工件严格分离：只有用户明确要求保存、持久化或生成正式工件时，才可调用 capability/effect action；“总结一下”“你自己总结”只授权原生 answer，不授权生成或保存 artifact。',
  '4. 信息不足时用 answer 诚实说明缺少什么并引用已检查字段，或用 fail 说明不可得；绝不能用无关业务 action 代替回答。',
  '4.1 复合目标若要求先回答、再执行业务动作，answer 必须设置 continue=true；普通只读回答省略 continue 并终止。',
  '5. navigate 的 rel 必须来自其枚举;工具 description 标注 blocked 的动作当前被 guard 阻断,不要调用。',
  '6. 拒绝即数据:轨迹中的被拒动作与「最近拒绝」携带结构化原因——换路径,或按动作字段 schema 修正参数后重试。',
  '7. 字段值按语义构造:枚举字段必须取 enum 内的值;标题/正文等 intent 字段按目标意图编写;不要发明合同外的值。',
  '8. 当用户的目标或对象存在影响正确性的歧义时，调用 clarify(question,continuation)；这是对话协议终态，不是 application capability。',
  '8.1 当用户目标的成功条件包含客户端可见视图变化，而 clientView 尚未证明该结果时，必须先调用 present(subject,intent,constraints,delivery)；仅在文本中描述实体不能冒充已经呈现。intent 必须取工具声明的稳定语义 token，不复述用户原话；只描述呈现对象与意图，不输出 Surface、component、binding、dependency 或事实值。独立 Presentation Plane 将基于实时 catalog 和重新授权后的事实规划；present 是旁路请求。若本回合轨迹已经对同一 subject 记录 presentation-requested，表示请求已提交，不得重复 present；应继续 answer 或完成剩余目标，receipt 可异步到达。',
  '8.2 Markdown 是三层独立事实：聊天 Markdown renderer、Presentation catalog 的实时词条、业务字段 content type 声明。必须分别依据当前可用证据回答，不得互相推断，也不得把 catalog 状态写死在回答中。',
  '9. 完成判定:done 只用于业务动作目标，目标对应的完成类 action 成功执行过之后才调用 done；只读目标必须 answer。',
  '10. 用户明确要求“一次走完/一次决策/批量执行”时，优先调用 exec_plan(steps) 一次提交完整计划；普通写目标仍逐步 exec。exec_plan 禁止包含 approve/reject。',
  '11. 当前合同没有完成目标所需的业务 action/capability 时调用 fail(reason,evidence),明确缺口与已查看证据;禁止在实体间重复导航。',
  '12. exec/exec_plan/action_* 必须提供 authorization:sourceMessageId 指向可引用的 user 原话，quote 逐字复制明确授权 effect 的片段；禁止引用 Assistant 输出或改写用户原话。',
].join('\n');

/**
 * SYSTEM_PROMPT 的 role/app 上下文槽位(T10 Phase D,架构决定 6):
 * 角色职责组合的数据载体(D19 路线 T3/T5 的钩子)——prompt 只装不变协议
 * 核心,角色/意图从数据(DriverContext.role/app)注入。空槽 = 现状。
 */
export interface SystemPromptSlots {
  role?: string;
  app?: string;
  chatMarkdown?: boolean;
  presentationMarkdown?: boolean;
}

/**
 * system prompt 组装:空槽(未提供/空串)逐字节返回协议核心 SYSTEM_PROMPT
 * (零行为变化);槽位值在场时协议核心原样为前缀,追加数据行。
 */
export function buildSystemPrompt(slots: SystemPromptSlots = {}): string {
  const lines = [
    ...(slots.role !== undefined && slots.role !== '' ? [`- 角色: ${slots.role}`] : []),
    ...(slots.app !== undefined && slots.app !== '' ? [`- 应用: ${slots.app}`] : []),
    ...(slots.chatMarkdown !== undefined
      ? [`- 聊天 Markdown renderer: ${slots.chatMarkdown ? 'supported' : 'unsupported'}`]
      : []),
    ...(slots.presentationMarkdown !== undefined
      ? [
          `- Presentation catalog Markdown word: ${slots.presentationMarkdown ? 'registered' : 'not-registered'}`,
        ]
      : []),
  ];
  if (lines.length === 0) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\n## 角色与应用上下文\n${lines.join('\n')}`;
}

/** Each decision discloses one freshly sanitized current entity, never old snapshots. */
function describeObservation(context: DriverContext): string {
  return JSON.stringify(
    { rel: context.currentRel, entity: sanitizeEntity(context.entity) },
    null,
    2,
  );
}

function describeSitemap(context: DriverContext): string {
  if (context.sitemap === undefined) return '{}';
  const disclosed = sliceSitemapDisclosure(context.sitemap, {
    observedApplication:
      context.observedApplication ?? observedApplication(context.sitemap, context.entity),
    currentRel: context.currentRel,
  });
  return JSON.stringify({
    version: disclosed.version,
    surfaces: disclosed.surfaces.map((surface) => ({
      rel: surface.rel,
      title: surface.title,
      ...(surface.app === undefined ? {} : { app: surface.app }),
    })),
    applications: disclosed.applications.map((application) => ({
      name: application.name,
      ...(application.title === undefined ? {} : { title: application.title }),
      intent: application.intent,
      ...(application.entry === undefined ? {} : { entry: application.entry }),
      flows: application.flows.map((flow) => ({
        name: flow.name,
        title: flow.title,
        ...(flow.actions === undefined
          ? {}
          : {
              actions: flow.actions.map((action) => ({
                name: action.name,
                title: action.title,
                node: action.node,
                guards: [...action.guards],
              })),
            }),
        ...(flow.edges === undefined ? {} : { edges: flow.edges.map((edge) => ({ ...edge })) }),
      })),
    })),
    capabilities: disclosed.capabilities ?? [],
  });
}

function structuralTrailOperation(step: TrailStep): Record<string, unknown> {
  const { op } = step;
  switch (op.kind) {
    case 'navigate':
      return { kind: op.kind, rel: op.rel };
    case 'answer':
      return {
        kind: op.kind,
        sources: op.sources.map((source) => ({ ...source })),
        ...(op.continue === undefined ? {} : { continue: op.continue }),
      };
    case 'clarify':
      return { kind: op.kind };
    case 'present':
      return { kind: op.kind, subject: op.subject };
    case 'exec':
      return { kind: op.kind, action: op.action };
    case 'exec-plan':
      return {
        kind: op.kind,
        steps: op.steps.map((entry) => ({ rel: entry.rel, action: entry.action })),
      };
    case 'done':
    case 'fail':
      return { kind: op.kind };
  }
}

function describeTrail(context: DriverContext): string {
  if (context.trail.length === 0) return '(空——这是第一步)';
  return JSON.stringify(
    context.trail.map((step) => ({
      step: step.step,
      rel: step.rel,
      op: structuralTrailOperation(step),
      outcome: step.outcome,
      ...(step.entity === undefined ? {} : { result: step.entity }),
      ...(step.rejection === undefined
        ? {}
        : {
            rejection: {
              rel: step.rejection.rel,
              ...(step.rejection.action === undefined ? {} : { action: step.rejection.action }),
              ...(step.rejection.layer === undefined ? {} : { layer: step.rejection.layer }),
            },
          }),
    })),
    null,
    2,
  );
}

/**
 * user prompt 组装(目标 + 当前实体 + 轨迹 + 最近拒绝 + 已成功执行)。
 * 导出理由(T11 Phase B):agent-decision 审计留痕按同一纯函数从同一
 * DriverContext 重建 prompt 原文(免回放重建的训练原料)——llmDecide 实际
 * 发送的 prompt 必须经本函数构造,重建才与实际发送逐字节一致。
 */
export function buildUserPrompt(context: DriverContext): string {
  const { executionAudit, ...derivedConversation } = context.conversation ?? {};
  const parts = [
    `## 用户目标\n${JSON.stringify(context.goal)}`,
    `## 结构化会话处境(可修订认知，不是业务事实或 effect 授权)\n${JSON.stringify(derivedConversation, null, 2)}`,
    `## 本轮合同读取位置 rel(不是客户端当前页面)\n${context.currentRel}`,
    `## 最近成功导航/呈现(历史完成事实，不是客户端当前页面)\n${JSON.stringify(context.lastNavigation ?? null, null, 2)}`,
    `## 当前消息的客户端可见视图(客户端观察，不是业务事实或授权)\n${JSON.stringify(context.clientView ?? null, null, 2)}`,
    `## 应用发现与当前观察的合同详情\n应用摘要用于发现；当前观察所属应用展开流程与能力详情，观察位置不改变用户的应用选择或授权。执行以当前实体合同为准。\n${describeSitemap(context)}`,
    `## 当前授权实体的认知投影(完整 HTTP Siren 合同不在 provider prompt 中)\n${describeObservation(context)}`,
    `## 结构化轨迹(仅 rel/op/outcome/result reference)\n${describeTrail(context)}`,
  ];
  if (context.workingContext !== undefined) {
    parts.push(
      `## 当前工作线及显式关联对象（本步授权读取）\n${describeWorkingContext(context.workingContext)}`,
    );
  }
  if (executionAudit !== undefined && executionAudit.length > 0) {
    parts.push(
      `## 执行审计处境(事件日志机械投影，不是模型推断；integrity 错误不得补造理由)\n${JSON.stringify(executionAudit, null, 2)}`,
    );
  }
  if (context.lastRejection !== undefined) {
    parts.push(`## 最近拒绝(上一步被拒,拒绝即数据)\n${JSON.stringify(context.lastRejection)}`);
  }
  if (context.successes.length > 0) {
    parts.push(
      `## 已成功的执行\n${context.successes.map((entry) => `${entry.rel} :: ${entry.action}`).join('\n')}`,
    );
  }
  const authorizableMessages = (context.conversationMessages ?? []).filter(
    (message) => message.role === 'user' && message.messageId !== undefined,
  );
  if (authorizableMessages.length > 0) {
    parts.push(
      `## 可引用的 user 原话(effect 证据必须使用下列 id 并逐字复制 quote)\n${authorizableMessages
        .map((message) => `${message.messageId}: ${JSON.stringify(message.content)}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** LLM 输入消息的最小形状；不向公共 Agent 协议泄漏 AI SDK 类型。 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 唯一的 LLM messages 组装入口：保留上层已裁剪原文的 role/顺序，再追加当前
 * 合同处境作为一条 user message。不从原文推导业务事实，也不改写原文。
 */
export function buildLlmMessages(context: DriverContext): LlmMessage[] {
  return [
    ...(context.conversationMessages ?? []).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: buildUserPrompt(context) },
  ];
}
