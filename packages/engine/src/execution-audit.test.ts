import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';

import { executeWithGates } from './execute';
import { flowRegistry, postStatusFlow, seedSnapshot } from './fixtures';
import { projectAuditProvenance, projectExecutionAudit } from './execution-audit';
import type { LogEvent } from './fold';

const authorization = {
  sourceMessageId: 'turn-archive',
  quote: '把第一篇文章归档',
};

const userMessage: LogEvent = {
  seq: 1,
  kind: 'chat-message-appended',
  rel: 'chat:s1',
  actor: 'human',
  principal: 'user:s1',
  detail: {
    sessionId: 's1',
    turnId: 'turn-archive',
    messageId: 'turn-archive',
    role: 'user',
    content: '请把第一篇文章归档',
    provenance: { kind: 'user-input' },
  },
};

describe('execution audit evidence', () => {
  it('裁决通过事件保留授权、guard/schema 与确认策略，不依赖 LLM 解释', () => {
    const outcome = executeWithGates(
      {
        rel: 'post:post-welcome',
        action: 'unpublish',
        actor: 'agent',
        principal: 'user:s1',
        channel: 'chat',
        authorization,
      },
      seedSnapshot,
      { flows: flowRegistry(postStatusFlow), guards: seedGuardRegistry },
    );

    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.events[0]).toMatchObject({
      kind: 'action-executed',
      detail: {
        execution: {
          authorization,
          declaration: { passed: true },
          guards: [],
          schema: { passed: true },
          confirmation: { required: false },
        },
      },
    });
  });

  it('挂起事件保留同一裁决链，投影在批准后串起请求、human decision 与执行事件', () => {
    const suspended = executeWithGates(
      {
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        principal: 'user:s1',
        channel: 'chat',
        authorization,
      },
      seedSnapshot,
      { flows: flowRegistry(postStatusFlow), guards: seedGuardRegistry },
    );
    expect(suspended.kind).toBe('suspended');
    if (suspended.kind !== 'suspended') return;

    const requested = suspended.events[0]!;
    expect(requested.detail).toMatchObject({
      request: { authorization },
      execution: {
        authorization,
        declaration: { passed: true },
        guards: [],
        schema: { passed: true },
        confirmation: { required: true, status: 'pending' },
      },
    });

    const log: LogEvent[] = [
      userMessage,
      { seq: 2, ...requested },
      {
        seq: 3,
        kind: 'confirmation-approved',
        rel: 'confirmation:c1',
        action: 'approve',
        actor: 'human',
        principal: 'user:reviewer',
        detail: {
          id: 'c1',
          proposedBy: { actor: 'agent', principal: 'user:s1' },
          decidedBy: { actor: 'human', principal: 'user:reviewer' },
        },
      },
      {
        seq: 4,
        kind: 'action-executed',
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'human',
        principal: 'user:s1',
        channel: 'confirmation',
      },
    ];

    expect(projectExecutionAudit(log)).toEqual([
      expect.objectContaining({
        rel: 'post:post-welcome',
        action: 'archive',
        authorization: {
          ...authorization,
          status: 'verified',
          userContent: '请把第一篇文章归档',
        },
        confirmation: expect.objectContaining({
          status: 'approved',
          requestedEventSeq: 2,
          decisionEventSeq: 3,
          executedEventSeq: 4,
          decidedBy: { actor: 'human', principal: 'user:reviewer' },
        }),
        eventSeqs: [2, 3, 4],
        integrity: 'complete',
      }),
    ]);
  });

  it('执行缺少或伪造授权时不会反向编造理由，明确标记审计错误', () => {
    const events: LogEvent[] = [
      userMessage,
      {
        seq: 2,
        kind: 'action-executed',
        rel: 'post:post-welcome',
        action: 'unpublish',
        actor: 'agent',
        channel: 'chat',
        detail: {
          execution: {
            authorization: { sourceMessageId: 'missing', quote: '下线' },
            declaration: { passed: true },
            guards: [],
            schema: { passed: true },
            confirmation: { required: false, status: 'not-required' },
          },
        },
      },
      {
        seq: 3,
        kind: 'action-executed',
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        channel: 'chat',
        detail: {
          execution: {
            declaration: { passed: true },
            guards: [],
            schema: { passed: true },
            confirmation: { required: false, status: 'not-required' },
          },
        },
      },
    ];

    expect(
      projectExecutionAudit(events).map((record) => record.authorization?.status ?? 'missing'),
    ).toEqual(['invalid-reference', 'missing']);
    expect(projectExecutionAudit(events).map((record) => record.integrity)).toEqual([
      'authorization-error',
      'authorization-error',
    ]);
  });
});

describe('U21 provenance projection', () => {
  it('重放投影区分原话、解析意图、合同事实、LLM 推导、artifact、action 与 human decision', () => {
    const events: LogEvent[] = [
      userMessage,
      {
        seq: 2,
        kind: 'chat-context-updated',
        rel: 'chat:s1',
        actor: 'agent',
        detail: {
          sessionId: 's1',
          basedOnSeq: 1,
          provenance: { kind: 'llm-interpretation', sourceMessageIds: ['turn-archive'] },
          patch: { activeGoal: { verb: '归档', targetRel: 'post:post-welcome' } },
        },
      },
      {
        seq: 3,
        kind: 'chat-message-appended',
        rel: 'chat:s1',
        actor: 'agent',
        detail: {
          sessionId: 's1',
          turnId: 'turn-answer',
          messageId: 'turn-answer:assistant',
          role: 'assistant',
          content: '这篇文章介绍了事件溯源。',
          provenance: { kind: 'assistant-output', model: 'fixture-model' },
          citations: [{ rel: 'post:post-welcome', pointer: '/properties/fields/body' }],
        },
      },
      {
        seq: 4,
        kind: 'capability-artifact-created',
        rel: 'artifact:a1',
        actor: 'agent',
        detail: {
          id: 'a1',
          capability: 'summarize',
          source: { rel: 'post:post-welcome', field: 'body' },
          model: 'fixture-model',
          outputSchema: { type: 'object' },
          content: { summary: '正式摘要' },
          contentHash: 'sha256:a1',
          createdBy: { actor: 'agent' },
        },
      },
      {
        seq: 5,
        kind: 'action-executed',
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        detail: { execution: { authorization } },
      },
      {
        seq: 6,
        kind: 'confirmation-approved',
        rel: 'confirmation:c1',
        action: 'approve',
        actor: 'human',
        detail: {
          id: 'c1',
          proposedBy: { actor: 'agent' },
          decidedBy: { actor: 'human', principal: 'user:reviewer' },
        },
      },
    ];

    const forward = projectAuditProvenance(events);
    const replayed = projectAuditProvenance([...events].reverse());
    expect(replayed).toEqual(forward);
    expect(forward.map((record) => record.kind)).toEqual([
      'user-statement',
      'parsed-intent',
      'llm-inference',
      'contract-fact-reference',
      'capability-artifact',
      'action-effect',
      'human-decision',
    ]);
    expect(forward.find((record) => record.kind === 'llm-inference')).not.toEqual(
      expect.objectContaining({ kind: 'contract-fact-reference' }),
    );
  });
});
