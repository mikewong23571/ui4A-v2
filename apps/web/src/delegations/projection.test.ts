import { describe, expect, it } from 'vitest';

import { trailToMessages } from '../chat/trail';
import type { TrailStep } from '@ui4a/agent';
import type { SirenEntity } from '@ui4a/engine';

import { projectDelegationDetail, toDelegationRow, type DelegationEventRow } from './projection';

// 委托投影(T5 Phase B / Task 1):事件日志(委托事件族)→ 舰队/详情视图。
// 详情的 messages 必须与 inline 聊天的 trailToMessages **逐条等值**(spec 验收 6:
// 轨迹消息投影与 inline 等价)——等价性由本测试直接对拍保证(同一 TrailStep 序列
// 两种来源,消息全等)。
function detailEntity(overrides: Record<string, unknown> = {}): SirenEntity {
  return {
    class: ['delegation', 'completed'],
    properties: {
      id: 'wf-1',
      goal: { verb: '发布一篇文章', fields: { title: '投影对拍' } },
      'driver-kind': 'rule',
      'start-rel': 'articles',
      principal: 'user:sess-1',
      status: 'completed',
      steps: 4,
      successes: 2,
      summary: '目标完成: publish 已成功',
      ...overrides,
    },
    actions: [],
    links: [],
    'guard-results': [],
  };
}

/** delegation-step 事件行(detail = worker AgentStepResult + step)。 */
function stepEvent(step: number, detail: Record<string, unknown>): DelegationEventRow {
  return { seq: step + 1, kind: 'delegation-step', detail: { step, ...detail } };
}

// 与 worker applyStepToState 同口径的样例序列:navigate + 2×exec + done。
const publishSteps: TrailStep[] = [
  { step: 1, rel: 'articles', op: { kind: 'navigate', rel: 'articles' }, outcome: 'navigated' },
  {
    step: 2,
    rel: 'articles',
    op: { kind: 'exec', action: 'next', params: { title: '投影对拍' } },
    outcome: 'executed',
  },
  { step: 3, rel: 'articles', op: { kind: 'exec', action: 'publish' }, outcome: 'executed' },
  {
    step: 4,
    rel: 'articles',
    op: { kind: 'done', summary: '目标完成: publish 已成功' },
    outcome: 'done',
  },
];

/** TrailStep 序列 → 对应 delegation 事件行(轨迹在事件日志,不在快照)。 */
function stepsToEvents(steps: TrailStep[]): DelegationEventRow[] {
  return steps.map((step) =>
    stepEvent(step.step, {
      op: step.op,
      outcome: step.outcome,
      ...(step.entity !== undefined ? { entitySummary: step.entity } : {}),
      ...(step.rejection !== undefined ? { rejection: step.rejection } : {}),
    }),
  );
}

describe('projectDelegationDetail(事件流 → 详情视图)', () => {
  it('messages 与 inline trailToMessages 逐条等值(spec 验收 6:轨迹投影等价)', () => {
    const detail = projectDelegationDetail(detailEntity(), stepsToEvents(publishSteps));

    const inline = trailToMessages({
      goal: { verb: '发布一篇文章' },
      outcome: 'done',
      summary: '目标完成: publish 已成功',
      steps: publishSteps,
      successes: [
        { rel: 'articles', action: 'next', params: { title: '投影对拍' } },
        { rel: 'articles', action: 'publish' },
      ],
    });
    expect(detail.messages).toEqual(inline);
    expect(detail.messages.map((message) => message.text)).toEqual([
      '导航到 articles',
      '已执行 next(articles)',
      '已执行 publish(articles)',
      '完成: 目标完成: publish 已成功',
    ]);
  });

  it('详情字段:goal/status/steps/successes/summary + driverKind/startRel/principal + trail', () => {
    const detail = projectDelegationDetail(detailEntity(), stepsToEvents(publishSteps));
    expect(detail).toMatchObject({
      id: 'wf-1',
      goal: { verb: '发布一篇文章' },
      status: 'completed',
      steps: 4,
      successes: 2,
      summary: '目标完成: publish 已成功',
      driverKind: 'rule',
      startRel: 'articles',
      principal: 'user:sess-1',
    });
    expect(detail.trail).toHaveLength(4);
    expect(detail.trail[0]).toMatchObject({ step: 1, rel: 'articles', outcome: 'navigated' });
  });

  it('rel 折叠:navigate 成功后,后续 exec 步的 rel 随 currentRel 切换', () => {
    const steps: TrailStep[] = [
      { step: 1, rel: 'articles', op: { kind: 'navigate', rel: 'articles' }, outcome: 'navigated' },
      {
        step: 2,
        rel: 'articles',
        op: { kind: 'navigate', rel: 'comments' },
        outcome: 'navigated',
      },
      { step: 3, rel: 'comments', op: { kind: 'exec', action: 'approve' }, outcome: 'executed' },
    ];
    const detail = projectDelegationDetail(
      detailEntity({ status: 'running', steps: 3, successes: 1, summary: undefined }),
      stepsToEvents(steps),
    );
    expect(detail.messages).toEqual([
      { role: 'assistant', text: '导航到 articles' },
      { role: 'assistant', text: '导航到 comments' },
      { role: 'assistant', text: '已执行 approve(comments)' },
    ]);
  });

  it('被拒与导航失败:原因如实进消息(拒绝即数据)', () => {
    const steps: TrailStep[] = [
      {
        step: 1,
        rel: 'articles',
        op: { kind: 'exec', action: 'archive' },
        outcome: 'rejected',
        rejection: {
          rel: 'articles',
          action: 'archive',
          layer: 'guard',
          reason: 'Cedar: 需人类确认',
        },
      },
      {
        step: 2,
        rel: 'articles',
        op: { kind: 'navigate', rel: 'nope' },
        outcome: 'not-found',
        rejection: { rel: 'nope', layer: 'not-found', reason: '实体不可达' },
      },
    ];
    const detail = projectDelegationDetail(
      detailEntity({ status: 'failed', steps: 2, successes: 0, reason: '目标未达成' }),
      stepsToEvents(steps),
    );
    expect(detail.messages).toEqual([
      { role: 'assistant', text: '被拒 archive(articles): Cedar: 需人类确认' },
      { role: 'assistant', text: '导航失败(nope): 实体不可达' },
    ]);
    expect(detail.reason).toBe('目标未达成');
  });

  it('max-steps:done/fail 步缺失,终态 reason 补一条上限消息(与 inline 同格式)', () => {
    const steps: TrailStep[] = [
      { step: 1, rel: 'articles', op: { kind: 'navigate', rel: 'articles' }, outcome: 'navigated' },
    ];
    const detail = projectDelegationDetail(
      detailEntity({
        status: 'max-steps',
        steps: 1,
        successes: 0,
        reason: '达到步数上限 24 未收到 done/fail',
      }),
      stepsToEvents(steps),
    );
    expect(detail.messages).toEqual([
      { role: 'assistant', text: '导航到 articles' },
      { role: 'assistant', text: '达到步数上限: 达到步数上限 24 未收到 done/fail' },
    ]);
  });
});

describe('toDelegationRow(集合子实体 → 舰队行)', () => {
  it('kebab 属性 → 舰队行字段;summary/reason 缺省不携带', () => {
    const row = toDelegationRow({
      class: ['delegation', 'completed'],
      rel: ['item'],
      href: '/api/entity?rel=delegation%3Awf-1',
      properties: detailEntity().properties,
      actions: [],
      links: [],
    });
    expect(row).toEqual({
      id: 'wf-1',
      goal: { verb: '发布一篇文章', fields: { title: '投影对拍' } },
      status: 'completed',
      steps: 4,
      successes: 2,
      summary: '目标完成: publish 已成功',
    });

    const running = toDelegationRow({
      class: ['delegation', 'running'],
      rel: ['item'],
      href: '/api/entity?rel=delegation%3Awf-2',
      properties: {
        id: 'wf-2',
        goal: { verb: '审核' },
        'driver-kind': 'rule',
        'start-rel': 'comments',
        status: 'running',
        steps: 1,
        successes: 0,
      },
      actions: [],
      links: [],
    });
    expect(running).toEqual({
      id: 'wf-2',
      goal: { verb: '审核' },
      status: 'running',
      steps: 1,
      successes: 0,
    });
    expect('summary' in running).toBe(false);
    expect('reason' in running).toBe(false);
  });
});
