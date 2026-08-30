import { describe, expect, it } from 'vitest';

import * as Engine from '../index';

type CallerSchemaProjector = (schema: Record<string, unknown>) => Record<string, unknown>;

function callerActionSchema(): CallerSchemaProjector {
  const candidate = (Engine as Record<string, unknown>).callerActionSchema;
  if (typeof candidate !== 'function') {
    throw new Error('callerActionSchema must be exported by @ui4a/engine');
  }
  return candidate as CallerSchemaProjector;
}

function fullSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    title: 'Revise Draft',
    properties: {
      payload: { type: 'object', title: 'Candidate' },
      reason: { type: 'string' },
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
  };
}

describe('D54 action input ownership contract', () => {
  it('derives one caller schema by removing client properties and their required entries', () => {
    const schema = fullSchema();
    const caller = callerActionSchema()(schema) as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(Object.keys(caller.properties)).toEqual(['payload', 'reason']);
    expect(caller.required).toEqual(['payload']);
    expect(caller).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      title: 'Revise Draft',
      additionalProperties: false,
    });
    expect(schema).toEqual(fullSchema());
  });

  it('treats an absent annotation as caller-owned and permits only the client literal on the wire', () => {
    const project = callerActionSchema();
    expect(
      (
        project({
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
          additionalProperties: false,
        }) as { properties: Record<string, unknown> }
      ).properties,
    ).toHaveProperty('title');

    for (const invalid of ['caller', 'server', 'human', true]) {
      expect(() =>
        project({
          type: 'object',
          properties: {
            forged: { type: 'string', 'x-ui4a-input-owner': invalid },
          },
          additionalProperties: false,
        }),
      ).toThrow(/x-ui4a-input-owner.*client/i);
    }
  });
});
