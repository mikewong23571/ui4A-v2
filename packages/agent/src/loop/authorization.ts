/**
 * 意图到副作用的机械授权门。
 *
 * 这里不做用户意图分类，也不把自然语言同义词降格为关键词规则：driver
 * 负责把用户意图映射到动态合同 target/action；本门只验证证据确实来自保留
 * 的 user 原话。语义正确性由真实 LLM Eval 评估，合同声明/guard/schema/
 * confirmation 继续机械裁决。LLM 单方面填写证据不能创造用户授权来源。
 */
import type { SirenEntity } from '@ui4a/engine';

import type { ConversationContext, ConversationMessage, EffectAuthorization } from '../types';

export interface ProposedEffect {
  rel: string;
  action: string;
  /** 已观察的授权 Siren 快照；用于获取 action title 和目标显示名。 */
  entity?: SirenEntity;
}

export type EffectAuthorizationFailureCode =
  'missing-evidence' | 'message-not-found' | 'message-not-user' | 'quote-not-exact';

export type EffectAuthorizationResult =
  { ok: true } | { ok: false; code: EffectAuthorizationFailureCode; reason: string };

export interface AuthorizeEffectsInput {
  authorization?: EffectAuthorization;
  effects: ProposedEffect[];
  messages: ConversationMessage[];
  conversation?: ConversationContext;
}

/** 一份来源证据可以随单步 exec 或整份 plan 留痕。 */
export function authorizeEffects(input: AuthorizeEffectsInput): EffectAuthorizationResult {
  const { authorization } = input;
  if (authorization === undefined || authorization.quote === '') {
    return { ok: false, code: 'missing-evidence', reason: '缺少可追溯的用户授权证据' };
  }

  const message = input.messages.find(
    (candidate) => candidate.messageId === authorization.sourceMessageId,
  );
  if (message === undefined) {
    return {
      ok: false,
      code: 'message-not-found',
      reason: `授权消息 ${authorization.sourceMessageId} 不在保留的会话原文中`,
    };
  }
  if (message.role !== 'user') {
    return {
      ok: false,
      code: 'message-not-user',
      reason: `授权消息 ${authorization.sourceMessageId} 不是 user 原话`,
    };
  }
  if (!message.content.includes(authorization.quote)) {
    return {
      ok: false,
      code: 'quote-not-exact',
      reason: '授权 quote 不是所指 user message 的逐字片段',
    };
  }

  return { ok: true };
}
