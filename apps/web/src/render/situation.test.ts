/**
 * 态势投影测试(T7 Phase B / spec 架构决定 5):主页骨架的静态绑定
 * (写死,零 AI,审计通道隔离)——stat 数值与实体 count 逐项相等
 * (deref 输出对拍,I2 口径);事件日志成员适配 timeline 词条。
 */
import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { derefSpec } from './deref';
import type { EntityCache } from './deref';

import { eventsToMembers, runningDelegationsOf, situationStatBinds } from './situation';

function collectionOf(rel: string, count: number): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, count },
    actions: [],
    links: [],
  };
}

function delegation(rel: string, status: string): SirenEntity {
  return {
    class: ['delegation'],
    properties: { rel, status },
    actions: [],
    links: [],
  };
}

function cacheOf(...entities: SirenEntity[]): EntityCache {
  return new Map(entities.map((entity) => [String(entity.properties.rel), entity]));
}

describe('态势 stat 绑定(静态,零 AI)', () => {
  it('两个实体 stat 的 bind 全为字段引用(零字面:值来自实体,页面代码不含数字载荷)', () => {
    for (const stat of Object.values(situationStatBinds())) {
      // 结构检查:bind.value 是 field 引用节点(骨架与生成路径同一条剃刀)
      expect(stat.bind).toEqual({ value: { field: expect.stringMatching(/^.+\..+$/) } });
    }
  });

  it('deref 对拍:待确认 = inbox.count,文章数 = articles.count(与实体逐项相等)', () => {
    const cache = cacheOf(collectionOf('inbox', 3), collectionOf('articles', 2));
    const stats = situationStatBinds();
    const pending = derefSpec(stats.pending, cache);
    const articles = derefSpec(stats.articles, cache);
    expect(pending.value).toBe(3);
    expect(articles.value).toBe(2);
  });

  it('在飞委托 = delegations 成员 status=running 计数(集合投影,零 AI)', () => {
    const fleet: SirenEntity = {
      class: ['collection', 'delegations'],
      properties: { rel: 'delegations', count: 3 },
      actions: [],
      links: [],
      entities: [delegation('delegation:a', 'running'), delegation('delegation:b', 'completed'), delegation('delegation:c', 'running')],
    };
    expect(runningDelegationsOf(fleet)).toBe(2);
    expect(runningDelegationsOf({ ...fleet, entities: [] })).toBe(0);
  });
});

describe('事件日志成员适配(timeline 词条输入)', () => {
  it('LogEvent 行 → 机械叙事摘要 + 时间戳 + 原始审计载荷,零发明', () => {
    const members = eventsToMembers([
      { seq: 1, ts: '2026-08-22T01:00:00.000Z', kind: 'seed', rel: 'seed:business-domain', action: null, actor: null, principal: null, channel: null },
      { seq: 2, ts: '2026-08-22T01:01:00.000Z', kind: 'action-executed', rel: 'post:post-welcome', action: 'unpublish', actor: 'human', principal: 'local-user', channel: 'renderer', reason: null, detail: { layer: 'flow' } },
    ]);
    expect(members).toHaveLength(2);
    expect(members[0]!.properties.seq).toBe(1);
    expect(members[0]!.properties.kind).toBe('seed');
    expect(members[1]!.properties.action).toBe('unpublish');
    expect(members[1]!.properties.actor).toBe('human');
    expect(members[1]!.properties.summary).toBe(
      '人类(local-user) · post:post-welcome · 执行「unpublish」 · 已完成',
    );
    expect(members[1]!.properties.timestamp).toBe('2026-08-22T01:01:00.000Z');
    expect(members[1]!.properties.audit).toMatchObject({
      kind: 'action-executed',
      detail: { layer: 'flow' },
    });
    // 成员形状满足 timeline 词条的 asMembers 约束(properties 字典在)
    expect(typeof members[0]!.properties).toBe('object');
  });

  it('未知 kind 回退原始字段行;chat-turn/agent-decision 形成回合级摘要', () => {
    const members = eventsToMembers([
      { seq: 1, kind: 'mystery-event', rel: 'x', action: 'probe', actor: null, principal: null, channel: null },
      { seq: 2, kind: 'chat-turn-started', rel: 'chat:s1', action: null, actor: 'agent', principal: 'user:s1', channel: 'chat', detail: { goal: { verb: '发布' } } },
      { seq: 3, kind: 'chat-turn-progress', rel: 'chat:s1', action: null, actor: 'agent', principal: 'user:s1', channel: 'chat', detail: { step: { step: 1 } } },
      { seq: 4, kind: 'chat-turn', rel: 'chat:s1', action: null, actor: 'agent', principal: 'user:s1', channel: 'chat', detail: { goal: { verb: '发布' }, outcome: 'done', steps: [{ step: 1 }] } },
      { seq: 5, kind: 'agent-decision', rel: 'chat:s1', action: null, actor: 'agent', principal: 'user:s1', channel: 'chat', detail: { step: 1, driver: 'rule', op: { kind: 'navigate', rel: 'articles' } } },
    ]);
    expect(members[0]!.properties.summary).toContain('kind=mystery-event');
    expect(members[0]!.properties.summary).toContain('rel=x');
    expect(members[1]!.properties.summary).toContain('开始聊天回合「发布」');
    expect(members[1]!.properties.summary).toContain('执行中');
    expect(members[2]!.properties.summary).toContain('记录聊天进展 1');
    expect(members[3]!.properties.summary).toContain('聊天回合「发布」');
    expect(members[3]!.properties.summary).toContain('已完成');
    expect(members[4]!.properties.summary).toContain('第 1 步决策(rule)');
    expect(members[4]!.properties.summary).toContain('navigate');
  });

  it('最近 N 事件:取尾部保 seq 序(append 序即时间序)', () => {
    const rows = [1, 2, 3, 4, 5].map((seq) => ({
      seq,
      kind: 'seed',
      rel: 'x',
      action: null,
      actor: null,
      principal: null,
      channel: null,
    }));
    const members = eventsToMembers(rows, 3);
    expect(members.map((member) => member.properties.seq)).toEqual([3, 4, 5]);
  });
});
