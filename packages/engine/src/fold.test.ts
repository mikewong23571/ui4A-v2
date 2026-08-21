import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, InstanceSnapshot } from '@ui4a/shared';

import { approveConfirmation, rejectConfirmation } from './confirmation';
import type { ConfirmationRequestDetail } from './confirmation';
import { executeWithGates } from './execute';
import { fold, type LogEvent, type SeedDetail } from './fold';
import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
  seedSnapshot,
} from './fixtures';
import { seedGuardRegistry } from '@ui4a/shared';
import { contentVersion } from './sitemap';
import type { EngineEvent } from './effects';

// fold 投影(TDD 红→绿):事件日志 → 引擎快照的纯函数(arch-brief §4:
// "当前 UI 状态 = 日志折叠后的物化状态";I5 的根基)。
// 关键规则:
// - action-executed 重放 applyEffects(与在线路径同构,不重新裁决);
// - action-rejected 不改状态但参与日志(I6);
// - entity-appended / spawn-requested 是伴随事件(状态已由 action-executed 重放体现;
//   spawn 在 T2 不改状态),fold 不双算;
// - confirmation-requested/approved/rejected(T3):pending 实体化 / 状态流转,
//   approved 后的 action-executed 照常重放(挂起→approve 重放后效果必须出现);
// - seed 事件合并种子实体(幂等:只补缺,不覆盖);
// - 定义漂移(日志与 flow 常量不一致)必须响亮失败。
const flows = flowRegistry(commentModerationFlow, articleDraftingFlow);

function instance(
  rel: string,
  flow: string,
  node: string,
  fields: InstanceSnapshot['fields'] = {},
): InstanceSnapshot {
  return { rel, flow, node, fields };
}

const seedDetail: SeedDetail = {
  instances: {
    'comment:c1': instance('comment:c1', 'comment-moderation', 'pending', {
      body: { value: '好文章', origin: 'intent' },
    }),
    'article-drafting:main': instance('article-drafting:main', 'article-drafting', 'classification'),
  },
  collections: { comments: ['comment:c1'] },
};

const seedEvent: LogEvent = { seq: 1, kind: 'seed', detail: seedDetail };

describe('fold 投影', () => {
  it('空日志 → 空快照(confirmations 恒为空表)', () => {
    expect(fold([], { flows })).toEqual({ instances: {}, collections: {}, confirmations: {} });
  });

  it('seed 事件建立种子实体与集合', () => {
    const snapshot = fold([seedEvent], { flows });

    expect(snapshot.instances['comment:c1']?.node).toBe('pending');
    expect(snapshot.instances['article-drafting:main']?.node).toBe('classification');
    expect(snapshot.collections).toEqual({ comments: ['comment:c1'] });
  });

  it('seed 幂等:重复 seed 事件不重复实体、不重复集合成员', () => {
    const snapshot = fold([seedEvent, { ...seedEvent, seq: 2 }], { flows });

    expect(Object.keys(snapshot.instances)).toHaveLength(2);
    expect(snapshot.collections.comments).toEqual(['comment:c1']);
  });

  it('action-executed 重放 applyEffects:迁移 + 参数(带出处)落入实例', () => {
    const executed: LogEvent = {
      seq: 2,
      kind: 'action-executed',
      rel: 'article-drafting:main',
      action: 'next',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
      params: {
        category: { value: 'tech', origin: 'intent' },
        tags: { value: 'ai', origin: 'proposal' },
      },
      to: 'content',
    };

    const snapshot = fold([seedEvent, executed], { flows });
    const main = snapshot.instances['article-drafting:main'];

    expect(main?.node).toBe('content');
    expect(main?.fields.tags).toEqual({ value: 'ai', origin: 'proposal' });
    expect(main?.fields.category).toEqual({ value: 'tech', origin: 'intent' });
  });

  it('action-executed 携 append 效果:新实例落位、集合追加、命名从参数 slug', () => {
    // 向导走完 classification → content → ready → publish(append post:hello-world)
    const stepped: LogEvent[] = [
      seedEvent,
      {
        seq: 2,
        kind: 'action-executed',
        rel: 'article-drafting:main',
        action: 'next',
        actor: 'human',
        params: { category: { value: 'tech', origin: 'intent' } },
      },
      {
        seq: 3,
        kind: 'action-executed',
        rel: 'article-drafting:main',
        action: 'next',
        actor: 'human',
        params: { body: { value: '正文', origin: 'intent' } },
      },
      {
        seq: 4,
        kind: 'action-executed',
        rel: 'article-drafting:main',
        action: 'publish',
        actor: 'human',
        params: { title: { value: 'Hello World', origin: 'intent' } },
        appended: ['post:hello-world'],
      },
      {
        seq: 5,
        kind: 'entity-appended',
        rel: 'article-drafting:main',
        action: 'publish',
        actor: 'human',
        appendedRel: 'post:hello-world',
        collection: 'articles',
      },
    ];

    const snapshot = fold(stepped, { flows });
    const post = snapshot.instances['post:hello-world'];

    expect(snapshot.instances['article-drafting:main']?.node).toBe('done');
    // fixture 的 append 未声明 flow → 新实例继承源实例的 flow(effects.ts 语义)
    expect(post).toMatchObject({
      rel: 'post:hello-world',
      flow: 'article-drafting',
      node: 'published',
      fields: { title: { value: 'Hello World', origin: 'intent' } },
    });
    expect(snapshot.collections.articles).toEqual(['post:hello-world']);
  });

  it('action-rejected 不改状态但保留在日志序列中(I6)', () => {
    const approve: LogEvent = {
      seq: 2,
      kind: 'action-executed',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      params: {},
    };
    const rejectedFlag: LogEvent = {
      seq: 3,
      kind: 'action-rejected',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      params: {},
      reason: '动作 "approve" 未声明于节点 "approved"',
    };

    const snapshot = fold([seedEvent, approve, rejectedFlag], { flows });

    expect(snapshot.instances['comment:c1']?.node).toBe('approved');
  });

  it('entity-appended / spawn-requested 不改状态(伴随事件,不双算)', () => {
    const appended: LogEvent = {
      seq: 2,
      kind: 'entity-appended',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      appendedRel: 'comment:c9',
      collection: 'comments',
    };
    const spawn: LogEvent = {
      seq: 3,
      kind: 'spawn-requested',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      capability: 'notify',
      bind: { to: 'moderator' },
    };

    const snapshot = fold([seedEvent, appended, spawn], { flows });

    expect(snapshot.instances['comment:c9']).toBeUndefined();
    expect(snapshot.collections.comments).toEqual(['comment:c1']);
  });

  it('未知 kind 响亮失败(日志完整性守卫)', () => {
    const bogus = { seq: 2, kind: 'mischief', rel: 'comment:c1' } as unknown as LogEvent;

    expect(() => fold([seedEvent, bogus], { flows })).toThrow(/未知事件 kind/);
  });

  it('定义漂移:动作未声明于重放位点 → 抛错并带 seq(I5 完整性)', () => {
    const drifted: LogEvent = {
      seq: 2,
      kind: 'action-executed',
      rel: 'comment:c1',
      action: 'explode',
      actor: 'agent',
      params: {},
    };

    expect(() => fold([seedEvent, drifted], { flows })).toThrow(/seq=2/);
  });

  it('重放位点实例不存在 → 抛错并带 seq', () => {
    const orphan: LogEvent = {
      seq: 2,
      kind: 'action-executed',
      rel: 'comment:ghost',
      action: 'approve',
      actor: 'agent',
      params: {},
    };

    expect(() => fold([orphan], { flows })).toThrow(/seq=2/);
  });
});

// ---------------------------------------------------------------------------
// confirmation 事件链重放(T3:挂起→approve/reject 全部参与 fold;I5 语义保持)
// ---------------------------------------------------------------------------

const postFlows = flowRegistry(postStatusFlow, commentModerationFlow, articleDraftingFlow);
const postDeps = { flows: postFlows, guards: seedGuardRegistry };

const agentArchive = {
  rel: 'post:post-welcome',
  action: 'archive',
  params: {},
  actor: 'agent' as const,
  principal: 'user:mike',
  channel: 'http',
};

const seedFromSnapshot: LogEvent = {
  seq: 1,
  kind: 'seed',
  rel: 'seed:bootstrap',
  detail: { instances: seedSnapshot.instances, collections: seedSnapshot.collections },
};

/** 引擎事件 → 日志事件(seq 从 start 起连续分配;模拟日志层)。 */
function withSeq(events: readonly EngineEvent[], start: number): LogEvent[] {
  return events.map((event, index) => ({ ...event, seq: start + index }));
}

/** 在线跑一遍 挂起→approve,产出(在线终态快照, 全部日志事件)。 */
function onlineSuspendApprove(): { online: EngineSnapshot; log: LogEvent[] } {
  const base = fold([seedFromSnapshot], postDeps);
  const suspended = executeWithGates(agentArchive, base, postDeps);
  if (suspended.kind !== 'suspended') throw new Error(`前置失败:期望 suspended,得到 ${suspended.kind}`);

  const decision = approveConfirmation(
    suspended.snapshot,
    suspended.confirmation.id,
    { actor: 'human', principal: 'user:mike' },
    postDeps,
  );
  if (decision.kind !== 'confirmed') throw new Error(`前置失败:期望 confirmed,得到 ${decision.kind}`);

  const log: LogEvent[] = [
    seedFromSnapshot,
    ...withSeq(suspended.events, 2),
    ...withSeq(decision.events, 2 + suspended.events.length),
  ];
  return { online: decision.snapshot, log };
}

describe('fold — confirmation 事件链', () => {
  it('confirmation-requested → pending 实体物化(目标动作不生效)', () => {
    const suspended = executeWithGates(agentArchive, fold([seedFromSnapshot], postDeps), postDeps);
    if (suspended.kind !== 'suspended') throw new Error('前置失败');
    const log = [seedFromSnapshot, ...withSeq(suspended.events, 2)];

    const snapshot = fold(log, postDeps);

    expect(snapshot.instances['post:post-welcome']?.node).toBe('published');
    expect(snapshot.confirmations?.['confirmation:c1']).toMatchObject({
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      status: 'pending',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      channel: 'http',
      policy: 'builtin:high-agent',
    });
  });

  it('挂起→approve:fold 后效果必须出现 + 状态 approved(hash 与在线一致,I5)', () => {
    const { online, log } = onlineSuspendApprove();

    const replayed = fold(log, postDeps);

    // 效果出现:重放后文章已归档。
    expect(replayed.instances['post:post-welcome']?.node).toBe('archived');
    expect(replayed.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'approved',
      approvedBy: { actor: 'human', principal: 'user:mike' },
    });
    // 重放一致性:内容 hash 与在线路径一致。
    expect(contentVersion(replayed)).toBe(contentVersion(online));
  });

  it('挂起→reject:重放后原动作永不生效 + 状态 rejected(原因保留)', () => {
    const base = fold([seedFromSnapshot], postDeps);
    const suspended = executeWithGates(agentArchive, base, postDeps);
    if (suspended.kind !== 'suspended') throw new Error('前置失败');
    const decision = rejectConfirmation(
      suspended.snapshot,
      'c1',
      { actor: 'human', principal: 'user:mike' },
      '仍在服务,不归档',
      postDeps,
    );
    if (decision.kind !== 'confirmed') throw new Error('前置失败');

    const log = [
      seedFromSnapshot,
      ...withSeq(suspended.events, 2),
      ...withSeq(decision.events, 3),
    ];
    const replayed = fold(log, postDeps);

    expect(replayed.instances['post:post-welcome']?.node).toBe('published');
    expect(replayed.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'rejected',
      rejectedReason: '仍在服务,不归档',
    });
    expect(contentVersion(replayed)).toBe(contentVersion(decision.snapshot));
  });

  it('confirmation-approved 指向未知确认 → 响亮失败(日志完整性,带 seq)', () => {
    const orphan: LogEvent = {
      seq: 2,
      kind: 'confirmation-approved',
      rel: 'confirmation:ghost',
      action: 'approve',
      actor: 'human',
      detail: {
        id: 'ghost',
        proposedBy: { actor: 'agent' },
        decidedBy: { actor: 'human' },
      },
    };

    expect(() => fold([seedFromSnapshot, orphan], postDeps)).toThrow(/seq=2/);
  });

  it('重复 confirmation-requested(同 id)→ 响亮失败(日志完整性)', () => {
    const requested: LogEvent = {
      seq: 2,
      kind: 'confirmation-requested',
      rel: 'confirmation:c1',
      action: 'archive',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
      detail: {
        id: 'c1',
        targetRel: 'post:post-welcome',
        targetAction: 'archive',
        policy: 'builtin:high-agent',
        policyReason: 'x',
        request: agentArchive,
      } satisfies ConfirmationRequestDetail,
    };

    expect(() => fold([seedFromSnapshot, requested, { ...requested, seq: 3 }], postDeps)).toThrow(
      /c1/,
    );
  });

  it('approval 事件缺 detail 载荷 → 响亮失败(不静默吞)', () => {
    const malformed = {
      seq: 2,
      kind: 'confirmation-approved',
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
    } as unknown as LogEvent;

    expect(() => fold([seedFromSnapshot, malformed], postDeps)).toThrow(/seq=2/);
  });
});

// ---------------------------------------------------------------------------
// notification-delivered(T3 Phase C:notify capability 送达事件,worker 第二写者)
// ---------------------------------------------------------------------------

/** 挂起一次 agent archive,产出(日志前缀, 挂起产出)——同一次执行,防二次挂起出 c2。 */
function suspendedOnce(): { log: LogEvent[]; suspended: ReturnType<typeof executeWithGates> } {
  const base = fold([seedFromSnapshot], postDeps);
  const suspended = executeWithGates(agentArchive, base, postDeps);
  if (suspended.kind !== 'suspended') throw new Error(`前置失败:期望 suspended,得到 ${suspended.kind}`);
  return { log: [seedFromSnapshot, ...withSeq(suspended.events, 2)], suspended };
}

/** worker 写出的送达事件形状(与 apps/worker/src/activities.ts 同构)。 */
function deliveredEvent(seq: number, rel = 'confirmation:c1'): LogEvent {
  return {
    seq,
    kind: 'notification-delivered',
    rel,
    actor: 'agent',
    principal: 'user:mike',
    channel: 'notify',
    detail: {
      notificationId: `notif:${rel.slice('confirmation:'.length)}`,
      confirmation: {
        id: rel.slice('confirmation:'.length),
        targetRel: 'post:post-welcome',
        targetAction: 'archive',
        proposedBy: { actor: 'agent', principal: 'user:mike' },
      },
    },
  };
}

describe('fold — notification-delivered(T3 Phase C)', () => {
  it('送达 → 对应 confirmation 标记 notified=true(inbox delivered 计数的数据源)', () => {
    const snapshot = fold([...suspendedOnce().log, deliveredEvent(3)], postDeps);

    expect(snapshot.confirmations?.['confirmation:c1']).toMatchObject({ status: 'pending', notified: true });
  });

  it('重复送达(同 rel,capability 重试)→ 幂等:不抛错、状态不变', () => {
    const log = [...suspendedOnce().log, deliveredEvent(3), deliveredEvent(4)];

    expect(() => fold(log, postDeps)).not.toThrow();
    const snapshot = fold(log, postDeps);
    expect(snapshot.confirmations?.['confirmation:c1']?.notified).toBe(true);
  });

  it('挂起→送达→approve 全链重放:notified 保留、效果出现(hash 与在线一致,I5)', () => {
    const { log: logBefore, suspended } = suspendedOnce();
    if (suspended.kind !== 'suspended') throw new Error('前置失败');
    // 在线等价路径:worker 送达 → web 增量 fold(拿到 notified)→ human approve。
    const withDelivery = fold([deliveredEvent(3)], postDeps, suspended.snapshot);
    const decision = approveConfirmation(
      withDelivery,
      'c1',
      { actor: 'human', principal: 'user:mike' },
      postDeps,
    );
    if (decision.kind !== 'confirmed') throw new Error('前置失败');

    const log = [...logBefore, deliveredEvent(3), ...withSeq(decision.events, 4)];
    const replayed = fold(log, postDeps);

    expect(replayed.instances['post:post-welcome']?.node).toBe('archived');
    expect(replayed.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'approved',
      notified: true,
    });
    expect(contentVersion(replayed)).toBe(contentVersion(decision.snapshot));
  });

  it('指向未知确认 → 响亮失败(日志完整性,带 seq)', () => {
    expect(() => fold([seedFromSnapshot, deliveredEvent(2, 'confirmation:ghost')], postDeps)).toThrow(
      /seq=2/,
    );
  });

  it('增量重放:fold(后段, initial=前段快照) 与全量 fold 同构(I5;web 读路径增量 fold 的根基)', () => {
    const log = [...suspendedOnce().log, deliveredEvent(3)];
    const first = fold(log.slice(0, 2), postDeps);

    const incremental = fold(log.slice(2), postDeps, first);

    expect(contentVersion(incremental)).toBe(contentVersion(fold(log, postDeps)));
    expect(incremental.confirmations?.['confirmation:c1']?.notified).toBe(true);
  });
});
