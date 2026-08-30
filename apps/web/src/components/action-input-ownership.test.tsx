// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from './action-runner';
import {
  createDirectActionSubmit,
  type ActionSubmit,
  type ActionSubmitInput,
  type ExecFn,
} from './actions/action-submit';

const revise: SirenAction = {
  name: 'revise',
  title: 'Revise',
  method: 'POST',
  href: '/_meta/api/exec',
  fields: {
    type: 'object',
    properties: {
      payload: { type: 'string', title: 'Candidate payload' },
      commandId: {
        type: 'string',
        title: 'Command ID',
        'x-ui4a-input-owner': 'client',
      },
      baseVersion: {
        type: 'integer',
        title: 'Base version',
        'x-ui4a-input-owner': 'client',
      },
    },
    required: ['payload', 'commandId', 'baseVersion'],
    additionalProperties: false,
  },
};

const draft: SirenEntity = {
  class: ['meta', 'draft'],
  properties: { rel: 'draft:d1' },
  actions: [],
  links: [],
};

type DirectSubmitFactory = (
  exec: ExecFn,
  options: {
    clientParams(input: ActionSubmitInput): Record<string, unknown>;
  },
) => ActionSubmit;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('D54 ActionRunner caller/client boundary', () => {
  it('renders only caller-owned fields from the full Siren action schema', async () => {
    render(
      <ActionRunner
        rel="draft:d1"
        action={revise}
        submit={vi.fn(async () => ({ ok: true as const, entity: draft }))}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revise' }));

    expect(await screen.findByLabelText(/Candidate payload/)).toBeTruthy();
    expect(screen.queryByLabelText(/Command ID/)).toBeNull();
    expect(screen.queryByLabelText(/Base version/)).toBeNull();
  });

  it('trusted direct host injects client params, overrides forged values, then validates the full schema', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ ok: true, entity: draft }));
    const createSubmit = createDirectActionSubmit as unknown as DirectSubmitFactory;
    const submit = createSubmit(exec, {
      clientParams: () => ({ commandId: 'command:stable', baseVersion: 7 }),
    });

    await submit({
      rel: 'draft:d1',
      action: revise,
      params: { payload: '{}', commandId: 'forged', baseVersion: 999 },
    });

    expect(exec).toHaveBeenCalledWith({
      rel: 'draft:d1',
      action: 'revise',
      params: { payload: '{}', commandId: 'command:stable', baseVersion: 7 },
    });

    const incomplete = createSubmit(exec, {
      clientParams: () => ({ commandId: 'command:incomplete' }),
    });
    const result = await incomplete({ rel: 'draft:d1', action: revise, params: { payload: '{}' } });
    expect(result).toMatchObject({ ok: false, layer: 'schema-invalid' });
    await waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
  });
});
