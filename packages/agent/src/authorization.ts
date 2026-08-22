/**
 * 意图到副作用的机械授权门。
 *
 * 这里不做用户意图分类，也不推断同义词：driver 必须引用一条保留的
 * user 原话，而原话必须机械点名合同 action(name/title) 与目标；
 * 指代等无法逐字匹配的情况，只能由 append-only 日志投影的 active
 * authorizedEffects 补足。LLM 单方面填写证据不会创造授权。
 */
import type { SirenEntity } from '@ui4a/engine';

import type { ConversationContext, ConversationMessage, EffectAuthorization } from './types';

export interface ProposedEffect {
  rel: string;
  action: string;
  /** 已观察的授权 Siren 快照；用于获取 action title 和目标显示名。 */
  entity?: SirenEntity;
}

export type EffectAuthorizationFailureCode =
  | 'missing-evidence'
  | 'message-not-found'
  | 'message-not-user'
  | 'quote-not-exact'
  | 'action-not-authorized'
  | 'target-not-authorized';

export type EffectAuthorizationResult =
  { ok: true } | { ok: false; code: EffectAuthorizationFailureCode; reason: string };

export interface AuthorizeEffectsInput {
  authorization?: EffectAuthorization;
  effects: ProposedEffect[];
  messages: ConversationMessage[];
  conversation?: ConversationContext;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** ASCII 合同标识符按 token 匹配，避免 publish 误命中 unpublish。 */
function mentionsTerm(quote: string, rawTerm: string): boolean {
  const term = normalized(rawTerm);
  if (term === '') return false;
  const haystack = normalized(quote);
  if (/^[a-z0-9_:-]+$/u.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}($|[^\\p{L}\\p{N}_-])`, 'u').test(haystack);
  }
  return haystack.includes(term);
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function targetTerms(effect: ProposedEffect): string[] {
  const terms = new Set<string>([effect.rel]);
  const separator = effect.rel.indexOf(':');
  if (separator >= 0 && separator < effect.rel.length - 1) {
    terms.add(effect.rel.slice(separator + 1));
  }
  if (effect.entity !== undefined) {
    for (const key of ['title', 'name', 'label']) {
      const property = stringField(effect.entity.properties, key);
      const field = stringField(effect.entity.properties.fields, key);
      if (property !== undefined) terms.add(property);
      if (field !== undefined) terms.add(field);
    }
  }
  return [...terms];
}

function actionTerms(effect: ProposedEffect): string[] {
  const terms = new Set<string>([effect.action]);
  const declared = effect.entity?.actions.find((action) => action.name === effect.action);
  if (declared !== undefined) terms.add(declared.title);
  return [...terms];
}

function hasStructuredAuthorization(
  effect: ProposedEffect,
  sourceMessageId: string,
  conversation: ConversationContext | undefined,
): boolean {
  return (conversation?.authorizedEffects ?? []).some(
    (entry) =>
      entry.status === 'active' &&
      entry.sourceMessageId === sourceMessageId &&
      entry.rel === effect.rel &&
      entry.action === effect.action,
  );
}

/** 一份证据可以授权单步 exec 或整份 plan，但必须逐 effect 通过。 */
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

  for (const effect of input.effects) {
    if (hasStructuredAuthorization(effect, authorization.sourceMessageId, input.conversation)) {
      continue;
    }
    if (!actionTerms(effect).some((term) => mentionsTerm(authorization.quote, term))) {
      return {
        ok: false,
        code: 'action-not-authorized',
        reason: `用户原话未点名 action ${effect.action} 或其合同 title`,
      };
    }
    if (!targetTerms(effect).some((term) => mentionsTerm(authorization.quote, term))) {
      return {
        ok: false,
        code: 'target-not-authorized',
        reason: `用户原话未点名 effect 目标 ${effect.rel}`,
      };
    }
  }

  return { ok: true };
}
