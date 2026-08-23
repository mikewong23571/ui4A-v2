import { describe, expect, it } from 'vitest';

import type { AgentExecutionNeedsInput, AgentExecutionWaitingApproval } from './contracts';
import {
  matchQuestionAnswer,
  matchResourceDecision,
  resolutionIdempotencyKey,
  suspensionIdempotencyKey,
} from './protocol';

const question = {
  status: 'needs-input',
  question: { questionId: 'question:1', prompt: 'Which audience?' },
  checkpoint: { schemaVersion: 1, runId: 'run:1', cursor: 'one', state: null },
} satisfies AgentExecutionNeedsInput;

const request = {
  status: 'waiting-approval',
  request: {
    requestId: 'request:1',
    resource: { kind: 'network', operations: ['read'] },
    reason: 'Read a declared source',
  },
  checkpoint: { schemaVersion: 1, runId: 'run:1', cursor: 'two', state: null },
} satisfies AgentExecutionWaitingApproval;

describe('Agent Host suspension protocol', () => {
  it('matches only the answer for the current question', () => {
    const answers = {
      'question:other': {
        questionId: 'question:other',
        answer: 'other',
        answeredBy: 'user:test',
      },
      'question:1': { questionId: 'question:1', answer: 'developers', answeredBy: 'user:test' },
    };
    expect(matchQuestionAnswer(question, answers)).toEqual({
      kind: 'question-answer',
      questionId: 'question:1',
      answer: 'developers',
      answeredBy: 'user:test',
    });
  });

  it('matches only the decision for the current resource request', () => {
    const decisions = {
      'request:1': {
        requestId: 'request:1',
        decision: { outcome: 'denied', decidedBy: 'user:test', reason: 'out of scope' },
      },
    } as const;
    expect(matchResourceDecision(request, decisions)).toEqual({
      kind: 'resource-decision',
      ...decisions['request:1'],
    });
  });

  it('builds stable per-request idempotency keys', () => {
    expect(suspensionIdempotencyKey('run:1', question)).toBe(
      'agent-run-suspend:run:1:question:question:1',
    );
    expect(resolutionIdempotencyKey('run:1', request)).toBe(
      'agent-run-resolve:run:1:resource:request:1',
    );
  });
});
