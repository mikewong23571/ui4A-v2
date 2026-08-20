import { describe, expect, it } from 'vitest';

import type { InstanceSnapshot } from '@ui4a/shared';

import { fold, type LogEvent, type SeedDetail } from './fold';
import { articleDraftingFlow, commentModerationFlow, flowRegistry } from './fixtures';

// fold 投影(TDD 红→绿):事件日志 → 引擎快照的纯函数(arch-brief §4:
// "当前 UI 状态 = 日志折叠后的物化状态";I5 的根基)。
// 关键规则:
// - action-executed 重放 applyEffects(与在线路径同构,不重新裁决);
// - action-rejected 不改状态但参与日志(I6);
// - entity-appended / spawn-requested 是伴随事件(状态已由 action-executed 重放体现;
//   spawn 在 T2 不改状态),fold 不双算;
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
  it('空日志 → 空快照', () => {
    expect(fold([], { flows })).toEqual({ instances: {}, collections: {} });
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
