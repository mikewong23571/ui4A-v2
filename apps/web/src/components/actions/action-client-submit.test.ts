import { describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { createSurfaceActionAdapter } from '../../render/presentation/action-adapter';
import {
  createDirectActionSubmit,
  observedActionClientParams,
  type ExecFn,
} from './action-client-submit';

const action: SirenAction = {
  name: 'future-create',
  title: 'Create',
  method: 'POST',
  href: '/api/exec',
  fields: {
    type: 'object',
    additionalProperties: false,
    properties: {
      commandId: { type: 'string', 'x-ui4a-input-owner': 'client' },
      goal: { type: 'string' },
      baseVersion: { type: 'integer', 'x-ui4a-input-owner': 'client' },
    },
    required: ['commandId', 'goal', 'baseVersion'],
  },
};
const entity: SirenEntity = {
  class: [],
  properties: { rel: 'unknown:collection', version: 1 },
  actions: [action],
  links: [],
};

describe('client-owned command retry identity', () => {
  it('reuses an uncertain direct submission key, strips spoofing, rotates on changed input and success', async () => {
    const exec: ExecFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ ok: false, status: 503, layer: 'network', reason: 'retry' })
      .mockResolvedValue({ ok: true, entity });
    const submit = createDirectActionSubmit(exec, {
      clientParams: ({ action }) => observedActionClientParams(action, entity.properties),
    });
    const input = {
      rel: 'unknown:collection',
      action,
      params: { goal: 'do work', commandId: 'spoofed', baseVersion: 900 },
    };
    await expect(submit(input)).rejects.toThrow('lost response');
    await submit({
      ...input,
      params: { baseVersion: 400, commandId: 'another-spoof', goal: 'do work' },
    });
    await submit({ ...input, params: { goal: 'changed' } });
    await submit({ ...input, params: { goal: 'changed' } });
    const calls = vi.mocked(exec).mock.calls.map(([call]) => call.params!);
    expect(calls[0].commandId).not.toBe('spoofed');
    expect(calls[1].commandId).toBe(calls[0].commandId);
    expect(calls[1].baseVersion).toBe(1);
    expect(calls[2].commandId).not.toBe(calls[1].commandId);
    expect(calls[3].commandId).not.toBe(calls[2].commandId);
  });

  it('surface retries reread guards and versions but keep the same logical command key', async () => {
    let current = entity;
    const fetchEntity = vi.fn(async () => current);
    const exec: ExecFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('uncertain'))
      .mockResolvedValue({ ok: true, entity });
    const adapter = createSurfaceActionAdapter({ fetchEntity, exec });
    const input = {
      subject: 'unknown:collection',
      action: action.name,
      params: { goal: 'go', commandId: 'spoofed' },
      expected: { actionSchema: action.fields },
    };
    await expect(adapter.submit(input)).rejects.toThrow('uncertain');
    current = {
      ...entity,
      properties: { ...entity.properties, version: 2 },
      'guard-results': [{ action: action.name, blocked: true, reason: 'blocked', guards: [] }],
    };
    expect(await adapter.submit(input)).toMatchObject({
      outcome: 'refused',
      code: 'guard-blocked',
    });
    expect(exec).toHaveBeenCalledTimes(1);
    current = { ...current, 'guard-results': [] };
    expect(await adapter.submit(input)).toMatchObject({ outcome: 'executed' });
    const calls = vi.mocked(exec).mock.calls.map(([call]) => call.params!);
    expect(calls[1].commandId).toBe(calls[0].commandId);
    expect(calls[1].baseVersion).toBe(2);
    expect(fetchEntity).toHaveBeenCalledTimes(3);
  });

  it('unknown required client ownership fails honestly instead of accepting caller values', async () => {
    const exec = vi.fn();
    const unknown = {
      ...action,
      fields: {
        type: 'object',
        properties: { unknown: { type: 'string', 'x-ui4a-input-owner': 'client' } },
        required: ['unknown'],
      },
    };
    const submit = createDirectActionSubmit(exec, {
      clientParams: ({ action }) => observedActionClientParams(action, {}),
    });
    expect(
      await submit({ rel: 'unknown:collection', action: unknown, params: { unknown: 'spoofed' } }),
    ).toMatchObject({ ok: false, layer: 'schema-invalid' });
    expect(exec).not.toHaveBeenCalled();
  });
});
