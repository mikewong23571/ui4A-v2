// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from './action-runner';
import { createDirectActionSubmit, type ExecFn } from './actions/action-submit';

/** 表单内提交按钮按结构定位(铁律 3 的 data-action 挂点);触发键与提交键同名。 */
function submitButton(action: string): HTMLElement {
  const button = document.querySelector(`button[data-action="${action}"]`);
  if (!(button instanceof HTMLElement)) throw new Error(`missing submit button: ${action}`);
  return button;
}

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
  it('renders collapsed by default and keeps the opened form accessible (cancel, reopen, Escape, focus return)', async () => {
    const execFn = acceptedExec();
    render(
      <ActionRunner
        rel="post:first-post"
        action={editAction}
        submit={createDirectActionSubmit(execFn, { clientParams: () => ({}) })}
      />,
    );

    // D50:参数表单单一默认收起;打开是零业务事件的 presentation interaction。
    const trigger = screen.getByRole('button', { name: '编辑元数据' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText(/文章标题/)).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // 触发键即开关:展开后再点同一键收起(focus 归还),再点重新展开。
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText(/文章标题/)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
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
        submit={createDirectActionSubmit(execFn, { clientParams: () => ({}) })}
        prefill={{ title: '第一篇', category: 'essay', injected: 'must-not-submit' }}
      />,
    );

    const trigger = screen.getByRole('button', { name: '编辑元数据' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(execFn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    // 表单内提交按钮按结构定位(data-action 挂点);触发键与提交键同名。
    const submit = await waitFor(() => submitButton('edit-metadata'));
    fireEvent.click(submit);

    await waitFor(() => expect(execFn).toHaveBeenCalledTimes(1));
    expect(execFn).toHaveBeenCalledWith({
      rel: 'post:first-post',
      action: 'edit-metadata',
      params: { title: '第一篇', category: 'essay' },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('schema-invalid');
    expect(screen.getByRole('alert').textContent).toContain('/category');
  });

  it('derives a JSON textarea for any unconstrained caller field and submits parsed JSON', async () => {
    const execFn = acceptedExec();
    const futureAction: SirenAction = {
      name: 'apply-extension',
      title: 'Apply extension',
      method: 'POST',
      href: '/api/exec',
      fields: {
        type: 'object',
        additionalProperties: false,
        required: ['extension'],
        properties: {
          extension: {},
          note: { type: 'string' },
        },
      },
    };
    render(
      <ActionRunner
        rel="future:f1"
        action={futureAction}
        submit={createDirectActionSubmit(execFn, { clientParams: () => ({}) })}
        prefill={{ extension: { mode: 'preview', values: [1, 2] }, note: 'keep' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply extension' }));
    const json = (await screen.findByLabelText(/extension/)) as HTMLTextAreaElement;
    expect(json.tagName).toBe('TEXTAREA');
    expect(JSON.parse(json.value)).toEqual({ mode: 'preview', values: [1, 2] });

    fireEvent.change(json, { target: { value: '{' } });
    fireEvent.click(submitButton('apply-extension'));
    expect((await screen.findByRole('alert')).textContent).toContain('合法 JSON');
    expect(execFn).not.toHaveBeenCalled();
    expect(json.value).toBe('{');

    fireEvent.change(json, { target: { value: '[{"kind":"future"}]' } });
    fireEvent.click(submitButton('apply-extension'));

    await waitFor(() => expect(execFn).toHaveBeenCalledTimes(1));
    expect(execFn).toHaveBeenCalledWith({
      rel: 'future:f1',
      action: 'apply-extension',
      params: { extension: [{ kind: 'future' }], note: 'keep' },
    });
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
        submit={createDirectActionSubmit(execFn, { clientParams: () => ({}) })}
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
    expect(trigger.hasAttribute('disabled')).toBe(true);
    fireEvent.click(trigger);
    expect(execFn).toHaveBeenCalledTimes(1);
  });

  it('canceling a high-risk request is event-free and an unannotated future action executes once', async () => {
    const execFn = acceptedExec();
    const { rerender } = render(
      <ActionRunner
        rel="post:first-post"
        action={archiveAction}
        submit={createDirectActionSubmit(execFn, { clientParams: () => ({}) })}
      />,
    );

    const trigger = screen.getByRole('button', { name: '归档' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '取消请求' }));
    expect(execFn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    const unannotatedAction: SirenAction = {
      ...archiveAction,
      name: 'future-human-decision',
      title: '记录未来决定',
      'requires-confirmation': undefined,
    };
    rerender(
      <ActionRunner
        rel="confirmation:c1"
        action={unannotatedAction}
        submit={createDirectActionSubmit(execFn, { clientParams: () => ({}) })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '记录未来决定' }));

    await waitFor(() => expect(execFn).toHaveBeenCalledTimes(1));
    expect(execFn).toHaveBeenCalledWith({
      rel: 'confirmation:c1',
      action: 'future-human-decision',
      params: undefined,
    });
  });
});
