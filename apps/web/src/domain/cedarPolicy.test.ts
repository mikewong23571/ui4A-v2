import { describe, expect, it } from 'vitest';

import type { ActionDefinition, ExecRequest } from '@ui4a/engine';

import { cedarConfirmationPolicy, loadPolicyText, POLICY_CANDIDATE_FILES } from './cedarPolicy';

// Cedar 风险策略(T3 Phase B / spec 架构决定 3):
// - (requires-confirmation 标注, actor) 组装成 Cedar 实体求值:
//   allow → 直通;deny → 挂起确认;求值原因与策略 id 入 ConfirmationVerdict
//   (随 confirmation-requested 事件 detail 留痕,spec 验收 5);
// - 策略即数据:裁决由策略文本驱动,换文本即换行为(不经代码变更);
// - fail-safe:策略文件缺失/损坏 → 任何 requires-confirmation 标注动作都确认
//   (fail-closed);无标注动作维持直通。

/** 种子域形状的动作用例:archive 带 high 标注(T2 预埋)。 */
const archive: ActionDefinition = {
  name: 'archive',
  title: '归档',
  'requires-confirmation': 'high',
};
const escalate: ActionDefinition = {
  name: 'escalate',
  title: '升级',
  'requires-confirmation': 'medium',
};
const unpublish: ActionDefinition = { name: 'unpublish', title: '下线' };

const agentRequest: ExecRequest = {
  rel: 'post:post-welcome',
  action: 'archive',
  params: {},
  actor: 'agent',
  principal: 'user:mike',
  channel: 'http',
};
const humanRequest: ExecRequest = { ...agentRequest, actor: 'human' };

describe('loadPolicyText:策略文件装载', () => {
  it('默认候选路径能读到 policy.cedar(内含 permit 语句)', () => {
    const text = loadPolicyText();
    expect(text).toBeDefined();
    expect(text).toContain('permit');
    // 载体是 Cedar 策略文本,不是 TS 逻辑(策略即数据的物理形态)。
    expect(text).toContain('executeAction');
  });

  it('候选全缺失 → undefined(fail-safe 的入口)', () => {
    expect(loadPolicyText(['/definitely/not/here/policy.cedar'])).toBeUndefined();
  });

  it('显式路径可覆盖候选(文件即数据)', () => {
    const text = loadPolicyText([...POLICY_CANDIDATE_FILES]);
    expect(text).toBeDefined();
  });
});

describe('cedarConfirmationPolicy:默认策略文本的裁决矩阵', () => {
  const policy = cedarConfirmationPolicy(loadPolicyText());

  it('agent + high → 需要确认(deny → 挂起)', () => {
    const verdict = policy(agentRequest, archive);
    expect(verdict.required).toBe(true);
    expect(verdict.policy).toMatch(/^cedar:/);
    expect(verdict.reason).toContain('Cedar');
  });

  it('human + high → 直通(人类不因风险挂起)', () => {
    const verdict = policy(humanRequest, archive);
    expect(verdict.required).toBe(false);
    expect(verdict.policy).toMatch(/^cedar:/);
  });

  it('agent + medium → 直通(T3 初始策略只挂 high)', () => {
    const verdict = policy(agentRequest, escalate);
    expect(verdict.required).toBe(false);
  });

  it('agent + 无标注 → 直通(未进门就不需要确认)', () => {
    const verdict = policy(agentRequest, unpublish);
    expect(verdict.required).toBe(false);
  });

  it('actor 缺省按 human(与 exec 日志口径一致)', () => {
    const verdict = policy({ ...agentRequest, actor: undefined }, archive);
    expect(verdict.required).toBe(false);
  });
});

describe('策略即数据:变更策略文本改变裁决行为', () => {
  it('同一请求 (agent + medium):默认文本直通,收紧文本挂起', () => {
    const defaultPolicy = cedarConfirmationPolicy(loadPolicyText());
    expect(defaultPolicy(agentRequest, escalate).required).toBe(false);

    // 收紧:medium 也需要确认(只改数据,不改代码)。
    const strictText = [
      'permit(principal, action == UI4A::Action::"executeAction", resource)',
      '  when { principal.actor == "human" || !(["high", "medium"].contains(resource.risk)) };',
    ].join('\n');
    const strictPolicy = cedarConfirmationPolicy(strictText);
    const verdict = strictPolicy(agentRequest, escalate);
    expect(verdict.required).toBe(true);
    // 收紧后 low 仍直通、human 仍直通(变更只影响声明影响面)。
    expect(strictPolicy(agentRequest, unpublish).required).toBe(false);
    expect(strictPolicy(humanRequest, archive).required).toBe(false);
  });

  it('forbid 语义:显式拒绝的 reason 引用匹配到的策略 id', () => {
    const forbidText = [
      'forbid(principal, action == UI4A::Action::"executeAction", resource)',
      '  when { principal.actor == "agent" && resource.risk == "high" };',
    ].join('\n');
    const policy = cedarConfirmationPolicy(forbidText);
    const verdict = policy(agentRequest, archive);
    expect(verdict.required).toBe(true);
    // forbid 命中时 Cedar diagnostics.reason 携带该策略 id(Cedar 按声明序自动编号)。
    expect(verdict.policy).toContain('policy0');
  });

  it('放行文本:允许理由携带匹配策略 id(留痕锚点)', () => {
    const policy = cedarConfirmationPolicy(loadPolicyText());
    const verdict = policy(humanRequest, archive);
    expect(verdict.required).toBe(false);
    expect(verdict.policy).toMatch(/^cedar:policy\d+/);
  });
});

describe('fail-safe:策略不可用时 fail-closed', () => {
  it('策略文件缺失:任何 requires-confirmation 标注动作都确认;无标注直通', () => {
    const policy = cedarConfirmationPolicy(undefined);
    expect(policy(agentRequest, archive).required).toBe(true);
    expect(policy(agentRequest, escalate).required).toBe(true);
    expect(policy(agentRequest, unpublish).required).toBe(false);
  });

  it('缺失原因入 reason(fail-safe 可审计)', () => {
    const policy = cedarConfirmationPolicy(undefined);
    const verdict = policy(agentRequest, archive);
    expect(verdict.reason).toContain('fail-closed');
  });

  it('策略文本损坏(语法错误):求值失败 fail-closed,无标注仍直通', () => {
    const policy = cedarConfirmationPolicy('permit(principal when {');
    const verdict = policy(agentRequest, archive);
    expect(verdict.required).toBe(true);
    expect(verdict.reason).toContain('求值失败');
    expect(policy(agentRequest, unpublish).required).toBe(false);
  });

  it('空文本按缺失处理', () => {
    const policy = cedarConfirmationPolicy('   ');
    expect(policy(agentRequest, archive).required).toBe(true);
  });
});
