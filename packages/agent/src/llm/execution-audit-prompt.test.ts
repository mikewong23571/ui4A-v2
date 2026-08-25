import { describe, expect, it } from 'vitest';

import { buildUserPrompt } from './llm-driver';
import { instanceEntity } from '../testkit/testkit';
import type { DriverContext } from '../types';

describe('execution audit prompt boundary', () => {
  it('事件审计与可修订会话解释分区披露，缺授权保持结构化错误而不补造理由', () => {
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'archived',
    });
    const context: DriverContext = {
      goal: { verb: '解释上一项执行' },
      currentRel: 'post:first-post',
      entity,
      trail: [],
      successes: [],
      conversation: {
        activeGoal: { verb: '解释上一项执行' },
        executionAudit: [
          {
            rel: 'post:first-post',
            action: 'archive',
            actor: 'agent',
            principal: 'user:s1',
            authorization: null,
            judgment: {
              declaration: { passed: true },
              guards: [],
              schema: { passed: true },
            },
            confirmation: { required: false, status: 'not-required' },
            eventSeqs: [9],
            integrity: 'authorization-error',
          },
        ],
      },
    };

    const prompt = buildUserPrompt(context);
    const derivedStart = prompt.indexOf('## 结构化会话处境');
    const auditStart = prompt.indexOf('## 执行审计处境');
    expect(derivedStart).toBeGreaterThanOrEqual(0);
    expect(auditStart).toBeGreaterThan(derivedStart);
    expect(prompt.slice(derivedStart, auditStart)).not.toContain('executionAudit');
    expect(prompt.slice(auditStart)).toContain('authorization-error');
  });
});
