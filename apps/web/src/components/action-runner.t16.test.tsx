// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ActionRunner, type ExecFn } from './action-runner';

const entity: SirenEntity = {
  class: ['article'],
  properties: { rel: 'post:first-post', node: 'published' },
  actions: [],
  links: [],
};

const editAction: SirenAction = {
  name: 'edit-metadata',
  title: '编辑元数据',
  method: 'POST',
  href: '/api/exec',
  fields: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'category'],
    properties: {
      title: { type: 'string', title: '文章标题', description: '用于列表和搜索。' },
      category: { type: 'string', title: '分类', enum: ['essay', 'review'] },
    },
  },
};

const archiveAction: SirenAction = {
  name: 'archive',
  title: '归档',
  method: 'POST',
  href: '/api/exec',
  fields: { type: 'object', additionalProperties: false, properties: {} },
  'requires-confirmation': 'high',
};

function acceptedExec(): ExecFn {
  return vi.fn(async () => ({ ok: true as const, entity }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ActionRunner T16 schema-form interaction', () => {
  it('keeps the inline form accessible and supports cancel, reopen, Escape, and focus return', async () => {
    const execFn = acceptedExec();
    render(<ActionRunner rel="post:first-post" action={editAction} execFn={execFn} />);

    const trigger = screen.getByRole('button', { name: '填写编辑元数据参数' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText(/文章标题/)).toBeTruthy();
    expect(screen.getByText('用于列表和搜索。')).toBeTruthy();
    expect(screen.getByLabelText(/文章标题/).getAttribute('required')).not.toBeNull();
    const category = screen.getByLabelText(/分类/) as HTMLSelectElement;
    expect([...category.options].map((option) => option.label)).toEqual(
      expect.arrayContaining(['essay', 'review']),
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByLabelText(/文章标题/)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const title = await screen.findByLabelText(/文章标题/);
    expect(document.activeElement).toBe(title);
    fireEvent.keyDown(title, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByLabelText(/文章标题/)).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(execFn).not.toHaveBeenCalled();
  });

  it('Cancel closes without execution, strips extra data, and keeps engine rejection visible', async () => {
    const execFn: ExecFn = vi.fn(async () => ({
      ok: false as const,
      status: 422,
      layer: 'schema-invalid',
      reason: '参数不符合 action schema',
      detail: [{ instancePath: '/category', message: 'must be equal to one of allowed values' }],
    }));
    render(
      <ActionRunner
        rel="post:first-post"
        action={editAction}
        execFn={execFn}
        prefill={{ title: '第一篇', category: 'essay', injected: 'must-not-submit' }}
      />,
    );

    const trigger = screen.getByRole('button', { name: '填写编辑元数据参数' });
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(execFn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: '编辑元数据' }));

    await waitFor(() => expect(execFn).toHaveBeenCalledTimes(1));
    expect(execFn).toHaveBeenCalledWith({
      rel: 'post:first-post',
      action: 'edit-metadata',
      params: { title: '第一篇', category: 'essay' },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('schema-invalid');
    expect(screen.getByRole('alert').textContent).toContain('/category');
  });
});

describe('ActionRunner T16 high-risk staging', () => {
  it('first high-risk request is visibly pending and does not execute until explicit confirmation', async () => {
    const execFn = acceptedExec();
    const onExecuted = vi.fn();
    render(
      <ActionRunner
        rel="post:first-post"
        action={archiveAction}
        execFn={execFn}
        onExecuted={onExecuted}
      />,
    );

    const trigger = screen.getByRole('button', { name: '归档' });
    fireEvent.click(trigger);

    expect(execFn).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('已请求');
    expect(screen.getByRole('status').textContent).toContain('尚未执行');

    fireEvent.click(screen.getByRole('button', { name: '确认并执行归档' }));

    await waitFor(() => expect(execFn).toHaveBeenCalledTimes(1));
    expect(execFn).toHaveBeenCalledWith({
      rel: 'post:first-post',
      action: 'archive',
      params: undefined,
    });
    expect(screen.getByRole('status').textContent).toContain('已执行');
    expect(onExecuted).toHaveBeenCalledWith('post:first-post');
  });

  it('canceling a high-risk request is event-free and approve/reject remain ordinary human actions', async () => {
    const execFn = acceptedExec();
    const { rerender } = render(
      <ActionRunner rel="post:first-post" action={archiveAction} execFn={execFn} />,
    );

    const trigger = screen.getByRole('button', { name: '归档' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '取消请求' }));
    expect(execFn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    const approveAction: SirenAction = {
      ...archiveAction,
      name: 'approve',
      title: '批准',
      'requires-confirmation': undefined,
    };
    rerender(<ActionRunner rel="confirmation:c1" action={approveAction} execFn={execFn} />);
    fireEvent.click(screen.getByRole('button', { name: '批准' }));

    await waitFor(() => expect(execFn).toHaveBeenCalledTimes(1));
    expect(execFn).toHaveBeenCalledWith({
      rel: 'confirmation:c1',
      action: 'approve',
      params: undefined,
    });
  });
});
