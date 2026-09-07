// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ActionGroup } from './action-group';
import type { ActionSubmit } from './action-submit';
import { EntityCacheProvider } from '../entity-cache-provider';

it('does not offer unlink when the authorized choice list is empty', () => {
  const entity = entityOf([]);
  entity.actions = [
    {
      name: 'detach',
      title: '移出',
      method: 'POST',
      href: '/api/exec',
      fields: { 'x-ui4a-reference-selection': { effect: 'unlink', options: [] } },
    },
  ];
  render(<ActionGroup entity={entity} submit={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '移出' })).toBeNull();
});

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

      // T60 UX 评审:「操作规则」图例已删除——动作区不承载架构口号。
      expect(screen.queryByText('操作规则')).toBeNull();
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

  it('compact:不渲染图例、动作条目不再套边框盒子,钩子与确认组容器保留', () => {
    const submit = acceptedSubmit();
    const { container } = render(
      <ActionGroup entity={dangerEntity()} submit={submit} density="compact" />,
    );

    // 图例已删除:compact 模式与详情面一样零图例。
    expect(screen.queryByText('操作规则')).toBeNull();
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

    // 确认组可辨,不因 high 宣称危险或不可逆。
    expect(screen.getByTestId('action-confirmation-group')).toBeTruthy();
    const purge = screen.getByRole('button', { name: '销毁' }) as HTMLButtonElement;
    expect(purge.className).not.toContain('text-destructive');
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
  });

  it('compact:仍走显式适配器提交,guard disabled 投影零变化', async () => {
    const submit = acceptedSubmit();
    const blocked = entityOf(['opaque'], true);
    render(<ActionGroup entity={blocked} submit={submit} density="compact" />);

    expect((screen.getByRole('button', { name: '完成' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('guard 不满足: item-ready=false');
  });

  it('default:零图例,条目扁平(零边框盒子;确认分组不宣称危险)', () => {
    const submit = acceptedSubmit();
    const { container } = render(<ActionGroup entity={dangerEntity()} submit={submit} />);

    expect(screen.queryByText('操作规则')).toBeNull();
    const items = [...container.querySelectorAll('[data-action-group-item]')];
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.className).not.toContain('border');
    const danger = screen.getByTestId('action-confirmation-group');
    expect(danger.className).toContain('border-t');
    expect(screen.getByRole('button', { name: '销毁' }).className).not.toContain(
      'text-destructive',
    );
  });
});

it('allows a second edit after the host supplies the updated entity fields', async () => {
  const original = entityOf(['opaque']);
  const submit = acceptedSubmit();
  const view = render(<ActionGroup entity={original} submit={submit} />);
  fireEvent.click(screen.getByRole('button', { name: '修订' }));
  fireEvent.change(screen.getByRole('textbox', { name: /原因/ }), { target: { value: 'updated' } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已执行'));
  const updated = {
    ...original,
    properties: { ...original.properties, fields: { reason: 'updated' } },
  };
  view.rerender(<ActionGroup entity={updated} submit={submit} />);
  expect((screen.getByRole('button', { name: '修订' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '修订' }));
  expect((screen.getByRole('textbox', { name: /原因/ }) as HTMLInputElement).value).toBe('updated');
});

describe('G07 材料入口收敛(线 attach 动作 → 选择器主路径)', () => {
  const referenceFields: SirenAction['fields'] = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['context', 'active', 'approval', 'event'], title: '类别' },
      rel: { type: 'string', title: '关联对象', minLength: 1 },
    },
    required: ['category', 'rel'],
    additionalProperties: false,
  };

  function threadEntity(action: SirenAction, rel = 'thread:t1'): SirenEntity {
    return {
      class: ['work-thread', 'open'],
      properties: { rel, identity: '完成跨应用评审闭环', context: [] },
      actions: [action],
      links: [],
      'guard-results': [{ action: action.name, blocked: false, guards: [] }],
    };
  }

  function renderGroup(entity: SirenEntity, submit: ActionSubmit) {
    return render(
      <EntityCacheProvider
        fetcher={async (rel) => (rel === entity.properties.rel ? entity : null)}
        versionFetcher={async () => 'v-test'}
      >
        <ActionGroup entity={entity} submit={submit} />
      </EntityCacheProvider>,
    );
  }

  it('线上的合同 attach 动作呈现选择器主路径(无裸 rel 表单直出)', () => {
    const submit = acceptedSubmit();
    const { container } = renderGroup(
      threadEntity({
        name: 'attach',
        title: '添加关联',
        method: 'POST',
        href: '/api/exec',
        fields: referenceFields,
      }),
      submit,
    );
    expect(screen.getByTestId('thread-add-material')).toBeTruthy();
    // T60 UX 评审:线实体上的 attach/detach 入「关联」关系组,先行披露。
    expect(screen.getByTestId('action-reference-group')).toBeTruthy();
    // 裸 rel 输入不出现在主路径(仅为高级回退)。
    expect(screen.queryByLabelText(/关联对象/)).toBeNull();
    expect(container.querySelector('[data-action-group-item="attach"]')).not.toBeNull();
  });

  it('线上非 attach 动作与其余实体的 attach 同名动作保持通用表单零变化', () => {
    const submit = acceptedSubmit();
    // 线上的 detach:移出语义仍是通用表单(书桌外不引入选择器)。
    renderGroup(
      threadEntity({
        name: 'detach',
        title: '移出关联',
        method: 'POST',
        href: '/api/exec',
        fields: referenceFields,
      }),
      submit,
    );
    expect(screen.queryByTestId('thread-add-material')).toBeNull();
    expect(screen.getByRole('button', { name: '移出关联' })).toBeTruthy();
    cleanup();
    // 非线实体的同名 attach 动作:通用表单(识别键 = 线 rel,零误伤)。
    const todo: SirenEntity = {
      class: ['flow-instance', 'todo-item'],
      properties: { rel: 'todo:x' },
      actions: [
        {
          name: 'attach',
          title: '添加关联',
          method: 'POST',
          href: '/api/exec',
          fields: referenceFields,
        },
      ],
      links: [],
      'guard-results': [{ action: 'attach', blocked: false, guards: [] }],
    };
    renderGroup(todo, submit);
    expect(screen.queryByTestId('thread-add-material')).toBeNull();
    expect(screen.queryByTestId('action-reference-group')).toBeNull();
    expect(screen.getByRole('button', { name: '添加关联' })).toBeTruthy();
  });
});

it('discloses every unknown and blocked action without implying a current responsibility', () => {
  const submit = acceptedSubmit();
  render(
    <ActionGroup entity={entityOf(['future-domain'], true)} submit={submit} posture="disclosure" />,
  );
  const trigger = screen.getByRole('button', { name: '更多操作' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: '完成' }).getAttribute('disabled')).not.toBeNull();
  expect(screen.getByRole('status').textContent).toContain('item-ready');
  expect(screen.getByRole('button', { name: '修订' })).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '修订' }));
  fireEvent.change(screen.getByRole('textbox', { name: /原因/ }), {
    target: { value: 'keep this draft' },
  });
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect((screen.getByRole('textbox', { name: /原因/ }) as HTMLInputElement).value).toBe(
    'keep this draft',
  );
  expect(submit).not.toHaveBeenCalled();
});
