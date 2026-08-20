import { describe, expect, it } from 'vitest';

import type { GuardContext } from './guards';
import { isPending, isPublished, alwaysTrue, nodeIs, seedGuardRegistry, titleNotTaken } from './predicates';
import type { EngineSnapshot } from './state';

function contextAt(node: string): GuardContext {
  const snapshot: EngineSnapshot = {
    instances: {
      'comment:c1': { rel: 'comment:c1', flow: 'comment-moderation', node, fields: {} },
    },
    collections: {},
  };
  return {
    instance: snapshot.instances['comment:c1']!,
    snapshot,
    params: {},
  };
}

describe('种子谓词(纯函数,只读快照)', () => {
  it('is-pending:node=pending 为 true,其余 false', () => {
    expect(isPending(contextAt('pending'))).toBe(true);
    expect(isPending(contextAt('approved'))).toBe(false);
  });

  it('is-published:node=published 为 true,其余 false', () => {
    expect(isPublished(contextAt('published'))).toBe(true);
    expect(isPublished(contextAt('offline'))).toBe(false);
  });

  it('always-true 恒真(空 guard 动作的显式占位)', () => {
    expect(alwaysTrue(contextAt('anything'))).toBe(true);
  });

  it('nodeIs(name) 工厂:生成具名节点谓词', () => {
    const isOffline = nodeIs('offline');
    expect(isOffline(contextAt('offline'))).toBe(true);
    expect(isOffline(contextAt('pending'))).toBe(false);
  });

  it('title-not-taken:params.title 不与既有 post 标题重复(跨实例只读快照)', () => {
    const snapshot: EngineSnapshot = {
      instances: {
        'post:post-welcome': {
          rel: 'post:post-welcome',
          flow: 'post-status',
          node: 'published',
          fields: { title: { value: '欢迎来到 UI4A', origin: 'intent' } },
        },
        // 非文章实例的同名字段不算占用。
        'comment:c1': {
          rel: 'comment:c1',
          flow: 'comment-moderation',
          node: 'pending',
          fields: { title: { value: '欢迎来到 UI4A', origin: 'intent' } },
        },
        'article-drafting:main': {
          rel: 'article-drafting:main',
          flow: 'article-drafting',
          node: 'ready',
          fields: {},
        },
      },
      collections: {},
    };
    const context = (params: Record<string, unknown>): GuardContext => ({
      instance: snapshot.instances['article-drafting:main']!,
      snapshot,
      params,
    });

    expect(titleNotTaken(context({ title: '新文章' }))).toBe(true);
    expect(titleNotTaken(context({ title: '欢迎来到 UI4A' }))).toBe(false);
    expect(titleNotTaken(context({}))).toBe(true);
  });

  it('谓词求值不改上下文(纯)', () => {
    const context = contextAt('pending');
    const before = JSON.stringify(context);
    isPending(context);
    nodeIs('x')(context);
    expect(JSON.stringify(context)).toBe(before);
  });
});

describe('seedGuardRegistry(名字 → 谓词)', () => {
  it('包含种子谓词名', () => {
    expect(Object.keys(seedGuardRegistry)).toEqual(
      expect.arrayContaining(['is-pending', 'is-published', 'always-true', 'title-not-taken']),
    );
  });

  it('注册表条目可直接求值', () => {
    expect(seedGuardRegistry['is-pending']!(contextAt('pending'))).toBe(true);
    expect(seedGuardRegistry['is-published']!(contextAt('pending'))).toBe(false);
  });
});
