/**
 * capability seed 常量(T13 Phase C Task 2;spec 架构决定 3)——
 * 与 applications.ts 同地位:seed 源 + 类型来源,不是运行时真相源:
 * - boot 时若日志无某 capability 的 capability-seeded 事件,常量全文入日志
 *   (seeded 即 registered;fold 落 snapshot.capabilities 表,见 engine/service.ts
 *   的 seedBootData 与 engine/fold.ts 的 applyCapabilitySeeded);
 * - capabilities 表的键集即 capability-registered 不变式(Phase D)的已注册
 *   集合——本文件是被引用 capability 的目录本体(人类与 agent 的发现面)。
 *
 * 三个 seed 覆盖全仓引用盘点(spec 架构决定 3「宁多勿漏」):
 * - draft:field source proposal.capability 引用(article-drafting 的 body 字段,
 *   domain/flows.ts)——价值载体字段的工件起草;
 * - notify:T3 确认门送达(挂起 → notifyWorkflow → notification-delivered,
 *   arch-brief §9.1「notify 是第一个 capability」);
 * - clarify:第九层 on-invalid 澄清(definition 语言的 'on-invalid': 'clarify'
 *   声明点;校验失败的意图型字段转澄清 session)。
 *
 * intent/input/output 按 arch-brief 第七层语义填写:能力接口统一
 * artifact(s) in → artifact out(schema 真实化归后续,本 track 仅描述文本)。
 * 常量在模块加载时经 parseCapabilityDefinition 校验——非法定义在此处
 * 就响亮失败(与 flow/application 常量同口径)。
 */
import { parseCapabilityDefinition } from '@ui4a/engine';
import type { CapabilityDefinition } from '@ui4a/shared';

/** 工件起草:proposal 来源的草稿候选产出(模型背书,人类选择门裁决)。 */
export const draftCapability: CapabilityDefinition = parseCapabilityDefinition({
  name: 'draft',
  title: '工件起草',
  kind: 'extract',
  intent:
    '价值载体字段的草稿工件起草:proposal 来源字段(如文章正文)由本能力产出' +
    '候选草稿,经 human-required 选择门裁决后落字段(事实永不发明:出处记 proposal)。',
  input: '字段语义与上下文工件(字段 schema、当前实例字段值、选项数 options)。',
  output: '草稿工件候选集(options 份,供人类选择;arch-brief 第七层:artifact in → artifact out)。',
});

/** 确认门送达:挂起确认提议通知人类(T3 确认门的效应能力)。 */
export const notifyCapability: CapabilityDefinition = parseCapabilityDefinition({
  name: 'notify',
  title: '确认门送达',
  kind: 'effect',
  intent:
    '确认挂起后的通知送达:把 pending 确认提议送达人类收件箱并留痕' +
    '(notification-delivered 事件;arch-brief §9.1「notify 是第一个 capability」,' +
    'Temporal notifyWorkflow 承载,worker 第二写者写入)。',
  input: '挂起确认实体工件(confirmation 快照:目标 rel/动作/提议者/策略原因)。',
  output: '送达留痕工件(notif:<id> 通知 + notification-delivered 事件,确认标记 notified)。',
});

/** 澄清:第九层 on-invalid 的意图缺口收敛(clarify 是 capability 不是聊天)。 */
export const clarifyCapability: CapabilityDefinition = parseCapabilityDefinition({
  name: 'clarify',
  title: '字段澄清',
  kind: 'extract',
  intent:
    '意图型字段的澄清收敛:提交校验失败且字段声明 on-invalid: clarify 时,' +
    '把拒绝转澄清 session,收敛到 schema 满足(第九层:clarify 是 capability' +
    '不是聊天;机械兜底 = 表单,AI 只改善问的质量)。',
  input: '悬挂字段与校验失败现场工件(字段 schema、ajv 错误、当前实体快照)。',
  output: '满足 schema 的字段值工件(出处记 elicited:session-N;意图型失败路由给人)。',
});

/** 种子 capability 列表(声明序 = boot 入日志序)。 */
export const businessCapabilityList: readonly CapabilityDefinition[] = [
  draftCapability,
  notifyCapability,
  clarifyCapability,
];
