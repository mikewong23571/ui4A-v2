/**
 * Cedar 风险策略(T3 Phase B / spec 架构决定 3):ConfirmationPolicy 的 Cedar 实现。
 *
 * 职责:把 (action.requires-confirmation 标注, exec 请求的 actor) 组装成 Cedar
 * 实体求值——策略文本是数据(存 src/domain/policy.cedar),换文本即换行为,
 * 不改代码。语义映射:isAuthorized = allow → 直通;deny → 挂起确认;求值原因与
 * 匹配的策略 id 入 ConfirmationVerdict,随 confirmation-requested 事件 detail
 * 留痕(spec 验收 5)。
 *
 * fail-safe(fail-closed):策略文件缺失、为空或求值失败(语法损坏等)时,
 * 任何带 requires-confirmation 标注的动作一律挂起确认;无标注动作维持直通
 * (标注是"进门门票",门坏了不能把没进门的人也拦下,但进过门的必须看好)。
 *
 * 位置说明:放在 apps/web(spec 决定 3 把 policy.cedar 固定在此;依赖
 * @cedar-policy/cedar-wasm 是 wasm,不进 engine(纯 TS 两栖)与 shared(叶子包,
 * 反向依赖 engine 的 ConfirmationPolicy 类型会成环)。worker 若在 T4+ 需要评估,
 * 抽独立 packages/policy 即可——D3 允许后续增包。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isAuthorized } from '@cedar-policy/cedar-wasm';
import type {
  ActionDefinition,
  ConfirmationPolicy,
  ConfirmationVerdict,
  ExecRequest,
} from '@ui4a/engine';

/**
 * 策略文件候选路径(按序试读,全缺 → fail-safe)。
 * cwd 口径:vitest 从仓库根跑(apps/web/…),next dev 的 cwd 是 apps/web(src/…)。
 * 不用 import.meta.url:Next 服务端打包形态下不可靠(webpack CJS)。
 */
export const POLICY_CANDIDATE_FILES: readonly string[] = [
  'src/domain/policy.cedar',
  'apps/web/src/domain/policy.cedar',
];

/**
 * 读取策略文本(策略即数据的物理装载)。文件缺失不是异常路径——返回
 * undefined 交给 fail-safe;IO 错误(权限等)同样按缺失处理并让原因可见。
 */
export function loadPolicyText(
  candidates: readonly string[] = POLICY_CANDIDATE_FILES,
): string | undefined {
  for (const candidate of candidates) {
    try {
      return readFileSync(path.resolve(candidate), 'utf8');
    } catch {
      // 试下一个候选;全缺走 fail-safe。
    }
  }
  return undefined;
}

/** Cedar 求值的实体形状常量(与 policy.cedar 头注的实体模型一一对应)。 */
const EXECUTOR_TYPE = 'UI4A::Executor';
const RESOURCE_TYPE = 'UI4A::Resource';
const ACTION_EUID = { type: 'UI4A::Action', id: 'executeAction' } as const;

/** 无标注动作注入的风险档位(策略文本可对 "none" 表态)。 */
const RISK_NONE = 'none';

/** fail-safe 裁决:策略不可用时 fail-closed(标注动作挂起,无标注直通)。 */
function failSafeVerdict(action: ActionDefinition, cause: string): ConfirmationVerdict {
  const level = action['requires-confirmation'];
  if (level === undefined) {
    return {
      required: false,
      reason: `Cedar 策略不可用(${cause});动作未声明 requires-confirmation,直通`,
      policy: 'cedar:fail-safe:none',
    };
  }
  return {
    required: true,
    reason: `Cedar 策略不可用(${cause})且动作标注 requires-confirmation=${level},fail-closed 挂起确认`,
    policy: 'cedar:fail-closed',
  };
}

/** 策略文本损坏时的首条错误摘要(入 reason,可审计)。 */
function firstError(errors: readonly { message?: unknown }[]): string {
  const message = errors[0]?.message;
  if (typeof message === 'string' && message !== '') return message;
  return '未知错误';
}

/**
 * 构造 Cedar 确认策略(纯求值,无 IO;文本由调用方装载,便于测试注入)。
 * policyText 为 undefined/空白 → fail-safe 策略。
 */
export function cedarConfirmationPolicy(policyText: string | undefined): ConfirmationPolicy {
  return (request: ExecRequest, action: ActionDefinition): ConfirmationVerdict => {
    if (policyText === undefined || policyText.trim() === '') {
      return failSafeVerdict(action, '策略文件缺失或为空');
    }

    const actor = request.actor ?? 'human';
    const risk = action['requires-confirmation'] ?? RISK_NONE;
    const answer = isAuthorized({
      principal: { type: EXECUTOR_TYPE, id: actor },
      action: ACTION_EUID,
      resource: { type: RESOURCE_TYPE, id: request.rel },
      context: {},
      policies: { staticPolicies: policyText },
      entities: [
        {
          uid: { type: EXECUTOR_TYPE, id: actor },
          attrs: { actor },
          parents: [],
        },
        {
          uid: { type: RESOURCE_TYPE, id: request.rel },
          attrs: { risk },
          parents: [],
        },
      ],
    });

    if (answer.type === 'failure') {
      return failSafeVerdict(action, `Cedar 求值失败:${firstError(answer.errors)}`);
    }

    const { decision, diagnostics } = answer.response;
    const matched = diagnostics.reason.join('+');
    if (decision === 'allow') {
      return {
        required: false,
        reason: `Cedar 允许直通(actor=${actor}, risk=${risk};匹配策略:${matched || '无'})`,
        policy: `cedar:${matched || 'allow'}`,
      };
    }
    return {
      required: true,
      reason: `Cedar 未许可(actor=${actor}, risk=${risk};确定策略:${matched || '无匹配 permit,默认拒绝'}),挂起等待人类确认`,
      policy: `cedar:deny:${matched || 'no-permit'}`,
    };
  };
}

/**
 * 服务层缺省接线:policy.cedar 文本驱动的确认策略(boot 时装配一次;
 * 改策略文件后重启生效,T4 挪 _meta 实体后热更新)。
 */
export function cedarPolicyFromDefaultFile(): ConfirmationPolicy {
  return cedarConfirmationPolicy(loadPolicyText());
}
