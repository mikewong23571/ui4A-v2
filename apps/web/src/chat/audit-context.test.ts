import { describe, expect, it } from 'vitest';

import type { LogEvent } from '@ui4a/engine';

import { executionAuditContext } from './audit-context';

function executed(seq: number, principal: string, rel: string): LogEvent {
  return {
    seq,
    kind: 'action-executed',
    rel,
    action: 'archive',
    actor: 'agent',
    principal,
    channel: 'chat',
    detail: {
      execution: {
        declaration: { passed: true },
        guards: [],
        schema: { passed: true },
        confirmation: { required: false, status: 'not-required' },
      },
    },
  };
}

describe('bounded execution audit context', () => {
  it('只披露当前 principal 的最近执行，且保留缺授权错误供 Assistant 如实说明', () => {
    const context = executionAuditContext(
      [
        executed(1, 'user:other', 'post:secret'),
        executed(2, 'user:s1', 'post:first'),
        executed(3, 'user:s1', 'post:second'),
      ],
      'user:s1',
      1,
    );

    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({
      rel: 'post:second',
      integrity: 'authorization-error',
      authorization: null,
    });
    expect(JSON.stringify(context)).not.toContain('post:secret');
  });
});
