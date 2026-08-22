import { describe, expect, it } from 'vitest';

import { authorizeEffects } from './authorization';
import { instanceEntity } from './testkit';
import type { ConversationContext, ConversationMessage, EffectAuthorization } from './types';

const firstPost = instanceEntity({
  rel: 'post:first-post',
  flow: 'post-status',
  node: 'published',
  fields: { title: '第一篇' },
  actions: [
    {
      name: 'unpublish',
      title: '下线',
      method: 'POST',
      href: '/api/exec',
      fields: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'archive',
      title: '归档',
      method: 'POST',
      href: '/api/exec',
      fields: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
});

const userMessages: ConversationMessage[] = [
  { messageId: 'm1', role: 'user', content: '请下线第一篇' },
  { messageId: 'm2', role: 'user', content: '总结第一篇文章' },
  { messageId: 'm3', role: 'user', content: '把它归档' },
  { messageId: 'a1', role: 'assistant', content: '请下线第一篇' },
];

function evidence(sourceMessageId: string, quote: string): EffectAuthorization {
  return { sourceMessageId, quote };
}

describe('effect authorization', () => {
  it('要求用户原话同时点名目标和合同 action', () => {
    expect(
      authorizeEffects({
        authorization: evidence('m1', '下线第一篇'),
        effects: [{ rel: 'post:first-post', action: 'unpublish', entity: firstPost }],
        messages: userMessages,
      }),
    ).toEqual({ ok: true });
  });

  it('只读原话不能授权一个合同合法的写 action', () => {
    const result = authorizeEffects({
      authorization: evidence('m2', '总结第一篇文章'),
      effects: [{ rel: 'post:first-post', action: 'archive', entity: firstPost }],
      messages: userMessages,
    });

    expect(result).toMatchObject({ ok: false, code: 'action-not-authorized' });
  });

  it.each([
    ['missing-message', evidence('missing', '下线第一篇'), 'message-not-found'],
    ['assistant-message', evidence('a1', '下线第一篇'), 'message-not-user'],
    ['invented-quote', evidence('m1', '归档第一篇'), 'quote-not-exact'],
  ])('%s 被机械拒绝', (_name, authorization, code) => {
    expect(
      authorizeEffects({
        authorization,
        effects: [{ rel: 'post:first-post', action: 'unpublish', entity: firstPost }],
        messages: userMessages,
      }),
    ).toMatchObject({ ok: false, code });
  });

  it('错误 target 不能借用正确 action 文本通过', () => {
    const other = instanceEntity({
      rel: 'post:second-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第二篇' },
      actions: firstPost.actions,
    });
    expect(
      authorizeEffects({
        authorization: evidence('m1', '下线第一篇'),
        effects: [{ rel: 'post:second-post', action: 'unpublish', entity: other }],
        messages: userMessages,
      }),
    ).toMatchObject({ ok: false, code: 'target-not-authorized' });
  });

  it('可以使用来自日志投影的显式结构化授权解决指代', () => {
    const conversation: ConversationContext = {
      authorizedEffects: [
        {
          rel: 'post:first-post',
          action: 'archive',
          sourceMessageId: 'm3',
          status: 'active',
        },
      ],
    };
    expect(
      authorizeEffects({
        authorization: evidence('m3', '把它归档'),
        effects: [{ rel: 'post:first-post', action: 'archive', entity: firstPost }],
        messages: userMessages,
        conversation,
      }),
    ).toEqual({ ok: true });
  });

  it('exec-plan 的一份计划级证据必须覆盖每一个 effect', () => {
    const result = authorizeEffects({
      authorization: evidence('m1', '下线第一篇'),
      effects: [
        { rel: 'post:first-post', action: 'unpublish', entity: firstPost },
        { rel: 'post:first-post', action: 'archive', entity: firstPost },
      ],
      messages: userMessages,
    });

    expect(result).toMatchObject({ ok: false, code: 'action-not-authorized' });
  });

  it('ASCII action 按完整 token 匹配，publish 不能从 unpublish 中借授权', () => {
    const english = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'draft',
      fields: { title: 'first-post' },
      actions: [
        {
          name: 'publish',
          title: 'publish',
          method: 'POST',
          href: '/api/exec',
          fields: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    });
    expect(
      authorizeEffects({
        authorization: evidence('m4', 'unpublish first-post'),
        effects: [{ rel: 'post:first-post', action: 'publish', entity: english }],
        messages: [
          ...userMessages,
          { messageId: 'm4', role: 'user', content: 'unpublish first-post' },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'action-not-authorized' });
  });
});
