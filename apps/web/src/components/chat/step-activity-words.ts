/**
 * step 帧活动语言的固定 op 词表(T24 Phase B Task 2):协议动词 → 「正在做
 * 什么」的舞台机械词汇。纯常量映射——零每实体/每应用分支;{title}/{subject}
 * 是服务器从实体/动作合同取的显示数据,客户端零猜测。
 *
 * 施工纪律红线(与 mechanism-words 同源):本表是固定常量;新增 op 直接追加
 * 字面量,禁止按应用/实体类型生成分支。词表覆盖 agent 协议全部实际 op
 * (packages/agent types.ts AgentOperation);未知 op 走中性回退并显式携带
 * op,不静默吞。
 */
import type { ChatStepActivity } from '@/chat/sse';

/** 已知 op → 活动语言模板(占位符:{title} {subject})。 */
export const STEP_ACTIVITY_WORDS: Readonly<Record<string, string>> = {
  navigate: '正在读取 {title}',
  exec: '正在执行 {title}',
  present: '正在准备「{subject}」的呈现',
  answer: '正在整理回答',
  clarify: '正在向你确认',
  'exec-plan': '正在执行计划',
  done: '已完成',
  fail: '遇到问题',
};

/** 未知 op 的中性回退(显式携带 op,不静默吞)。 */
export const UNKNOWN_STEP_ACTIVITY_WORD = '正在处理 · {op}';

/**
 * metadata.custom.activity 边界的运行时形状守卫(外部 store 的 custom 是
 * unknown 通道);命中时返回原引用——选择器以 Object.is 判稳,不得重建对象。
 */
export function isChatStepActivity(value: unknown): value is ChatStepActivity {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['op'] === 'string' && record['op'] !== '';
}

/**
 * 结构化活动数据 → 活动语言文本:按 op 查表(未知走中性回退),占位符替换
 * 缺失字段渲染为空(标题缺失不伪造;真相在审计下钻与机器层 message.text)。
 */
export function stepActivityText(activity: ChatStepActivity): string {
  const template = STEP_ACTIVITY_WORDS[activity.op] ?? UNKNOWN_STEP_ACTIVITY_WORD;
  // 占位符缺失渲染为空并收尾空白(不伪造标题;真相在审计下钻与机器层 text)。
  return template
    .replaceAll('{title}', activity.title ?? '')
    .replaceAll('{subject}', activity.subject ?? '')
    .replaceAll('{op}', activity.op)
    .trim();
}
