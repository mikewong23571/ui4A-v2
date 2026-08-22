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
  it('要求动态 target/action 映射携带可追溯 user 原话', () => {
    expect(
      authorizeEffects({
        authorization: evidence('m1', '下线第一篇'),
        effects: [{ rel: 'post:first-post', action: 'unpublish', entity: firstPost }],
        messages: userMessages,
      }),
    ).toEqual({ ok: true });
  });

  it('不以 action 名/title 关键词代替 LLM 的动态意图映射', () => {
    const result = authorizeEffects({
      authorization: evidence('m2', '总结第一篇文章'),
      effects: [{ rel: 'post:first-post', action: 'archive', entity: firstPost }],
      messages: userMessages,
    });

    expect(result).toEqual({ ok: true });
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

  it('不以 target 名关键词代替 LLM 的动态目标映射', () => {
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
    ).toEqual({ ok: true });
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

  it('exec-plan 共用一份原话 provenance，不用规则逐项重判目标语义', () => {
    const other = instanceEntity({
      rel: 'post:second-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第二篇' },
      actions: firstPost.actions,
    });
    const result = authorizeEffects({
      authorization: evidence('m1', '下线第一篇'),
      effects: [
        { rel: 'post:first-post', action: 'unpublish', entity: firstPost },
        { rel: 'post:second-post', action: 'archive', entity: other },
      ],
      messages: userMessages,
    });

    expect(result).toEqual({ ok: true });
  });
});
