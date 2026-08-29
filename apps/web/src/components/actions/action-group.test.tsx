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
      // D50:带参数动作(修订)默认收起为一行触发键
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

describe('ActionGroup compact density (member-table 行内动作)', () => {
  function dangerEntity(): SirenEntity {
    const entity = entityOf(['opaque']);
    entity.actions = [
      ...entity.actions,
      {
        name: 'purge',
        title: '销毁',
        method: 'POST',
        href: '/api/exec',
        'requires-confirmation': 'high',
        fields: { type: 'object', properties: {} },
      },
    ];
    entity['guard-results'] = [
      ...entity['guard-results']!,
      { action: 'purge', blocked: false, guards: [] },
    ];
    return entity;
  }

  it('compact:不渲染图例、动作条目不再套边框盒子,钩子与危险组容器保留', () => {
    const submit = acceptedSubmit();
    const { container } = render(
      <ActionGroup entity={dangerEntity()} submit={submit} density="compact" />,
    );

    // 图例保留在详情面:compact 模式零图例。
    expect(screen.queryByText(ACTION_CONTRACT_LEGEND)).toBeNull();
    expect(screen.queryByTestId('action-contract-legend')).toBeNull();

    // 钩子零变化:每个动作条目仍带 data-action-group-item。
    expect(container.querySelectorAll('[data-action-group-item]')).toHaveLength(3);

    // 行内排列:条目容器是 flex flex-wrap gap-2,条目无 rounded-md border 盒子。
    const items = [...container.querySelectorAll('[data-action-group-item]')];
    for (const item of items) {
      expect(item.className).not.toContain('border');
      expect(item.className).not.toContain('rounded-md');
      expect(item.className).not.toContain('p-3');
    }

    // 危险组容器与危险 tone 零变化。
    expect(screen.getByTestId('action-danger-group')).toBeTruthy();
    const purge = screen.getByRole('button', { name: '销毁' }) as HTMLButtonElement;
    expect(purge.className).toContain('text-destructive');
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
  });

  it('compact:仍走显式适配器提交,guard disabled 投影零变化', async () => {
    const submit = acceptedSubmit();
    const blocked = entityOf(['opaque'], true);
    render(<ActionGroup entity={blocked} submit={submit} density="compact" />);

    expect((screen.getByRole('button', { name: '完成' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('guard 不满足: item-ready=false');
  });

  it('default:图例保留,条目扁平(零边框盒子;危险分隔与 tone 语义不变)', () => {
    const submit = acceptedSubmit();
    const { container } = render(<ActionGroup entity={dangerEntity()} submit={submit} />);

    expect(screen.getByText(ACTION_CONTRACT_LEGEND)).toBeTruthy();
    const items = [...container.querySelectorAll('[data-action-group-item]')];
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.className).not.toContain('border');
    const danger = screen.getByTestId('action-danger-group');
    expect(danger.className).toContain('border-t');
    expect(screen.getByRole('button', { name: '销毁' }).className).toContain('destructive');
  });
});
