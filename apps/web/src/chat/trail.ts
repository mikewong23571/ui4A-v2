/**
 * 轨迹 → 聊天消息投影(arch-brief §8:聊天界面就是事件日志的投影层)。
 *
 * 每步一条 assistant 消息:导航到 X / 执行 Y(参数摘要)/ 被拒:原因 /
 * 导航失败:原因 / 完成 / 失败;max-steps 结局补一条上限说明。
 * 服务端组装一次性 JSON 响应(简单可靠;流式为加分项,非 T2 必需)。
 */
import type { AgentRunResult, TrailStep } from '@ui4a/agent';

export interface ChatMessage {
  role: 'assistant';
  text: string;
}

function paramsBrief(params: Record<string, unknown> | undefined): string {
  if (params === undefined) return '';
  const entries = Object.entries(params);
  if (entries.length === 0) return '';
  return ` ${JSON.stringify(params)}`;
}

/**
 * 轨迹一步 → 聊天消息(inline 与 delegated 共用:委托详情的 messages 投影
 * 复用本函数,保证两种模式的轨迹消息逐条等值——T5 spec 验收 6)。
 */
export function stepToMessage(step: TrailStep): ChatMessage {
  const { op, outcome } = step;
  switch (op.kind) {
    case 'navigate':
      return outcome === 'navigated'
        ? { role: 'assistant', text: `导航到 ${op.rel}` }
        : {
            role: 'assistant',
            text: `导航失败(${op.rel}): ${step.rejection?.reason ?? '不可达'}`,
          };
    case 'answer':
      return { role: 'assistant', text: op.content };
    case 'clarify':
      return { role: 'assistant', text: op.question };
    case 'present':
      return {
        role: 'assistant',
        text: `正在准备「${typeof op.subject === 'string' ? op.subject : op.subject.selection.join('、')}」的呈现`,
      };
    case 'exec':
      return outcome === 'executed'
        ? {
            role: 'assistant',
            text: `执行 ${op.action}(${step.rel})${paramsBrief(op.params)}`,
          }
        : outcome === 'suspended'
          ? {
              role: 'assistant',
              text: `已挂起 ${op.action}(${step.rel})，等待人类确认`,
            }
          : {
              role: 'assistant',
              text: `被拒 ${op.action}(${step.rel}): ${step.rejection?.reason ?? '未知原因'}`,
            };
    case 'exec-plan':
      return outcome === 'executed'
        ? { role: 'assistant', text: `一次批量裁决 ${op.steps.length} 步` }
        : outcome === 'suspended'
          ? { role: 'assistant', text: `批量计划已挂起，等待人类确认` }
          : {
              role: 'assistant',
              text: `批量计划被拒: ${step.rejection?.reason ?? '未知原因'}`,
            };
    case 'done':
      return { role: 'assistant', text: `完成: ${op.summary}` };
    case 'fail':
      return { role: 'assistant', text: `失败: ${op.reason}` };
  }
}

/** 一次 runAgent 结果 → assistant 消息序列(悬浮窗逐条渲染)。 */
export function trailToMessages(result: AgentRunResult): ChatMessage[] {
  const messages = result.steps.map(stepToMessage);
  if (result.outcome === 'max-steps') {
    messages.push({ role: 'assistant', text: `达到步数上限: ${result.summary ?? ''}`.trimEnd() });
  }
  return messages;
}
