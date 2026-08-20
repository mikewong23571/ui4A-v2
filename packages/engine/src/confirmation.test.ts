import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';
import type { EngineSnapshot } from '@ui4a/shared';

import {
  approveConfirmation,
  builtinConfirmationPolicy,
  confirmGate,
  rejectConfirmation,
} from './confirmation';
import type { ConfirmationPolicy } from './confirmation';
import { executeWithGates } from './execute';
import type { ExecRequest } from './judge';
import { flowRegistry, postStatusFlow, seedSnapshot } from './fixtures';
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

// ---------------------------------------------------------------------------
// approve / reject(人类裁决入口;铁律 5:审批不委托)
// ---------------------------------------------------------------------------

const deps = { flows: flowRegistry(postStatusFlow), guards: seedGuardRegistry };

const agentArchiveRequest: ExecRequest = {
  rel: 'post:post-welcome',
  action: 'archive',
  params: {},
  actor: 'agent',
  principal: 'user:mike',
  channel: 'http',
};

/** 在线挂起一次(agent archive post-welcome)得到带 pending c1 的快照。 */
function suspendedSnapshot(): EngineSnapshot {
  const outcome = executeWithGates(agentArchiveRequest, seedSnapshot, deps);
  if (outcome.kind !== 'suspended') {
    throw new Error(`测试前置失败:期望 suspended,得到 ${outcome.kind}`);
  }
  return outcome.snapshot;
}

describe('approveConfirmation — human 生效路径', () => {
  it('human approve → 应用原目标动作效果(post-welcome → archived)', () => {
    const decision = approveConfirmation(
      suspendedSnapshot(),
      'c1',
      { actor: 'human', principal: 'user:mike' },
      deps,
    );
    expect(decision.kind).toBe('confirmed');
    if (decision.kind !== 'confirmed') return;
    expect(decision.snapshot.instances['post:post-welcome']?.node).toBe('archived');
  });

  it('事件链:confirmation-approved(提议者/审批者留痕)+ action-executed(委托语义)', () => {
    const decision = approveConfirmation(
      suspendedSnapshot(),
      'c1',
      { actor: 'human', principal: 'user:mike' },
      deps,
    );
    expect(decision.kind).toBe('confirmed');
    if (decision.kind !== 'confirmed') return;

    expect(decision.events.map((event) => event.kind)).toEqual([
      'confirmation-approved',
      'action-executed',
    ]);
    expect(decision.events[0]).toMatchObject({
      kind: 'confirmation-approved',
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: 'user:mike',
      channel: 'confirmation',
    });
    expect(decision.events[0]?.detail).toEqual({
      id: 'c1',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      decidedBy: { actor: 'human', principal: 'user:mike' },
    });
    // 委托语义:生效动作 actor=human,principal=提议者的 principal,信道=confirmation。
    expect(decision.events[1]).toMatchObject({
      kind: 'action-executed',
      rel: 'post:post-welcome',
      action: 'archive',
      actor: 'human',
      principal: 'user:mike',
      channel: 'confirmation',
      to: 'archived',
    });
  });

  it('confirmation 状态 → approved,实体保留供审计(approvedBy 记录审批者)', () => {
    const decision = approveConfirmation(
      suspendedSnapshot(),
      'c1',
      { actor: 'human', principal: 'user:mike' },
      deps,
    );
    expect(decision.kind).toBe('confirmed');
    if (decision.kind !== 'confirmed') return;
    expect(decision.snapshot.confirmations?.['confirmation:c1']).toMatchObject({
      id: 'c1',
      status: 'approved',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      approvedBy: { actor: 'human', principal: 'user:mike' },
    });
  });

  it('approve 不改动输入快照(纯函数)', () => {
    const snapshot = suspendedSnapshot();
    const before = JSON.stringify(snapshot);
    approveConfirmation(snapshot, 'c1', { actor: 'human' }, deps);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('重复 approve(已 approved)→ rejected:approve 未声明于非 pending 状态', () => {
    const first = approveConfirmation(
      suspendedSnapshot(),
      'c1',
      { actor: 'human' },
      deps,
    );
    expect(first.kind).toBe('confirmed');
    if (first.kind !== 'confirmed') return;

    const second = approveConfirmation(first.snapshot, 'c1', { actor: 'human' }, deps);
    expect(second).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    if (second.kind !== 'rejected') return;
    expect(second.reason).toContain('approved');
  });

  it('不存在的确认 id → rejected(undeclared)', () => {
    const decision = approveConfirmation(suspendedSnapshot(), 'ghost', { actor: 'human' }, deps);
    expect(decision).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    if (decision.kind !== 'rejected') return;
    expect(decision.reason).toContain('ghost');
  });

  it('挂起后目标状态漂移(动作不再声明于当前节点)→ rejected,不应用效果', () => {
    // 挂起后有人把文章 unpublish 了(offline 节点无 archive)。
    const drifted: EngineSnapshot = {
      ...suspendedSnapshot(),
      instances: {
        ...suspendedSnapshot().instances,
        'post:post-welcome': {
          ...suspendedSnapshot().instances['post:post-welcome']!,
          node: 'offline',
        },
      },
    };
    const decision = approveConfirmation(drifted, 'c1', { actor: 'human' }, deps);
    expect(decision).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    if (decision.kind !== 'rejected') return;
    expect(decision.reason).toContain('offline');
  });
});

describe('approveConfirmation — I4(agent 审批被拒,铁律 5)', () => {
  it('agent approve → guard 拒绝形态(actor-is-human=false),确认仍 pending', () => {
    const snapshot = suspendedSnapshot();
    const decision = approveConfirmation(snapshot, 'c1', { actor: 'agent' }, deps);

    expect(decision).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (decision.kind !== 'rejected') return;
    expect(decision.reason).toContain('actor-is-human');
    expect(decision.detail).toEqual([{ name: 'actor-is-human', pass: false }]);

    // 确认未被消费:human 仍可审批(状态还是 pending)。
    const retry = approveConfirmation(snapshot, 'c1', { actor: 'human' }, deps);
    expect(retry.kind).toBe('confirmed');
  });
});

describe('rejectConfirmation — 驳回路径', () => {
  it('human reject 带原因 → confirmation-rejected 留痕,原动作永不生效', () => {
    const decision = rejectConfirmation(
      suspendedSnapshot(),
      'c1',
      { actor: 'human', principal: 'user:mike' },
      '这篇文章还在服务中,不归档',
      deps,
    );
    expect(decision.kind).toBe('confirmed');
    if (decision.kind !== 'confirmed') return;

    // 目标实体不动:仍是 published。
    expect(decision.snapshot.instances['post:post-welcome']?.node).toBe('published');
    // 只产出 confirmation-rejected(无 action-executed)。
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]).toMatchObject({
      kind: 'confirmation-rejected',
      rel: 'confirmation:c1',
      action: 'reject',
      actor: 'human',
      principal: 'user:mike',
      channel: 'confirmation',
      reason: '这篇文章还在服务中,不归档',
    });
    expect(decision.events[0]?.detail).toEqual({
      id: 'c1',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      decidedBy: { actor: 'human', principal: 'user:mike' },
      reason: '这篇文章还在服务中,不归档',
    });
    // 状态 → rejected,原因入快照,实体保留。
    expect(decision.snapshot.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'rejected',
      rejectedReason: '这篇文章还在服务中,不归档',
    });
  });

  it('agent reject → guard 拒绝(I4 同样适用于驳回)', () => {
    const decision = rejectConfirmation(suspendedSnapshot(), 'c1', { actor: 'agent' }, '想撤就撤', deps);
    expect(decision).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (decision.kind !== 'rejected') return;
    expect(decision.reason).toContain('actor-is-human');
  });

  it('reason 为空字符串 → schema-invalid 拒绝(minLength=1)', () => {
    const decision = rejectConfirmation(suspendedSnapshot(), 'c1', { actor: 'human' }, '', deps);
    expect(decision).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    if (decision.kind !== 'rejected') return;
    const errors = decision.detail as Array<{ keyword: string }>;
    expect(errors.some((error) => error.keyword === 'minLength')).toBe(true);
  });

  it('不存在的确认 id / 非 pending 状态 → rejected(undeclared)', () => {
    expect(rejectConfirmation(suspendedSnapshot(), 'ghost', { actor: 'human' }, 'r', deps)).toMatchObject(
      { kind: 'rejected', layer: 'undeclared' },
    );

    const approved = approveConfirmation(suspendedSnapshot(), 'c1', { actor: 'human' }, deps);
    if (approved.kind !== 'confirmed') throw new Error('前置失败');
    expect(
      rejectConfirmation(approved.snapshot, 'c1', { actor: 'human' }, 'r', deps),
    ).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });

  it('reject 不改动输入快照(纯函数)', () => {
    const snapshot = suspendedSnapshot();
    const before = JSON.stringify(snapshot);
    rejectConfirmation(snapshot, 'c1', { actor: 'human' }, '不要', deps);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
