/**
 * guard 合同:谓词注册表的名字→纯函数形状(engine 只持注册表,实现在本包)。
 *
 * 铁律(arch-brief §3):guard 纯且快、只读快照、永远不调 capability——
 * capability 结果先落状态,guard 再读状态。
 * "按钮的 disabled 与 Agent 看到的 guard 不满足是同一个谓词的两个投影。"
 */
import type { EngineSnapshot, InstanceSnapshot } from './state';

/** guard 求值上下文:实例 + 全局快照(只读)+ 本次动作参数。 */
export interface GuardContext {
  instance: Readonly<InstanceSnapshot>;
  snapshot: Readonly<EngineSnapshot>;
  params: Readonly<Record<string, unknown>>;
}

/** 谓词:纯函数,输入快照与参数,输出布尔。 */
export type GuardPredicate = (context: GuardContext) => boolean;

/** 注册表:名字 → 谓词。 */
export type GuardRegistry = Readonly<Record<string, GuardPredicate>>;

/** 单个 guard 的求值结果(逐项注入实体 guard-results;拒绝即教育)。 */
export interface GuardEvaluation {
  name: string;
  pass: boolean;
  /** 失败/异常原因(如 guard 未注册、谓词抛错)。 */
  reason?: string;
}
