import { describe, expect, it } from 'vitest';

import { contentVersion, fold, parseFlowDefinition } from '@ui4a/engine';
import { seedGuardRegistry } from '@ui4a/shared';

import {
  businessFlows,
  businessFlowList,
  commentModerationFlow,
  postStatusFlow,
  articleDraftingFlow,
} from './flows';
import { SEED_REL, seedDetail } from './seed';

// 种子业务域合同测试(spec 架构决定 5 / FR3):
// - 三个 flow 常量 machine-as-JSON 合法(parseFlowDefinition 全量校验);
// - 形状满足 B1(三步向导+publish append)、B2(unpublish/archive/republish)、
//   B3(approve/reject 带 is-pending);
// - seed 载荷 = 2 文章 + 4 评论(3 pending + 1 approved)+ 发布向导实例;
// - seed 事件折叠幂等(重复 seed 不翻倍,fold 只补缺)。

function nodeOf(flow: ReturnType<typeof parseFlowDefinition>, name: string) {
  const node = flow.nodes.find((candidate) => candidate.name === name);
  if (node === undefined) throw new Error(`节点 "${name}" 不存在`);
  return node;
}

describe('种子 flow 常量(machine-as-JSON)', () => {
  it('三个 flow 均通过 parseFlowDefinition 校验并进入注册表', () => {
    for (const flow of [articleDraftingFlow, postStatusFlow, commentModerationFlow]) {
      expect(() => parseFlowDefinition(flow)).not.toThrow();
    }
    expect(Object.keys(businessFlows)).toEqual([
      'article-drafting',
      'post-status',
      'comment-moderation',
    ]);
  });

  it('article-drafting:三步向导,每步一个推进动作,publish 追加文章并迁移向导', () => {
    expect(articleDraftingFlow.initial).toBe('basic-info');
    expect(articleDraftingFlow.nodes.map((node) => node.name)).toEqual([
      'basic-info',
      'classification',
      'content',
      'ready',
      'done',
    ]);

    // 三步字段:B1 的严格 schema 填充依据。
    expect(nodeOf(articleDraftingFlow, 'basic-info').fields).toEqual([
      expect.objectContaining({ name: 'title', type: 'text', required: true }),
    ]);
    expect(nodeOf(articleDraftingFlow, 'classification').fields).toEqual([
      expect.objectContaining({
        name: 'category',
        type: 'select',
        options: ['tech', 'essay', 'review'],
      }),
      expect.objectContaining({ name: 'tags', type: 'text' }),
    ]);
    expect(nodeOf(articleDraftingFlow, 'content').fields).toEqual([
      expect.objectContaining({ name: 'body', type: 'textarea', required: true }),
    ]);

    // 每步一个推进动作(声明于该节点,fields 即节点字段)。
    expect(nodeOf(articleDraftingFlow, 'basic-info').actions).toEqual([
      expect.objectContaining({ name: 'next', to: 'classification' }),
    ]);
    expect(nodeOf(articleDraftingFlow, 'classification').actions).toEqual([
      expect.objectContaining({ name: 'next', to: 'content' }),
    ]);
    expect(nodeOf(articleDraftingFlow, 'content').actions).toEqual([
      expect.objectContaining({ name: 'next', to: 'ready' }),
    ]);

    // ready:publish(to done)+ [transition, append] 组合效果。
    const ready = nodeOf(articleDraftingFlow, 'ready');
    expect(ready.actions).toHaveLength(1);
    const publish = ready.actions[0]!;
    expect(publish.name).toBe('publish');
    expect(publish.to).toBe('done');
    expect(publish.fields).toEqual([
      expect.objectContaining({ name: 'title', type: 'text', required: true }),
    ]);
    expect(publish.effect).toEqual([
      { type: 'transition', to: 'done' },
      {
        type: 'append',
        collection: 'articles',
        'resource-type': 'post',
        flow: 'post-status',
        'name-from': 'title',
        node: 'published',
      },
    ]);

    // done 为终态(无动作)。
    expect(nodeOf(articleDraftingFlow, 'done').actions).toEqual([]);
  });

  it('post-status:published 有 unpublish/archive,offline 有 republish,archived 终态', () => {
    expect(postStatusFlow.initial).toBe('published');

    const published = nodeOf(postStatusFlow, 'published');
    expect(published.title).toBe('已发布');
    expect(published.actions).toEqual([
      expect.objectContaining({
        name: 'unpublish',
        title: '下线',
        to: 'offline',
        guards: ['is-published'],
      }),
      expect.objectContaining({
        name: 'archive',
        title: '归档',
        to: 'archived',
        guards: ['is-published'],
        'requires-confirmation': 'high',
      }),
    ]);

    const offline = nodeOf(postStatusFlow, 'offline');
    expect(offline.title).toBe('已下线');
    expect(offline.actions).toEqual([
      expect.objectContaining({ name: 'republish', to: 'published' }),
    ]);

    expect(nodeOf(postStatusFlow, 'archived').actions).toEqual([]);
  });

  it('comment-moderation:pending 的 approve/reject 挂 is-published 外无多余动作', () => {
    expect(commentModerationFlow.initial).toBe('pending');
    const pending = nodeOf(commentModerationFlow, 'pending');
    expect(pending.actions).toEqual([
      expect.objectContaining({ name: 'approve', to: 'approved', guards: ['is-pending'] }),
      expect.objectContaining({ name: 'reject', to: 'rejected', guards: ['is-pending'] }),
    ]);
    expect(nodeOf(commentModerationFlow, 'approved').actions).toEqual([]);
    expect(nodeOf(commentModerationFlow, 'rejected').actions).toEqual([]);
  });

  it('flow 引用的 guard 名全部注册于 shared 种子注册表', () => {
    const referenced = new Set<string>();
    for (const flow of businessFlowList) {
      for (const node of flow.nodes) {
        for (const action of node.actions) {
          for (const guard of action.guards ?? []) referenced.add(guard);
        }
      }
    }
    expect([...referenced].sort()).toEqual(['is-pending', 'is-published', 'title-not-taken']);
    for (const name of referenced) {
      expect(seedGuardRegistry[name], `guard "${name}" 应已注册`).toBeDefined();
    }
  });
});

describe('种子数据(seed 事件载荷)', () => {
  it('包含 2 篇已发布文章、4 条评论(3 pending + 1 approved)与向导实例', () => {
    const { instances, collections } = seedDetail;

    expect(instances['post:post-welcome']).toEqual(
      expect.objectContaining({
        rel: 'post:post-welcome',
        flow: 'post-status',
        node: 'published',
      }),
    );
    expect(instances['post:post-welcome']?.fields.title).toEqual({
      value: '欢迎来到 UI4A',
      origin: 'default',
    });
    expect(instances['post:first-post']).toEqual(
      expect.objectContaining({
        rel: 'post:first-post',
        flow: 'post-status',
        node: 'published',
      }),
    );
    expect(instances['post:first-post']?.fields.title).toEqual({
      value: '第一篇',
      origin: 'default',
    });

    for (const rel of ['comment:c1', 'comment:c2', 'comment:c3']) {
      expect(instances[rel]).toEqual(
        expect.objectContaining({ rel, flow: 'comment-moderation', node: 'pending' }),
      );
    }
    expect(instances['comment:c4']).toEqual(
      expect.objectContaining({ rel: 'comment:c4', flow: 'comment-moderation', node: 'approved' }),
    );

    // 向导实例从 basic-info 起步(B1 入口)。
    expect(instances['article-drafting:main']).toEqual(
      expect.objectContaining({
        rel: 'article-drafting:main',
        flow: 'article-drafting',
        node: 'basic-info',
        fields: {},
      }),
    );

    expect(collections).toEqual({
      articles: ['post:post-welcome', 'post:first-post'],
      comments: ['comment:c1', 'comment:c2', 'comment:c3', 'comment:c4'],
    });
    expect(Object.keys(instances)).toHaveLength(7);
  });

  it('seed 事件折叠出种子快照;重复 seed 折叠幂等(不翻倍)', () => {
    const seedEvent = { seq: 1, kind: 'seed' as const, rel: SEED_REL, detail: seedDetail };
    const snapshot = fold([seedEvent], { flows: businessFlows });

    expect(Object.keys(snapshot.instances)).toHaveLength(7);
    expect(snapshot.collections.articles).toHaveLength(2);
    expect(snapshot.collections.comments).toHaveLength(4);

    const doubled = fold([seedEvent, { ...seedEvent, seq: 2 }], { flows: businessFlows });
    expect(contentVersion(doubled)).toBe(contentVersion(snapshot));
  });
});
