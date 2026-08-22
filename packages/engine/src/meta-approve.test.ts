/**
 * meta approve / reject(T4 Phase A Task 4,TDD 红→绿)。
 *
 * 铁律 5"审批不委托":approve 的 guard 是 actor-is-human——agent 身份的审批
 * 在引擎层被拒(I4 延伸)且留痕;reject 的 reason 必填且非空。
 * approve 效果:definition status → active、version+1、活跃定义 = 草稿内容,
 * 事件 definition-activated(detail 含新 version 与 definition 全文,机器可重放)
 * ——sitemap 重生成的信号(内容变了,内容 hash 版本即变)。
 * 全生命周期重放一致(I5):seed→revise→add-action→submit→approve 的完整事件链
 * fold 后与在线快照逐字段一致。
 */
import { describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { articleDraftingFlow, seedSnapshot } from './fixtures';
import { fold, type LogEvent } from './fold';
import { definitionSeedEvent, executeMeta } from './meta';
import { deriveSitemap } from './sitemap';

const deps = { guards: seedGuardRegistry };

interface Lifecycle {
  snapshot: EngineSnapshot;
  log: LogEvent[];
}

/** seed → revise → add-action(pin)→ submit:到达 pending-approval 的完整链。 */
function pendingApproval(actor: 'human' | 'agent' = 'agent'): Lifecycle {
  const seed = definitionSeedEvent(1, articleDraftingFlow);
  let snapshot = fold([seed], { flows: {} }, seedSnapshot);
  const log: LogEvent[] = [seed];

  const steps = [
    { rel: 'meta/flow:article-drafting', action: 'revise', actor, principal: 'user:mike' },
    {
      rel: 'meta/flow:article-drafting',
      action: 'add-action',
      actor,
      principal: 'user:mike',
      params: { node: 'ready', action: { name: 'pin', title: '置顶', to: 'done', guards: [] } },
    },
    { rel: 'meta/flow:article-drafting', action: 'submit', actor, principal: 'user:mike' },
  ] as const;
  let seq = 10;
  for (const step of steps) {
    const outcome = executeMeta(
      { ...step, params: 'params' in step ? { ...step.params } : undefined },
      snapshot,
      deps,
    );
    if (outcome.kind !== 'executed') throw new Error(`${step.action} 应通过`);
    snapshot = outcome.snapshot;
    log.push(...outcome.events.map((event) => ({ ...event, seq: seq++ })));
  }
  expect(snapshot.instances['meta/flow:article-drafting']?.node).toBe('pending-approval');
  return { snapshot, log };
}

describe('approve(铁律 5:审批不委托)', () => {
  it('human approve:active + version+1 + 活跃定义=草稿内容 + definition-activated(全文入 detail)', () => {
    const { snapshot, log } = pendingApproval();

    const approved = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'approve',
        actor: 'human',
        principal: 'user:mike',
      },
      snapshot,
      deps,
    );
    expect(approved.kind).toBe('executed');
    if (approved.kind !== 'executed') return;
    expect(approved.events.map((e) => e.kind)).toEqual(['action-executed', 'definition-activated']);

    const entry = approved.snapshot.definitions!['article-drafting']!;
    expect(approved.snapshot.instances['meta/flow:article-drafting']?.node).toBe('active');
    expect(entry.status).toBe('active');
    expect(entry.version).toBe(2);
    expect(entry.bornBy).toBe(1);
    // 活跃定义 = 草稿内容(pin 已在)。
    const pin = entry.definition.nodes
      .find((n) => n.name === 'ready')
      ?.actions.find((a) => a.name === 'pin');
    expect(pin).toMatchObject({ name: 'pin', to: 'done' });
    // activation 实体 → approved(保留审计)。
    expect(approved.snapshot.activations?.['meta/activation:a1']).toMatchObject({
      status: 'approved',
      approvedBy: { actor: 'human', principal: 'user:mike' },
    });

    // detail:新 version + definition 全文(机器可重放)。
    const detail = approved.events[1]!.detail as {
      name: string;
      version: number;
      activationId: string;
      definition: typeof entry.definition;
    };
    expect(detail).toMatchObject({ name: 'article-drafting', version: 2, activationId: 'a1' });
    expect(
      detail.definition.nodes.find((n) => n.name === 'ready')?.actions.map((a) => a.name),
    ).toContain('pin');

    // sitemap bump 信号:激活内容相对原活跃定义变了,推导版本(内容 hash)即变
    // (definition-activated 事件即重生成信号;web 层 Phase B 消费)。
    const oldVersion = deriveSitemap([articleDraftingFlow]).version;
    const newVersion = deriveSitemap([entry.definition]).version;
    expect(newVersion).not.toBe(oldVersion);

    // 全生命周期重放一致(I5):含 submit 前的一条拒绝留痕(no-op)。
    const fullLog: LogEvent[] = [
      ...log,
      {
        seq: 99,
        kind: 'action-rejected',
        rel: 'meta/flow:article-drafting',
        action: 'approve',
        actor: 'agent',
        reason: 'guard 不满足: actor-is-human=false',
      },
      ...approved.events.map((e, i) => ({ ...e, seq: 100 + i })),
    ];
    expect(fold(fullLog, { flows: {} }, seedSnapshot)).toEqual(approved.snapshot);
  });

  it('agent approve → guard-failed actor-is-human(I4 延伸),状态不变', () => {
    const { snapshot } = pendingApproval();
    const outcome = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'approve',
        actor: 'agent',
        principal: 'user:mike',
      },
      snapshot,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('actor-is-human=false');
    // 状态不变:仍在 pending-approval,activation 仍 pending。
    expect(snapshot.instances['meta/flow:article-drafting']?.node).toBe('pending-approval');
    expect(snapshot.activations?.['meta/activation:a1']?.status).toBe('pending-approval');
  });

  it('经 activation 实体 rel(mate/activation:a1)approve 同样成立', () => {
    const { snapshot } = pendingApproval();
    const outcome = executeMeta(
      { rel: 'meta/activation:a1', action: 'approve', actor: 'human' },
      snapshot,
      deps,
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.snapshot.definitions?.['article-drafting'].status).toBe('active');
    expect(outcome.snapshot.definitions?.['article-drafting'].version).toBe(2);
  });

  it('重复 approve(已 active)→ undeclared(审批动作只声明于 pending-approval)', () => {
    const { snapshot } = pendingApproval();
    const first = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'approve', actor: 'human' },
      snapshot,
      deps,
    );
    if (first.kind !== 'executed') throw new Error('approve 应通过');
    const second = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'approve', actor: 'human' },
      first.snapshot,
      deps,
    );
    expect(second).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });

  it('未知 activation rel / 已决策 activation → undeclared', () => {
    const { snapshot } = pendingApproval();
    expect(
      executeMeta(
        { rel: 'meta/activation:ghost', action: 'approve', actor: 'human' },
        snapshot,
        deps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'undeclared' });

    const approved = executeMeta(
      { rel: 'meta/activation:a1', action: 'approve', actor: 'human' },
      snapshot,
      deps,
    );
    if (approved.kind !== 'executed') throw new Error('approve 应通过');
    expect(
      executeMeta(
        { rel: 'meta/activation:a1', action: 'reject', actor: 'human', params: { reason: '迟了' } },
        approved.snapshot,
        deps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });
});

describe('reject(reason 必填)', () => {
  it('human reject 带 reason:entry/activation → rejected,原因入事件', () => {
    const { snapshot, log } = pendingApproval();
    const rejected = executeMeta(
      {
        rel: 'meta/activation:a1',
        action: 'reject',
        actor: 'human',
        principal: 'user:mike',
        params: { reason: 'pin 动作不该无 guard' },
      },
      snapshot,
      deps,
    );
    expect(rejected.kind).toBe('executed');
    if (rejected.kind !== 'executed') return;
    expect(rejected.events.map((e) => e.kind)).toEqual(['action-executed', 'definition-rejected']);
    expect(rejected.snapshot.instances['meta/flow:article-drafting']?.node).toBe('rejected');
    expect(rejected.snapshot.definitions?.['article-drafting'].status).toBe('rejected');
    expect(rejected.snapshot.definitions?.['article-drafting'].version).toBe(1); // 版本不推进
    expect(rejected.snapshot.activations?.['meta/activation:a1']).toMatchObject({
      status: 'rejected',
      rejectedReason: 'pin 动作不该无 guard',
    });
    const event = rejected.events[1]!;
    expect(event.reason).toBe('pin 动作不该无 guard');
    expect(event.detail).toMatchObject({
      name: 'article-drafting',
      activationId: 'a1',
      decidedBy: { actor: 'human', principal: 'user:mike' },
      reason: 'pin 动作不该无 guard',
    });

    // 重放一致(I5)。
    const fullLog: LogEvent[] = [
      ...log,
      ...rejected.events.map((e, i) => ({ ...e, seq: 100 + i })),
    ];
    expect(fold(fullLog, { flows: {} }, seedSnapshot)).toEqual(rejected.snapshot);
  });

  it('reason 空/缺 → schema-invalid(schema 层第 3 层)', () => {
    const { snapshot } = pendingApproval();
    expect(
      executeMeta(
        { rel: 'meta/activation:a1', action: 'reject', actor: 'human', params: {} },
        snapshot,
        deps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    expect(
      executeMeta(
        { rel: 'meta/activation:a1', action: 'reject', actor: 'human', params: { reason: '' } },
        snapshot,
        deps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
  });

  it('agent reject → guard-failed actor-is-human(拒绝也不委托)', () => {
    const { snapshot } = pendingApproval();
    const outcome = executeMeta(
      { rel: 'meta/activation:a1', action: 'reject', actor: 'agent', params: { reason: 'x' } },
      snapshot,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('actor-is-human=false');
  });
});
