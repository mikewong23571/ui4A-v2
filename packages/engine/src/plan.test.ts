import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';
import type { EngineSnapshot } from '@ui4a/shared';

import { fold, type LogEvent } from './fold';
import { executePlan } from './plan';
import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
  seedSnapshot,
} from './fixtures';
import type { ExecRequest } from './judge';
import type { EngineEvent } from './effects';

// executePlan(T6 Phase A / arch-brief §9.4):一次决策批量裁决计划。
//   串行逐步 executeWithGates——每步用**前步产出快照**喂后步,每步完整三层
//   裁决 + 确认门(不是信任计划,是批量裁决计划):
//   - 全过 → plan-completed(全部提交);
//   - 某步拒绝 → 该步 rejection 入 results,停止后续,kind=plan-rejected;
//   - 某步挂起(确认门)→ 入 results,停止后续,kind=plan-suspended
//     (confirmation 伴随事件照常);
//   - 已过步骤的效果/事件**保留**(append-only 语义,不回滚);
//   - 每计划恰一条 plan-executed 标记事件(detail=分步摘要);
//   - 空计划 → plan-completed 空结果(engine 口径:零步平凡为真;
//     HTTP 层按 400 拒绝,见 /api/exec-plan 任务)。

const deps = {
  flows: flowRegistry(commentModerationFlow, postStatusFlow, articleDraftingFlow),
  guards: seedGuardRegistry,
};

const agent = (rel: string, action: string, params: Record<string, unknown> = {}): ExecRequest => ({
  rel,
  action,
  params,
  actor: 'agent',
  principal: 'user:mike',
  channel: 'http',
});

/** 向导起点:basic-info 空 fields(seedSnapshot 的向导实例在 classification)。 */
const wizardSnapshot: EngineSnapshot = {
  ...seedSnapshot,
  instances: {
    ...seedSnapshot.instances,
    'article-drafting:main': {
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'basic-info',
      fields: {},
    },
  },
};

/** 引擎事件 → 日志事件(seq 连续分配;模拟日志层)。 */
function withSeq(events: readonly EngineEvent[], start: number): LogEvent[] {
  return events.map((event, index) => ({ ...event, seq: start + index }));
}

const seedFromSnapshot: LogEvent = {
  seq: 1,
  kind: 'seed',
  rel: 'seed:bootstrap',
  detail: { instances: seedSnapshot.instances, collections: seedSnapshot.collections },
};

/** 向导重放的 seed(与 wizardSnapshot 同起点:向导实例在 basic-info)。 */
const wizardSeed: LogEvent = {
  seq: 1,
  kind: 'seed',
  rel: 'seed:bootstrap',
  detail: { instances: wizardSnapshot.instances, collections: wizardSnapshot.collections },
};

describe('executePlan — 全过(plan-completed)', () => {
  it('三步审核计划全过 → kind=plan-completed,results 逐步齐全(step/rel/action/outcome/to)', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c2', 'approve'), agent('comment:c3', 'approve')],
      seedSnapshot,
      deps,
    );
    expect(outcome.kind).toBe('plan-completed');
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results[0]).toMatchObject({
      step: 1,
      rel: 'comment:c1',
      action: 'approve',
      outcome: 'executed',
      to: 'approved',
    });
    expect(outcome.results[2]).toMatchObject({ step: 3, rel: 'comment:c3', outcome: 'executed' });
  });

  it('全过终态快照:三步全部生效(每步裁决基于前步产出快照)', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c2', 'approve'), agent('comment:c3', 'approve')],
      seedSnapshot,
      deps,
    );
    expect(outcome.snapshot.instances['comment:c1']?.node).toBe('approved');
    expect(outcome.snapshot.instances['comment:c2']?.node).toBe('approved');
    expect(outcome.snapshot.instances['comment:c3']?.node).toBe('approved');
  });

  it('伴随事件按步序保留 + plan-executed 标记(detail=分步摘要)', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c2', 'approve')],
      seedSnapshot,
      deps,
    );
    expect(outcome.events.map((event) => event.kind)).toEqual(['action-executed', 'action-executed']);
    expect(outcome.events[0]).toMatchObject({ rel: 'comment:c1', action: 'approve' });

    expect(outcome.record).toMatchObject({
      kind: 'plan-executed',
      rel: 'plan',
      action: 'execute',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });
    expect(outcome.record.detail).toEqual({
      kind: 'plan-completed',
      steps: [
        { step: 1, rel: 'comment:c1', action: 'approve', outcome: 'executed' },
        { step: 2, rel: 'comment:c2', action: 'approve', outcome: 'executed' },
      ],
    });
  });

  it('依赖链:向导 next×3 + publish 四步计划 → done,文章追加进 articles', () => {
    const outcome = executePlan(
      [
        agent('article-drafting:main', 'next', { title: 'New Article' }),
        agent('article-drafting:main', 'next', { category: 'tech', tags: 'ui4a' }),
        agent('article-drafting:main', 'next', { body: '正文内容' }),
        agent('article-drafting:main', 'publish', {}),
      ],
      wizardSnapshot,
      deps,
    );
    expect(outcome.kind).toBe('plan-completed');
    // 第 2 步能通过裁决,证明第 1 步的迁移已入后步快照(逐步模拟,非并行)。
    expect(outcome.snapshot.instances['article-drafting:main']?.node).toBe('done');
    // fixtures 的 publish 未声明 title 字段(参数为空)→ 追加名落 slug 兜底 'item'。
    expect(outcome.snapshot.instances['post:item']).toMatchObject({
      rel: 'post:item',
      flow: 'article-drafting',
      node: 'published',
    });
    expect(outcome.snapshot.collections.articles).toContain('post:item');
    expect(outcome.results[3]).toMatchObject({
      step: 4,
      action: 'publish',
      outcome: 'executed',
      appended: ['post:item'],
    });
  });
});

describe('executePlan — 中拒截断(plan-rejected)', () => {
  it('重复步:第二步 undeclared → kind=plan-rejected,rejection 入 results,后续停止', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c1', 'approve'), agent('comment:c2', 'approve')],
      seedSnapshot,
      deps,
    );
    expect(outcome.kind).toBe('plan-rejected');
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[1]).toMatchObject({
      step: 2,
      rel: 'comment:c1',
      action: 'approve',
      outcome: 'rejected',
      rejection: { layer: 'undeclared', reason: expect.stringContaining('approve') },
    });
  });

  it('append-only:前序效果保留(第 1 步生效),后续步未执行(第 3 步不动)', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c1', 'approve'), agent('comment:c2', 'approve')],
      seedSnapshot,
      deps,
    );
    expect(outcome.snapshot.instances['comment:c1']?.node).toBe('approved');
    expect(outcome.snapshot.instances['comment:c2']?.node).toBe('pending');
    // 伴随事件只含已过步骤(拒绝步无引擎伴随事件)。
    expect(outcome.events).toHaveLength(1);
  });

  it('guard 层拒绝 → rejection.layer=guard-failed,分步报告带原因', () => {
    const moodyDeps = {
      ...deps,
      guards: {
        ...seedGuardRegistry,
        'is-pending': ({ instance }: { instance: { rel: string } }) => instance.rel !== 'comment:c2',
      },
    };
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c2', 'approve')],
      seedSnapshot,
      moodyDeps,
    );
    expect(outcome.kind).toBe('plan-rejected');
    expect(outcome.results[1]?.rejection).toMatchObject({
      layer: 'guard-failed',
      reason: expect.stringContaining('is-pending'),
    });
  });

  it('schema 层拒绝 → rejection.layer=schema-invalid(多余参数)', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve', { spam: 1 }), agent('comment:c2', 'approve')],
      seedSnapshot,
      deps,
    );
    expect(outcome.kind).toBe('plan-rejected');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.rejection).toMatchObject({ layer: 'schema-invalid' });
  });

  it('plan-executed 标记照常产出(detail.kind=plan-rejected,拒绝步 outcome=rejected)', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c1', 'approve')],
      seedSnapshot,
      deps,
    );
    expect(outcome.record.detail).toEqual({
      kind: 'plan-rejected',
      steps: [
        { step: 1, rel: 'comment:c1', action: 'approve', outcome: 'executed' },
        { step: 2, rel: 'comment:c1', action: 'approve', outcome: 'rejected' },
      ],
    });
  });
});

describe('executePlan — 中挂停止(plan-suspended)', () => {
  const mixedPlan: ExecRequest[] = [
    agent('comment:c1', 'approve'),
    agent('post:post-welcome', 'archive'),
    agent('comment:c2', 'approve'),
  ];

  it('第二步确认门挂起 → kind=plan-suspended,顶层携带 confirmation 摘录', () => {
    const outcome = executePlan(mixedPlan, seedSnapshot, deps);
    expect(outcome.kind).toBe('plan-suspended');
    if (outcome.kind !== 'plan-suspended') return;
    expect(outcome.confirmation).toMatchObject({
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      policyReason: expect.any(String),
    });
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[1]).toMatchObject({
      step: 2,
      outcome: 'suspended',
      confirmation: { id: 'c1' },
    });
  });

  it('挂起伴随事件照常:confirmation-requested 落事件链;后续步未执行', () => {
    const outcome = executePlan(mixedPlan, seedSnapshot, deps);
    expect(outcome.events.map((event) => event.kind)).toEqual([
      'action-executed',
      'confirmation-requested',
    ]);
    expect(outcome.events[1]).toMatchObject({
      rel: 'confirmation:c1',
      action: 'archive',
      actor: 'agent',
    });
    // 前序生效 + 挂起效果不应用 + 后续停止。
    expect(outcome.snapshot.instances['comment:c1']?.node).toBe('approved');
    expect(outcome.snapshot.instances['post:post-welcome']?.node).toBe('published');
    expect(outcome.snapshot.confirmations?.['confirmation:c1']).toMatchObject({ status: 'pending' });
    expect(outcome.snapshot.instances['comment:c2']?.node).toBe('pending');
  });

  it('plan-executed 标记 detail.kind=plan-suspended,挂起步 outcome=suspended', () => {
    const outcome = executePlan(mixedPlan, seedSnapshot, deps);
    expect(outcome.record.detail).toMatchObject({
      kind: 'plan-suspended',
      steps: [
        { step: 1, outcome: 'executed' },
        { step: 2, outcome: 'suspended' },
      ],
    });
  });
});

describe('executePlan — 边界与纯度', () => {
  it('空计划 → plan-completed 空结果,零伴随事件,标记 detail.steps=[](口径:平凡为真)', () => {
    const outcome = executePlan([], seedSnapshot, deps);
    expect(outcome).toMatchObject({ kind: 'plan-completed' });
    expect(outcome.results).toEqual([]);
    expect(outcome.events).toEqual([]);
    expect(outcome.record.detail).toEqual({ kind: 'plan-completed', steps: [] });
  });

  it('纯函数:不改动输入快照', () => {
    const before = JSON.stringify(seedSnapshot);
    executePlan(
      [agent('comment:c1', 'approve'), agent('post:post-welcome', 'archive')],
      seedSnapshot,
      deps,
    );
    expect(JSON.stringify(seedSnapshot)).toBe(before);
  });

  it('标记事件 actor/principal/channel 取首步(空计划缺省 human)', () => {
    const outcome = executePlan([agent('comment:c1', 'approve')], seedSnapshot, deps);
    expect(outcome.record).toMatchObject({ actor: 'agent', principal: 'user:mike', channel: 'http' });
    const empty = executePlan([], seedSnapshot, deps);
    expect(empty.record).toMatchObject({ actor: 'human' });
  });
});

describe('executePlan — fold 重放一致(I5:plan 事件族参与重放)', () => {
  it('全过向导计划:伴随事件+标记 → fold 与在线终态同构', () => {
    const outcome = executePlan(
      [
        agent('article-drafting:main', 'next', { title: 'New Article' }),
        agent('article-drafting:main', 'next', { category: 'tech', tags: 'ui4a' }),
        agent('article-drafting:main', 'next', { body: '正文内容' }),
        agent('article-drafting:main', 'publish', {}),
      ],
      wizardSnapshot,
      deps,
    );
    const log = [
      wizardSeed,
      ...withSeq([...outcome.events, outcome.record], 2),
    ];
    const replayed = fold(log, deps);
    expect(replayed.instances['article-drafting:main']?.node).toBe('done');
    expect(replayed.instances['post:item']).toMatchObject({ node: 'published' });
    expect(replayed.collections.articles).toEqual(outcome.snapshot.collections.articles);
  });

  it('中挂计划:confirmation-requested 参与 fold,重放后 pending 实体物化', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('post:post-welcome', 'archive')],
      seedSnapshot,
      deps,
    );
    expect(outcome.kind).toBe('plan-suspended');
    const replayed = fold([seedFromSnapshot, ...withSeq([...outcome.events, outcome.record], 2)], deps);
    expect(replayed.instances['comment:c1']?.node).toBe('approved');
    expect(replayed.confirmations?.['confirmation:c1']).toMatchObject({ status: 'pending' });
  });

  it('plan-executed 标记是纯标记:fold 不改状态(去掉标记重放结果相同)', () => {
    const outcome = executePlan(
      [agent('comment:c1', 'approve'), agent('comment:c2', 'approve')],
      seedSnapshot,
      deps,
    );
    const withMarker = fold(
      [seedFromSnapshot, ...withSeq([...outcome.events, outcome.record], 2)],
      deps,
    );
    const withoutMarker = fold([seedFromSnapshot, ...withSeq(outcome.events, 2)], deps);
    expect(JSON.stringify(withMarker)).toBe(JSON.stringify(withoutMarker));
  });
});
