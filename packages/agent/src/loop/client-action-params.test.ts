import { describe, expect, it } from 'vitest';
import type { SirenAction, SirenEntity } from '@ui4a/engine';
import { createClientActionParams } from './client-action-params';

const action: SirenAction = {
  name: 'revise',
  title: 'Revise',
  method: 'POST',
  href: '/api/exec',
  fields: {
    type: 'object',
    properties: {
      payload: { type: 'object' },
      commandId: { type: 'string', 'x-ui4a-input-owner': 'client' },
      baseVersion: { type: 'integer', 'x-ui4a-input-owner': 'client' },
    },
  },
};
const entity: SirenEntity = {
  class: ['draft'],
  properties: { rel: 'draft:d1', version: 7 },
  actions: [action],
  links: [],
};
const authorization = { sourceMessageId: 'm1', quote: '修订' };

describe('run-owned client parameters', () => {
  it('canonicalizes nested input order, ignores forged host values, and keeps the original CAS envelope', () => {
    const params = createClientActionParams();
    const first = params(action, entity, { payload: { a: 1, b: [2, 3] } }, authorization);
    const repeated = params(
      action,
      { ...entity, properties: { rel: 'draft:d1', version: 8 } },
      {
        baseVersion: 999,
        commandId: 'forged',
        payload: { b: [2, 3], a: 1 },
      },
      authorization,
    );
    expect(repeated).toEqual(first);
    expect(repeated.baseVersion).toBe(7);
    first.commandId = 'mutated';
    expect(params(action, entity, { payload: { a: 1, b: [2, 3] } }, authorization)).toEqual(
      repeated,
    );
    expect(
      params(action, entity, { payload: { a: 1, b: [3, 2] } }, authorization).commandId,
    ).not.toBe(repeated.commandId);
  });

  it('separates action and target identity and leaves actions without commandId on fresh observations', () => {
    const params = createClientActionParams();
    const input = { payload: {} };
    const ids = [
      params(action, entity, input, authorization).commandId,
      params({ ...action, name: 'submit' }, entity, input, authorization).commandId,
      params(
        action,
        { ...entity, properties: { rel: 'draft:d2', version: 7 } },
        input,
        authorization,
      ).commandId,
    ];
    expect(new Set(ids).size).toBe(3);
    const noCommand = {
      ...action,
      fields: {
        properties: { baseVersion: { type: 'integer', 'x-ui4a-input-owner': 'client' } },
      },
    };
    expect(params(noCommand, entity, input)).toEqual({ ...input, baseVersion: 7 });
    expect(params(noCommand, { ...entity, properties: { version: 8 } }, input)).toEqual({
      ...input,
      baseVersion: 8,
    });
  });
});
