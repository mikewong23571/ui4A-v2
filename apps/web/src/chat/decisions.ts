/**
 * agent-decision 审计留痕(T11 Phase B / 架构决定 3):inline 路径每步决策一条事件
 * ({kind:'agent-decision', rel: chat:<sessionId>, actor/principal/channel 同
 * chat-turn, detail:{step, driver, prompt, reasoning, op}})。
 *
 * 捕获方案:route 层包装 driver,在 decide 时刻记录——决策输入(当前实体/轨迹/
 * 最近拒绝)只存在于 decide 时的 DriverContext;TrailStep 是操作执行后的投影,
 * 回推不出决策输入,onStep 回调拿不到 prompt。包装器让循环协议(loop.ts)零改动
 * (Phase C 起 driver 接口新增可选 sink 第二参,用于 reasoning 捕获与透传)。
 *
 * prompt 口径:
 * - llm:发给端点的 {system, user} 全量原文——经 llm-driver 导出的同一对纯函数
 *   (buildSystemPrompt/buildUserPrompt)从同一上下文重建,与实际发送逐字节一致,
 *   训练提取免回放重建(工具投影形状合同冻结,动作清单已内嵌于 user prompt 的
 *   「当前实体」节);
 * - rule:rule driver 无自然语言 prompt(确定性词级启发式)——存其决策输入的
 *   结构化摘要(目标/当前 rel/实体摘要/guard 阻断/最近拒绝/已成功执行;机械层
 *   轨迹是蒸馏的正确答案生成器)。轨迹本身不冗余存储:在 chat-turn 的 steps 与
 *   本事件链的既有 op 序列中可得。
 *
 * reasoning:llm 路径自 Phase C streamText 改造起填真值——包装器把内部 sink
 * 透传给被包 driver,decide 产出推理自述时一次性捕获(聚合整段,D22),并原样
 * 转发给上游 sink(loop 的 onReasoning 通道);rule 与端点不返回时恒 null。
 */
import {
  buildSystemPrompt,
  buildUserPrompt,
  summarizeEntity,
  type AgentDriver,
  type AgentGoal,
  type AgentOperation,
  type DriverContext,
  type EntitySummary,
  type ExecSuccess,
  type RejectionRecord,
} from '@ui4a/agent';

/** llm 路径的 prompt 记录:发给端点的 system/user 原文(同函数同上下文重建)。 */
export interface LlmPromptRecord {
  system: string;
  user: string;
}

/** rule 路径的 prompt 记录:无自然语言 prompt,存决策输入的结构化摘要。 */
export interface RulePromptRecord {
  goal: AgentGoal;
  currentRel: string;
  /** 决策时实体的紧凑投影(summarizeEntity:rel/class/node/count/动作清单)。 */
  entity: EntitySummary;
  /** guard-results 标记 blocked 的动作名(换路径规则的输入)。 */
  blocked: string[];
  /** 上一步拒绝(拒绝即数据回流;无则 null)。 */
  lastRejection: RejectionRecord | null;
  /** done 判定原料(完成类动作的成功记录)。 */
  successes: ExecSuccess[];
}

/** agent-decision 事件的 detail 载荷(五要素:step/driver/prompt/reasoning/op)。 */
export interface AgentDecisionDetail {
  /** 步号(与 TrailStep.step 对齐:decide 时上下文 trail 长度 + 1)。 */
  step: number;
  driver: 'rule' | 'llm';
  prompt: LlmPromptRecord | RulePromptRecord;
  /** 推理自述:llm 路径为 driver 产出的聚合整段;rule 与端点不返回时恒 null。 */
  reasoning: string | null;
  /** 该步决策产出的操作(协议动词原样)。 */
  op: AgentOperation;
}

/** 按实际 driver 构造 prompt 记录(口径见模块头)。 */
function promptRecord(
  driver: 'rule' | 'llm',
  context: DriverContext,
): LlmPromptRecord | RulePromptRecord {
  if (driver === 'llm') {
    return {
      system: buildSystemPrompt({ role: context.role, app: context.app }),
      user: buildUserPrompt(context),
    };
  }
  return {
    goal: context.goal,
    currentRel: context.currentRel,
    entity: summarizeEntity(context.entity),
    blocked: (context.entity['guard-results'] ?? [])
      .filter((entry) => entry.blocked)
      .map((entry) => entry.action),
    lastRejection: context.lastRejection ?? null,
    successes: context.successes,
  };
}

/**
 * driver 审计包装:decide 原样透传,产出后把决策记录推给 collect。
 * reasoning 经内部 sink 捕获(T11 Phase C:llm driver 决策时一次性回调聚合
 * 整段自述),并转发给上游 sink——审计留痕与 loop 的 onReasoning 通道共用同
 * 一次 driver 回调。记录构造失败只丢该条留痕,op 照常回流——观测者不得污染
 * 协议(decide 永不抛异常的口径不因留痕而破)。
 */
export function wrapDriverForAudit(
  base: AgentDriver,
  driver: 'rule' | 'llm',
  collect: (detail: AgentDecisionDetail) => void,
): AgentDriver {
  return {
    decide: async (context, sink) => {
      let reasoning: string | null = null;
      const op = await base.decide(context, {
        onReasoning: (text) => {
          // 先捕获再转发:上游(loop onReasoning)抛错不得弄丢审计留痕;
          // 转发本身兜底——driver 侧亦有 guard,双保险均不影响 op 回流。
          reasoning = text;
          try {
            sink?.onReasoning?.(text);
          } catch {
            // 上游观测者异常吞掉(观测者不得污染协议)。
          }
        },
      });
      try {
        collect({
          step: context.trail.length + 1,
          driver,
          prompt: promptRecord(driver, context),
          reasoning,
          op,
        });
      } catch {
        // 留痕构造失败(观测侧缺陷):跳过该条,决策结果原样回流。
      }
      return op;
    },
  };
}
