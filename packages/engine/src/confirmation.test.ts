import { describe, expect, it } from 'vitest';

import { builtinConfirmationPolicy, confirmGate } from './confirmation';
import type { ConfirmationPolicy } from './confirmation';
import type { ExecRequest } from './judge';
import type { ActionDefinition } from './types';

// 确认门策略裁决(TDD 红→绿;arch-brief §3:guard 第三语义"挂起";
// requires-confirmation 是策略标注不是状态谓词——标注答"这个 actor 是否需要
// 委托人确认",谓词答"状态允许吗")。
// 内置规则(Phase B 由 Cedar 策略替换,策略函数是注入点):
//   requires-confirmation === 'high' && actor === 'agent' → 需确认;
//   human 直通;无标注直通。

const archiveHigh: ActionDefinition = {
  name: 'archive',
  title: '归档',
  to: 'archived',
  'requires-confirmation': 'high',
};

const archiveLow: ActionDefinition = { ...archiveHigh, 'requires-confirmation': 'low' };
const unpublish: ActionDefinition = { name: 'unpublish', title: '下线', to: 'offline' };

function request(actor?: 'human' | 'agent'): ExecRequest {
  return { rel: 'post:post-welcome', action: 'archive', params: {}, actor };
}

describe('confirmGate — 挂起矩阵(内置策略)', () => {
  it('high + actor=agent → 需确认(required=true)', () => {
    const verdict = confirmGate(request('agent'), archiveHigh);
    expect(verdict.required).toBe(true);
  });

  it('low + actor=agent → 直通(内置策略仅 high 挂起;Cedar 接入后可收紧)', () => {
    expect(confirmGate(request('agent'), archiveLow).required).toBe(false);
  });

  it('high + actor=human → 直通(human 不需要向自己确认)', () => {
    expect(confirmGate(request('human'), archiveHigh).required).toBe(false);
  });

  it('无 requires-confirmation 标注 → 直通(任何 actor)', () => {
    expect(confirmGate(request('agent'), unpublish).required).toBe(false);
    expect(confirmGate(request('human'), unpublish).required).toBe(false);
  });

  it('actor 缺省按 human(与 exec 日志口径一致)→ 直通', () => {
    expect(confirmGate(request(undefined), archiveHigh).required).toBe(false);
  });

  it('判定携带 policy 标识与人类可读 reason(策略原因入事件)', () => {
    const verdict = confirmGate(request('agent'), archiveHigh);
    expect(verdict.policy).toBe('builtin:high-agent');
    expect(verdict.reason).toContain('requires-confirmation=high');
    expect(verdict.reason).toContain('agent');

    const pass = confirmGate(request('human'), archiveHigh);
    expect(pass.policy).toBe('builtin:human-pass');
    expect(pass.reason.length).toBeGreaterThan(0);
  });
});

describe('confirmGate — 策略注入(Phase B Cedar 替换点)', () => {
  it('自定义 policy 决定挂起(如 medium+agent 也需确认)', () => {
    const cedarLike: ConfirmationPolicy = (_req, action) => ({
      required: action['requires-confirmation'] !== undefined,
      reason: 'cedar 策略文本判定',
      policy: 'cedar:wasm',
    });
    const verdict = confirmGate(request('agent'), archiveLow, cedarLike);
    expect(verdict).toEqual({
      required: true,
      reason: 'cedar 策略文本判定',
      policy: 'cedar:wasm',
    });
  });

  it('缺省 policy 即内置策略', () => {
    expect(confirmGate(request('agent'), archiveHigh).policy).toBe(
      builtinConfirmationPolicy(request('agent'), archiveHigh).policy,
    );
  });
});
