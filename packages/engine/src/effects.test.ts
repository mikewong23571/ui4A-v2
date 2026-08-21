import { describe, expect, it } from 'vitest';

import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
  seedSnapshot,
} from './fixtures';
import { applyEffects } from './effects';
import type { EngineEvent } from './effects';
import type { ExecRequest } from './judge';

const deps = {
  flows: flowRegistry(articleDraftingFlow, postStatusFlow, commentModerationFlow),
};

function exec(action: string, rel: string, params?: Record<string, unknown>): ExecRequest {
  return { rel, action, params, actor: 'agent', principal: 'user-mike', channel: 'chat' };
}

describe('效果词汇表 — transition', () => {
  it('实例节点迁移,产出 action-executed 事件(带 to 与参数出处)', () => {
    const outcome = applyEffects(
      exec('approve', 'comment:c1'),
      [{ type: 'transition', to: 'approved' }],
      seedSnapshot,
      deps,
    );
    expect(outcome.snapshot.instances['comment:c1']?.node).toBe('approved');
    expect(outcome.events).toEqual([
      expect.objectContaining({
        kind: 'action-executed',
        rel: 'comment:c1',
        action: 'approve',
        actor: 'agent',
        principal: 'user-mike',
        channel: 'chat',
        to: 'approved',
      }),
    ]);
  });

  it('请求参数按声明字段落入实例字段,缺省出处 intent', () => {
    const outcome = applyEffects(
      exec('next', 'article-drafting:main', { category: 'tech', tags: 'siren' }),
      [{ type: 'transition', to: 'content' }],
      seedSnapshot,
      deps,
    );
    const fields = outcome.snapshot.instances['article-drafting:main']?.fields;
    expect(fields?.category).toEqual({ value: 'tech', origin: 'intent' });
    expect(fields?.tags).toEqual({ value: 'siren', origin: 'intent' });
    expect(fields?.title).toEqual({ value: 'New Article', origin: 'intent' }); // 原值保留
  });

  it('paramOrigins 覆盖出处(proposal/elicited 留痕)', () => {
    const outcome = applyEffects(
      {
        ...exec('next', 'article-drafting:main', { category: 'tech' }),
        paramOrigins: { category: 'proposal' },
      },
      [{ type: 'transition', to: 'content' }],
      seedSnapshot,
      deps,
    );
    expect(outcome.snapshot.instances['article-drafting:main']?.fields.category).toEqual({
      value: 'tech',
      origin: 'proposal',
    });
  });

  it('非法迁移(to 不在 machine 边上)抛错——引擎配置错误必须显性失败', () => {
    expect(() =>
      applyEffects(
        exec('approve', 'comment:c1'),
        [{ type: 'transition', to: 'published' }],
        seedSnapshot,
        deps,
      ),
    ).toThrow(/迁移/);
  });

  it('实例不存在抛错', () => {
    expect(() =>
      applyEffects(exec('go', 'ghost:rel'), [{ type: 'transition', to: 'approved' }], seedSnapshot, deps),
    ).toThrow(/不存在/);
  });
});

describe('效果词汇表 — set-field', () => {
  it('写字段并记录出处(缺省 effect)', () => {
    const outcome = applyEffects(
      exec('flag', 'comment:c1'),
      [{ type: 'set-field', field: 'flagged', value: true }],
      seedSnapshot,
      deps,
    );
    expect(outcome.snapshot.instances['comment:c1']?.fields.flagged).toEqual({
      value: true,
      origin: 'effect',
    });
  });

  it('显式 origin 优先', () => {
    const outcome = applyEffects(
      exec('flag', 'comment:c1'),
      [{ type: 'set-field', field: 'owner', value: 'bot', origin: 'default' }],
      seedSnapshot,
      deps,
    );
    expect(outcome.snapshot.instances['comment:c1']?.fields.owner).toEqual({
      value: 'bot',
      origin: 'default',
    });
  });
});

describe('效果词汇表 — append(生成 `类型:实例名` rel)', () => {
  it('从 name-from 参数 slug 生成新实例并入集合,字段带出处复制', () => {
    const outcome = applyEffects(
      exec(
        'publish',
        'article-drafting:main',
        { title: 'New Article', category: 'tech', tags: 'x' },
      ),
      [
        { type: 'transition', to: 'done' },
        {
          type: 'append',
          collection: 'articles',
          'resource-type': 'post',
          'name-from': 'title',
          node: 'published',
          flow: 'post-status',
        },
      ],
      {
        ...seedSnapshot,
        instances: {
          ...seedSnapshot.instances,
          'article-drafting:main': {
            ...seedSnapshot.instances['article-drafting:main']!,
            node: 'ready',
            fields: {
              ...seedSnapshot.instances['article-drafting:main']!.fields,
              category: { value: 'tech', origin: 'intent' },
              tags: { value: 'x', origin: 'intent' },
            },
          },
        },
      },
      deps,
    );

    const article = outcome.snapshot.instances['post:new-article'];
    expect(article).toMatchObject({
      rel: 'post:new-article',
      flow: 'post-status',
      node: 'published',
    });
    expect(article?.fields.title).toEqual({ value: 'New Article', origin: 'intent' });
    expect(outcome.snapshot.collections.articles).toEqual([
      'post:post-welcome',
      'post:post-getting-started',
      'post:new-article',
    ]);
    // 事件序:action-executed → entity-appended
    expect(outcome.events.map((e) => e.kind)).toEqual(['action-executed', 'entity-appended']);
    expect(outcome.events[1]).toMatchObject({
      kind: 'entity-appended',
      appendedRel: 'post:new-article',
      collection: 'articles',
    });
    // 向导实例同时迁移到 done(组合效果)
    expect(outcome.snapshot.instances['article-drafting:main']?.node).toBe('done');
  });

  it('显式 name 直接使用;fields 白名单只复制列名字段', () => {
    const outcome = applyEffects(
      exec('publish', 'article-drafting:main', { title: 'T', category: 'tech' }),
      [
        {
          type: 'append',
          collection: 'articles',
          'resource-type': 'post',
          name: 'post-custom',
          fields: ['title'],
          node: 'published',
          flow: 'post-status',
        },
      ],
      seedSnapshot,
      deps,
    );
    const article = outcome.snapshot.instances['post:post-custom'];
    expect(article?.fields).toEqual({ title: { value: 'T', origin: 'intent' } });
  });

  it('rel 冲突时确定性去重(追加序号后缀)', () => {
    const outcome = applyEffects(
      exec('publish', 'article-drafting:main', { title: 'Welcome to UI4A' }),
      [
        {
          type: 'append',
          collection: 'articles',
          'resource-type': 'post',
          'name-from': 'title',
          node: 'published',
          flow: 'post-status',
        },
      ],
      seedSnapshot,
      deps,
    );
    // seedSnapshot 里已有 post-welcome? 无,但 title slug 为 welcome-to-ui4a;构造冲突:
    expect(outcome.snapshot.instances['post:welcome-to-ui4a']).toBeDefined();
    const outcome2 = applyEffects(
      exec('publish', 'article-drafting:main', { title: 'Welcome to UI4A' }),
      [
        {
          type: 'append',
          collection: 'articles',
          'resource-type': 'post',
          'name-from': 'title',
          node: 'published',
          flow: 'post-status',
        },
      ],
      outcome.snapshot,
      deps,
    );
    expect(outcome2.snapshot.instances['post:welcome-to-ui4a-2']).toBeDefined();
    expect(outcome2.snapshot.collections.articles).toHaveLength(4);
  });
});

describe('效果词汇表 — spawn(T2 stub:只记事件不改状态)', () => {
  it('产出 spawn-requested 事件,携带 capability/bind/on-done;快照实例不变', () => {
    const outcome = applyEffects(
      exec('summarize', 'post:post-welcome'),
      [
        {
          type: 'spawn',
          capability: 'summarize',
          bind: { target: 'post:post-welcome' },
          'on-done': 'summarized',
        },
      ],
      seedSnapshot,
      deps,
    );
    // T3 机械适配:applyEffects 恒携带 confirmations 表(空表也随行),spawn 不改其内容。
    // T4 机械适配:definitions/activations/definitionVersions 表同口径随行。
    // T5 机械适配:delegations 表同口径随行。
    expect(JSON.stringify(outcome.snapshot)).toBe(
      JSON.stringify({
        ...seedSnapshot,
        confirmations: {},
        delegations: {},
        definitions: {},
        activations: {},
        definitionVersions: {},
      }),
    );
    expect(outcome.events.map((e) => e.kind)).toEqual(['action-executed', 'spawn-requested']);
    expect(outcome.events[1]).toMatchObject({
      kind: 'spawn-requested',
      capability: 'summarize',
      bind: { target: 'post:post-welcome' },
      'on-done': 'summarized',
    });
  });
});

describe('效果应用 — 纯函数性', () => {
  it('不改动输入快照(不可变)', () => {
    const before = JSON.stringify(seedSnapshot);
    applyEffects(
      exec('next', 'article-drafting:main', { category: 'tech' }),
      [
        { type: 'set-field', field: 'marker', value: 1 },
        { type: 'transition', to: 'content' },
      ],
      seedSnapshot,
      deps,
    );
    expect(JSON.stringify(seedSnapshot)).toBe(before);
  });

  it('新快照是新引用,原集合数组不被原地修改', () => {
    const outcome = applyEffects(
      exec('publish', 'article-drafting:main', { title: 'Another' }),
      [
        {
          type: 'append',
          collection: 'articles',
          'resource-type': 'post',
          'name-from': 'title',
          node: 'published',
          flow: 'post-status',
        },
      ],
      seedSnapshot,
      deps,
    );
    expect(outcome.snapshot).not.toBe(seedSnapshot);
    expect(seedSnapshot.collections.articles).toHaveLength(2);
    expect(outcome.snapshot.collections.articles).toHaveLength(3);
  });

  it('EngineEvent 为可序列化纯数据(日志 append 的直接输入)', () => {
    const outcome = applyEffects(
      exec('approve', 'comment:c1'),
      [{ type: 'transition', to: 'approved' }],
      seedSnapshot,
      deps,
    );
    const roundTrip = JSON.parse(JSON.stringify(outcome.events)) as EngineEvent[];
    expect(roundTrip).toEqual(outcome.events);
  });
});
