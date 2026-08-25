/**
 * 失败措辞分层(T24 Phase B Task 3)的服务端机械层:
 *
 * - AgentRunResult 的失败终局 → 结构化 reason {code, evidence?, tried?}
 *   (纯函数,零面向用户叙句——服务器不再硬编码失败「友好文案」;现 summary
 *   机器句子降级为机械层/审计数据,进 evidence 可达,真相不消失);
 * - LLM 在场时由结构化 reason 生成一句面向用户的表述 phrasing(AI-first:
 *   prompt 极简、只装结构化数据与指令,不注入文案模板);LLM 不可用/调用
 *   失败 → 无 phrasing,诚实降级(不伪造、不静默、不找人话替身)。
 *
 * 失败码口径:循环机械终止(no_progress_loop,packages/agent 附加暴露)/
 * driver 自述 fail(driver_fail,含 LLM 端点错误折算)/ 起始实体不可得
 * (start_entity_unavailable)/ 循环异常兜底(loop_exception,route 组装)。
 */
import { resolveLlmConfig, type AgentGoal, type AgentRunResult, type TrailStep } from '@ui4a/agent';

import type { ChatFailureReason } from './sse';
import { stepToMessage } from './trail';

/** tried 概要上限(完整轨迹在 final.steps,审计不裁剪)。 */
const TRIED_CAP = 6;

/**
 * 已尝试步骤概要:终局 fail 步以外的轨迹步 → trail.ts 机器投影文本,
 * 有界保留最近 TRIED_CAP 条;零轨迹步(起始实体不可得)返回 undefined。
 */
function triedBrief(steps: TrailStep[]): string[] | undefined {
  const tried = steps
    .filter((step) => step.outcome !== 'failed')
    .map((step) => stepToMessage(step).text);
  if (tried.length === 0) return undefined;
  return tried.slice(-TRIED_CAP);
}

/**
 * 失败终局 → 结构化 reason(纯函数,无 LLM):非失败终局返回 undefined。
 * 机器句子(result.summary === fail op.reason)进 evidence 首行,作为机械层
 * 数据可达;面向用户的表述由 phraseFailureWithLlm 另行生成。
 */
export function failureReasonFromResult(result: AgentRunResult): ChatFailureReason | undefined {
  if (result.outcome !== 'failed') return undefined;
  const lastOp = result.steps.at(-1)?.op;
  if (lastOp?.kind === 'fail') {
    return {
      code: lastOp.code ?? 'driver_fail',
      evidence: [lastOp.reason, ...(lastOp.evidence ?? [])],
      ...(triedBrief(result.steps) !== undefined ? { tried: triedBrief(result.steps) } : {}),
    };
  }
  // 零轨迹失败:起始实体不可得(循环在第一步取实体时即返回)。
  return {
    code: 'start_entity_unavailable',
    evidence: [result.summary ?? '(无摘要)'],
  };
}

/** 表述层指令(极简:任务 + 数据边界 + 输出形态;零文案模板注入)。 */
const PHRASING_SYSTEM_PROMPT = [
  '你是聊天助手的失败表述层。',
  '输入是一次 agent 回合的机械失败数据(JSON:goal/code/summary/evidence/tried)。',
  '依据且仅依据这些数据,用一句中文向用户说明这次失败发生了什么。',
  '禁止:编造数据外的事实、安慰或道歉、行动建议、输出多于一句。',
  '直接输出这一句话。',
].join('\n');

/**
 * LLM 表述(AI-first):失败终局且 LLM 可用时,由结构化 reason 生成一句
 * 面向用户的表述。LLM 配置缺失 → 零网络调用返回 undefined;调用失败/
 * 形状异常/空输出 → undefined。永不抛异常、永不伪造表述。
 */
export async function phraseFailureWithLlm(args: {
  reason: ChatFailureReason;
  goal: AgentGoal;
  /** 机器句子(审计层原文;供模型对照,不是表述模板)。 */
  summary?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<string | undefined> {
  let config;
  try {
    config = resolveLlmConfig();
  } catch {
    // LLM 缺席:诚实降级(中性结构化展示),不找人话替身。
    return undefined;
  }
  const fetchImpl = args.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const payload = {
    goal: args.goal.verb,
    code: args.reason.code,
    ...(args.summary !== undefined ? { summary: args.summary } : {}),
    ...(args.reason.evidence !== undefined ? { evidence: args.reason.evidence } : {}),
    ...(args.reason.tried !== undefined ? { tried: args.reason.tried } : {}),
  };
  try {
    const response = await fetchImpl(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: PHRASING_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return undefined;
    const trimmed = content.trim();
    return trimmed === '' ? undefined : trimmed;
  } catch {
    // 调用失败:表述缺席是事实,如实降级(不静默伪造)。
    return undefined;
  }
}
