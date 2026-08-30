import { describe, expect, it, vi } from 'vitest';

import type { SirenAction } from '@ui4a/engine';

import { buildToolProjection } from './tools';
import { runAgent } from '../loop/loop';
import { ScriptedDriver } from '../loop/loop-test-fixtures';
import { instanceEntity, jsonResponse } from '../testkit/testkit';

const action: SirenAction = {
  name: 'revise',
  title: 'Revise',
  method: 'POST',
  href: '/api/exec',
  fields: {
    type: 'object',
    properties: {
      payload: { type: 'string' },
      commandId: {
        type: 'string',
        minLength: 1,
        'x-ui4a-input-owner': 'client',
      },
      baseVersion: {
        type: 'integer',
        minimum: 1,
        'x-ui4a-input-owner': 'client',
      },
    },
    required: ['payload', 'commandId', 'baseVersion'],
    additionalProperties: false,
  },
};

const draft = {
  ...instanceEntity({
    rel: 'draft:d1',
    flow: 'draft-review',
    node: 'candidate',
    fields: { payload: '{}' },
    actions: [action],
  }),
  properties: {
    rel: 'draft:d1',
    flow: 'draft-review',
    node: 'candidate',
    version: 7,
    fields: { payload: '{}' },
  },
};

describe('D54 Agent action input ownership', () => {
  it('does not expose commandId/baseVersion client fields in the LLM action tool', () => {
    const tool = buildToolProjection(draft).find(({ name }) => name === 'action_revise')!;
    const schema = tool.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(Object.keys(schema.properties)).toEqual(['payload', 'authorization']);
    expect(schema.required).toEqual(['payload', 'authorization']);
    expect(JSON.stringify(schema)).not.toMatch(/commandId|baseVersion/);
  });

  it('injects client fields before exec and reuses one commandId across a transport retry', async () => {
    const posts: Record<string, unknown>[] = [];
    let attempts = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/.well-known/ui4a.json') {
        return jsonResponse({ version: 'v1', surfaces: [], applications: [], flows: [] });
      }
      if (url.pathname === '/api/entity') return jsonResponse(draft);
      if (url.pathname === '/api/exec' && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        attempts += 1;
        if (attempts === 1) throw new Error('transient connection reset');
        return jsonResponse({ entity: draft });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'revise', params: { payload: '{}' } },
      { kind: 'done', summary: 'done' },
    ]);

    const result = await runAgent(
      driver,
      { verb: 'revise draft' },
      {
        baseUrl: 'http://ui4a.test',
        fetchImpl,
        startRel: 'draft:d1',
      },
    );

    expect(result.outcome).toBe('done');
    expect(posts).toHaveLength(2);
    const params = posts.map((post) => post.params as Record<string, unknown>);
    expect(params[0]).toMatchObject({ payload: '{}', baseVersion: 7 });
    expect(params[0]?.commandId).toEqual(expect.any(String));
    expect(params[1]).toEqual(params[0]);
  });
});
