// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { ACTION_CONTRACT_LEGEND, ActionGroup } from './action-group';
import type { ActionSubmit } from './action-submit';

function entityOf(classes: string[], blocked = false): SirenEntity {
  return {
    class: classes,
    properties: { rel: 'item:one', fields: { reason: 'already supplied' } },
    actions: [
      {
        name: 'complete',
        title: '完成',
        method: 'POST',
        href: '/api/exec',
        fields: { type: 'object', properties: {} },
      },
      {
        name: 'revise',
        title: '修订',
        method: 'POST',
        href: '/api/exec',
        fields: {
          type: 'object',
          properties: { reason: { type: 'string', title: '原因' } },
          required: ['reason'],
        },
      },
    ],
    links: [],
    'guard-results': [
      {
        action: 'complete',
        blocked,
        ...(blocked ? { reason: 'guard 不满足: item-ready=false' } : {}),
        guards: blocked ? [{ name: 'item-ready', pass: false }] : [],
      },
      { action: 'revise', blocked: false, guards: [] },
    ],
  };
}

function acceptedSubmit(): ActionSubmit {
  return vi.fn(async ({ rel }) => ({
    ok: true as const,
    entity: { ...entityOf(['result']), properties: { rel } },
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('contract-driven ActionGroup', () => {
  it.each([[['flow-instance']], [['work-thread', 'open']]])(
    'renders every declared action without branching on class %j',
    (classes) => {
      const submit = acceptedSubmit();
      const { container } = render(<ActionGroup entity={entityOf(classes)} submit={submit} />);

      expect(screen.getByText(ACTION_CONTRACT_LEGEND).textContent).toBe(
        '你和助手使用同一合同，由同一规则裁决',
      );
      expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '修订' })).toBeTruthy();
      expect(container.querySelectorAll('[data-action-group-item]')).toHaveLength(2);
    },
  );

  it('submits the exact declaration through the explicit adapter', async () => {
    const submit = acceptedSubmit();
    const entity = entityOf(['opaque']);
    render(<ActionGroup entity={entity} submit={submit} />);

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith({
      rel: 'item:one',
      action: entity.actions[0],
      params: undefined,
    });
  });

  it('shows a blocked contract reason as status while preserving human-only approval', () => {
    const submit = acceptedSubmit();
    const blocked = entityOf(['opaque'], true);
    const view = render(<ActionGroup entity={blocked} submit={submit} />);

    expect((screen.getByRole('button', { name: '完成' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('guard 不满足: item-ready=false');

    const approval = entityOf(['confirmation', 'pending'], false);
    approval.actions = [{ ...approval.actions[0]!, name: 'approve', title: '批准' }];
    approval['guard-results'] = [
      {
        action: 'approve',
        blocked: true,
        reason: 'guard 不满足: actor-is-human=false',
        guards: [{ name: 'actor-is-human', pass: false }],
      },
    ];
    view.rerender(<ActionGroup entity={approval} submit={submit} />);
    expect((screen.getByRole('button', { name: '批准' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText(/actor-is-human=false/)).toBeNull();
  });
});
