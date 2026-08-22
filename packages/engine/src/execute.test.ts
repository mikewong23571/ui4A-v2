import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';
import type { EngineSnapshot } from '@ui4a/shared';

import { executeWithGates } from './execute';
import { commentModerationFlow, flowRegistry, postStatusFlow, seedSnapshot } from './fixtures';
import type { ConfirmationPolicy } from './confirmation';
import type { FlowDefinition } from './types';

// exec 编排层(TDD 红→绿):三层裁决(声明→guard→schema)全过之后、
// 效果应用之前,插入确认裁决(第四步,策略层;arch-brief §3 guard 第三语义)。
//   需确认 → 效果不应用,产出 confirmation:<id> 实体(pending)+ 事件
//   confirmation-requested(含原请求全文),exec 结果 suspended(挂起,非拒绝);
//   无需确认 → applyEffects 照常(action-executed 事件链)。

/** 带参数的 high 动作(验证挂起摘要携带原参数与出处)。 */
const riskyFlow: FlowDefinition = {
  name: 'risky-ops',
  initial: 'ready',
  nodes: [
    {
      name: 'ready',
      title: '就绪',
      actions: [
        {
          name: 'deploy',
          title: '部署',
          to: 'deployed',
          'requires-confirmation': 'high',
          fields: [{ name: 'note', type: 'text', semantics: 'intent' }],
        },
      ],
    },
    { name: 'deployed', title: '已部署', actions: [] },
  ],
};

const riskySnapshot: EngineSnapshot = {
  ...seedSnapshot,
  instances: {
    ...seedSnapshot.instances,
    'vm:i-abc123': { rel: 'vm:i-abc123', flow: 'risky-ops', node: 'ready', fields: {} },
  },
};

const deps = {
  flows: flowRegistry(postStatusFlow, commentModerationFlow, riskyFlow),
  guards: seedGuardRegistry,
};

describe('executeWithGates — agent + high 挂起路径', () => {
  const agentArchive = {
    rel: 'post:post-welcome',
    action: 'archive',
    params: {},
    actor: 'agent' as const,
    principal: 'user:mike',
    channel: 'http',
  };

  it('suspended:效果不应用,confirmation 实体 pending 物化', () => {
    const outcome = executeWithGates(agentArchive, seedSnapshot, deps);
    expect(outcome.kind).toBe('suspended');
    if (outcome.kind !== 'suspended') return;

    // 效果不应用:目标实体仍在 published。
    expect(outcome.snapshot.instances['post:post-welcome']?.node).toBe('published');
    // pending 确认实体物化(rel = confirmation:<id>)。
    const confirmation = outcome.snapshot.confirmations?.['confirmation:c1'];
    expect(confirmation).toMatchObject({
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      status: 'pending',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      channel: 'http',
    });
  });

  it('suspended 事件链只有 confirmation-requested(无 action-executed)', () => {
    const outcome = executeWithGates(agentArchive, seedSnapshot, deps);
    expect(outcome.kind).toBe('suspended');
    if (outcome.kind !== 'suspended') return;

    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0]).toMatchObject({ kind: 'confirmation-requested' });
    expect(outcome.events.map((event) => event.kind)).not.toContain('action-executed');
  });

  it('confirmation-requested 含原请求全文与策略原因(detail)', () => {
    const outcome = executeWithGates(agentArchive, seedSnapshot, deps);
    expect(outcome.kind).toBe('suspended');
    if (outcome.kind !== 'suspended') return;

    const event = outcome.events[0];
    if (event === undefined) throw new Error('suspended 必产出事件');
    expect(event).toMatchObject({
      kind: 'confirmation-requested',
      rel: 'confirmation:c1',
      action: 'archive',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });
    expect(event.detail).toMatchObject({
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      policy: 'builtin:high-agent',
      policyReason: expect.stringContaining('high'),
      request: {
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      },
    });
  });

  it('suspended 结果携带 confirmation 摘要(id/targetRel/targetAction/params/proposedBy/channel/policyReason)', () => {
    const outcome = executeWithGates(
      {
        rel: 'vm:i-abc123',
        action: 'deploy',
        params: { note: 'cleanup' },
        actor: 'agent',
        principal: 'user:mike',
        channel: 'chat',
      },
      riskySnapshot,
      deps,
    );
    expect(outcome.kind).toBe('suspended');
    if (outcome.kind !== 'suspended') return;

    expect(outcome.confirmation).toEqual({
      id: 'c1',
      targetRel: 'vm:i-abc123',
      targetAction: 'deploy',
      params: { note: 'cleanup' },
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      channel: 'chat',
      policyReason: expect.any(String),
    });
    // 快照物化的参数带出处(默认 intent)。
    expect(outcome.snapshot.confirmations?.['confirmation:c1']?.params).toEqual({
      note: { value: 'cleanup', origin: 'intent' },
    });
    // 效果不应用。
    expect(outcome.snapshot.instances['vm:i-abc123']?.node).toBe('ready');
  });

  it('挂起不改动输入快照(纯函数)', () => {
    const before = JSON.stringify(seedSnapshot);
    executeWithGates(agentArchive, seedSnapshot, deps);
    expect(JSON.stringify(seedSnapshot)).toBe(before);
  });

  it('confirmation id 确定性:已有 c1 时新挂起递增为 c2', () => {
    const first = executeWithGates(agentArchive, seedSnapshot, deps);
    expect(first.kind).toBe('suspended');
    if (first.kind !== 'suspended') return;

    const second = executeWithGates(
      { ...agentArchive, rel: 'post:post-getting-started' },
      first.snapshot,
      deps,
    );
    expect(second.kind).toBe('suspended');
    if (second.kind !== 'suspended') return;
    expect(second.confirmation.id).toBe('c2');
    expect(Object.keys(second.snapshot.confirmations ?? {})).toEqual([
      'confirmation:c1',
      'confirmation:c2',
    ]);
  });
});

describe('executeWithGates — 直通路径', () => {
  it('human exec archive(high)→ executed:直通,效果照常应用', () => {
    const outcome = executeWithGates(
      { rel: 'post:post-welcome', action: 'archive', params: {}, actor: 'human' },
      seedSnapshot,
      deps,
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.snapshot.instances['post:post-welcome']?.node).toBe('archived');
    expect(outcome.events[0]).toMatchObject({
      kind: 'action-executed',
      actor: 'human',
      to: 'archived',
    });
    // 无确认实体物化。
    expect(outcome.snapshot.confirmations).toEqual({});
  });

  it('agent exec 无标注动作 → executed(agent 不因 actor 身份被区别对待,只有标注才进门)', () => {
    const outcome = executeWithGates(
      { rel: 'post:post-welcome', action: 'unpublish', params: {}, actor: 'agent' },
      seedSnapshot,
      deps,
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.snapshot.instances['post:post-welcome']?.node).toBe('offline');
  });

  it('注入策略可使无标注动作挂起(策略即数据的引擎侧证据)', () => {
    const paranoid: ConfirmationPolicy = () => ({
      required: true,
      reason: '测试策略:一切皆需确认',
      policy: 'test:paranoid',
    });
    const outcome = executeWithGates(
      { rel: 'post:post-welcome', action: 'unpublish', params: {}, actor: 'human' },
      seedSnapshot,
      { ...deps, policy: paranoid },
    );
    expect(outcome.kind).toBe('suspended');
  });
});

describe('executeWithGates — 裁决顺序(确认门在三层之后)', () => {
  it('guard 失败 → guard-failed 拒绝(不进确认门,更不挂起)', () => {
    const outcome = executeWithGates(
      { rel: 'comment:c1', action: 'approve', params: {}, actor: 'agent' },
      seedSnapshot,
      { ...deps, guards: { ...seedGuardRegistry, 'is-pending': () => false } },
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
  });

  it('schema 失败 → schema-invalid 拒绝(不进确认门)', () => {
    const outcome = executeWithGates(
      { rel: 'comment:c1', action: 'approve', params: { spam: 1 }, actor: 'agent' },
      seedSnapshot,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
  });

  it('未声明动作 → undeclared 透传(judge 结果原样)', () => {
    const outcome = executeWithGates(
      { rel: 'post:ghost', action: 'archive', params: {}, actor: 'agent' },
      seedSnapshot,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });
});
