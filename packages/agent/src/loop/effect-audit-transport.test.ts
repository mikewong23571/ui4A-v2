import { describe, expect, it } from 'vitest';

import { runAgent } from './loop';
import { instanceEntity } from '../testkit/testkit';
import type { AgentDriver, AgentOperation, FetchLike } from '../types';

const authorization = { sourceMessageId: 'm1', quote: '下线第一篇' };

class ScriptedDriver implements AgentDriver {
  constructor(private readonly operations: AgentOperation[]) {}

  decide(): AgentOperation {
    return this.operations.shift() ?? { kind: 'fail', reason: '脚本耗尽' };
  }
}

describe('effect authorization audit transport', () => {
  it('机械授权通过后把同一证据传给 exec HTTP，而不是只在内存 gate 中丢弃', async () => {
    const bodies: unknown[] = [];
    const entity = instanceEntity({
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
      ],
    });
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/.well-known/ui4a.json')) {
        return Response.json({ version: 'v1', surfaces: [], applications: [] });
      }
      if (url.includes('/api/entity')) return Response.json(entity);
      if (url.endsWith('/api/exec')) {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          entity: { ...entity, properties: { ...entity.properties, node: 'offline' } },
        });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    };

    await runAgent(
      new ScriptedDriver([
        { kind: 'exec', action: 'unpublish', authorization },
        { kind: 'done', summary: '已下线' },
      ]),
      { verb: '下线第一篇', targetRel: 'post:first-post' },
      {
        baseUrl: 'http://fixture',
        fetchImpl,
        startRel: 'post:first-post',
        requireEffectAuthorization: true,
        conversationMessages: [{ messageId: 'm1', role: 'user', content: '请下线第一篇' }],
      },
    );

    expect(bodies).toEqual([
      expect.objectContaining({ rel: 'post:first-post', action: 'unpublish', authorization }),
    ]);
  });
});
