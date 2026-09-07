// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { SirenAction } from '@ui4a/engine';

import { ActionRunner } from '../action-runner';
import { ActionGroup } from './action-group';
import type { ActionSubmit } from './action-submit';

const action: SirenAction = {
  name: 'future-command',
  title: '独立任务',
  method: 'POST',
  href: '/api/exec',
  fields: {
    type: 'object',
    properties: { title: { type: 'string', title: '目标' } },
    required: ['title'],
  },
};

afterEach(cleanup);

it('retains draft and rejection across modal close, traps focus, and restores trigger on Escape', async () => {
  const submit: ActionSubmit = vi.fn(async () => ({
    ok: false as const,
    status: 409,
    layer: 'guard',
    reason: '事实已变更',
  }));
  render(
    <>
      <button>背景</button>
      <ActionRunner action={action} rel="opaque:one" submit={submit} formHost="dialog" />
    </>,
  );
  const trigger = screen.getByRole('button', { name: '独立任务' });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '独立任务' });
  const input = within(dialog).getByRole('textbox', { name: /目标/ });
  fireEvent.change(input, { target: { value: '保留输入' } });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  expect(screen.queryByRole('button', { name: '背景' })).toBeNull();
  fireEvent.submit(dialog.querySelector('form')!);
  await waitFor(() =>
    expect(within(dialog).getByRole('alert').textContent).toContain('事实已变更'),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  const reopened = await screen.findByRole('dialog');
  expect((within(reopened).getByRole('textbox', { name: /目标/ }) as HTMLInputElement).value).toBe(
    '保留输入',
  );
  expect(within(reopened).getByRole('alert').textContent).toContain('事实已变更');
  fireEvent.keyDown(within(reopened).getByRole('textbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(submit).toHaveBeenCalledTimes(1);
});

it('keeps an in-flight modal open and prevents double submit; receipt remains after it completes', async () => {
  let resolve: ((value: Awaited<ReturnType<ActionSubmit>>) => void) | undefined;
  const submit: ActionSubmit = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<ActionSubmit>>>((done) => {
        resolve = done;
      }),
  );
  render(<ActionRunner action={action} rel="opaque:one" submit={submit} formHost="dialog" />);
  fireEvent.click(screen.getByRole('button', { name: '独立任务' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '提交一次' } });
  fireEvent.submit(dialog.querySelector('form')!);
  fireEvent.submit(dialog.querySelector('form')!);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(submit).toHaveBeenCalledTimes(1);
  resolve?.({
    ok: true,
    entity: { class: [], properties: { rel: 'opaque:one' }, actions: [], links: [] },
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status').textContent).toContain('已执行');
  expect(document.activeElement?.contains(screen.getByRole('status'))).toBe(true);
});

it('Escape cancels a fieldless confirmation request inside a disclosure even when the form host is dialog', () => {
  const submit = vi.fn<ActionSubmit>();
  render(
    <ActionGroup
      entity={{
        class: [],
        properties: { rel: 'opaque:one' },
        actions: [
          {
            ...action,
            fields: { type: 'object', properties: {} },
            'requires-confirmation': 'high',
          },
        ],
        links: [],
      }}
      submit={submit}
      posture="disclosure"
      formHost="dialog"
    />,
  );
  const disclosure = screen.getByRole('button', { name: '更多操作' });
  fireEvent.click(disclosure);
  const trigger = screen.getByRole('button', { name: '独立任务' });
  fireEvent.click(trigger);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('尚未发送请求');
  fireEvent.keyDown(screen.getByRole('button', { name: '确认并执行独立任务' }), { key: 'Escape' });
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(screen.getByRole('status').textContent).toContain('尚未发送请求');
  expect(submit).not.toHaveBeenCalled();
});

it.each([0, 200])(
  'keeps an unacknowledged result (%s) distinct from a server rejection and retains its draft',
  async (status) => {
    const submit: ActionSubmit = vi.fn(async () => ({
      ok: false as const,
      status,
      layer: 'exec-refused',
      reason: 'Failed to fetch',
    }));
    const onExecuted = vi.fn();
    render(
      <ActionRunner
        action={action}
        rel="opaque:one"
        submit={submit}
        formHost="dialog"
        onExecuted={onExecuted}
      />,
    );
    const trigger = screen.getByRole('button', { name: '独立任务' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '不要重复创建' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toBe(
        '尚未收到执行回执，结果未确认。输入已保留。',
      ),
    );
    expect(onExecuted).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    fireEvent.click(trigger);
    expect(
      (within(await screen.findByRole('dialog')).getByRole('textbox') as HTMLInputElement).value,
    ).toBe('不要重复创建');
  },
);
