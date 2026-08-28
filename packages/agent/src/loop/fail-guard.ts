/**
 * 循环机械收敛护栏家族(T36 C2 自 loop.ts 提取;T35 C5 / 协议级有限性保护
 * 的终止判定语义逐字不变)。
 *
 * 循环不猜业务完成条件,只对完全相同的可观察状态做协议级保护:
 * - **repeated_rejection**:同一动作同一参数被拒,计划重试不烧步数,第二次
 *   同键拒绝即结构化失败(code=repeated_rejection,原因回流原拒绝)。
 * - **no_progress_loop**:同一合同处境(含最新拒绝身份)第三次出现且期间没有
 *   成功 exec——driver 正在机械绕圈,当前合同未暴露完成目标所需的可执行能力。
 *
 * 护栏只产 fail 轨迹步(经注入的 fail sink 落轨迹),不改循环其他语义;
 * 落轨迹与判定在同一函数内,保持终止判定单一可读。
 */
import type { RejectionRecord, TrailStep } from '../types';

/** 护栏产出的 fail 操作(结构化失败码口径,T24 起 code 供上层组装)。 */
export type FailGuardOp = Extract<TrailStep['op'], { kind: 'fail' }>;

type FailSink = (step: TrailStep) => Promise<void>;

export function createRepeatedRejectionGuard(fail: FailSink) {
  const rejectionCounts = new Map<string, number>();
  return {
    /** 同键第二次及以后的拒绝:落 repeated_rejection fail 步并返回 true。 */
    async record(
      step: number,
      rel: string,
      action: string | undefined,
      params: Record<string, unknown> | undefined,
      rejection: RejectionRecord,
    ): Promise<boolean> {
      const key = `${rel}|${action ?? ''}|${JSON.stringify(params ?? {})}`;
      const count = (rejectionCounts.get(key) ?? 0) + 1;
      rejectionCounts.set(key, count);
      if (count < 2) return false;
      const op: FailGuardOp = {
        kind: 'fail',
        code: 'repeated_rejection',
        reason: `同一动作反复被拒（${count} 次），机械收敛：${rejection.reason}`,
        evidence: [`${rejection.rel}#${rejection.action ?? ''}`, `layer:${rejection.layer ?? ''}`],
      };
      await fail({ step, rel, op, outcome: 'failed' });
      return true;
    },
  };
}

export function createNoProgressGuard() {
  const stateVisits = new Map<string, number>();
  return {
    /**
     * 记录一次处境访问;第三次相同处境时落 no_progress_loop fail 步并返回该
     * 操作(调用方以 reason 组装 failed summary),未触发返回 undefined。
     */
    async recordVisit(input: {
      step: number;
      rel: string;
      actionNames: readonly string[];
      successes: number;
      lastRejection: RejectionRecord | undefined;
      fail: FailSink;
    }): Promise<FailGuardOp | undefined> {
      const stateSignature = JSON.stringify({
        rel: input.rel,
        actions: [...input.actionNames].sort(),
        successes: input.successes,
        rejection:
          input.lastRejection === undefined
            ? null
            : {
                rel: input.lastRejection.rel,
                action: input.lastRejection.action ?? null,
                layer: input.lastRejection.layer ?? null,
              },
      });
      const visits = (stateVisits.get(stateSignature) ?? 0) + 1;
      stateVisits.set(stateSignature, visits);
      if (visits < 3) return undefined;
      const op: FailGuardOp = {
        kind: 'fail',
        code: 'no_progress_loop',
        reason: `检测到无进展导航循环；当前合同未暴露完成目标所需的可执行能力`,
        evidence: [
          `重复处境:${input.rel}`,
          `可用动作:${input.actionNames.join(',') || '(无)'}`,
          `已成功执行:${input.successes}`,
        ],
      };
      await input.fail({ step: input.step, rel: input.rel, op, outcome: 'failed' });
      return op;
    },
  };
}
