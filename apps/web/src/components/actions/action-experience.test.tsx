// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SirenAction, SirenEntity } from '@ui4a/engine';
import { ActionGroup } from './action-group';
import { ActionRunner } from '../action-runner';
import { EntityCacheProvider } from '../entity-cache-provider';
import type { ActionSubmit } from './action-submit';

const action: SirenAction = {
  name: 'future-unlink',
  title: '移出材料',
  method: 'POST',
  href: '/api/exec',
  fields: {
    type: 'object',
    properties: { category: { type: 'string' }, rel: { type: 'string' } },
    'x-ui4a-reference-selection': {
      effect: 'unlink',
      options: [{ title: '季度汇报', params: { category: 'context', rel: 'opaque:material' } }],
    },
  },
};
const entity: SirenEntity = {
  class: ['unknown-domain'],
  properties: { rel: 'opaque:one', identity: '整理审查结论' },
  actions: [action],
  links: [],
};
afterEach(cleanup);

it('selects declared members and rereads the action before submitting exact parameters', async () => {
  const read = vi.fn(async () => entity);
  const submit = vi.fn<ActionSubmit>(async () => ({ ok: true, entity }));
  render(
    <EntityCacheProvider fetcher={read} versionFetcher={async () => 'v'}>
      <ActionGroup entity={entity} submit={submit} />
    </EntityCacheProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '移出材料' }));
  expect(await screen.findByRole('button', { name: '移出 季度汇报' })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('仅移出引用，原对象保留。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '移出 季度汇报' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      rel: 'opaque:one',
      action,
      params: { category: 'context', rel: 'opaque:material' },
    }),
  );
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('does not submit a member withdrawn after opening and offers no manual input for an empty set', async () => {
  const emptyAction = {
    ...action,
    fields: { ...action.fields, 'x-ui4a-reference-selection': { effect: 'unlink', options: [] } },
  };
  const read = vi
    .fn()
    .mockResolvedValueOnce(entity)
    .mockResolvedValue({ ...entity, actions: [emptyAction] });
  const submit = vi.fn<ActionSubmit>();
  render(
    <EntityCacheProvider fetcher={read} versionFetcher={async () => 'v'}>
      <ActionGroup entity={entity} submit={submit} />
    </EntityCacheProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '移出材料' }));
  fireEvent.click(await screen.findByRole('button', { name: '移出 季度汇报' }));
  await screen.findByText('当前没有可移出的引用。');
  expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('names the target and declared effect before confirmation without sending a request', () => {
  const submit = vi.fn<ActionSubmit>();
  const archive = {
    ...action,
    title: '结束事项',
    'requires-confirmation': 'high' as const,
    fields: {
      type: 'object',
      properties: {},
      description: '此事项将关闭，当前合同不提供恢复操作。',
    },
  };
  render(<ActionGroup entity={{ ...entity, actions: [archive] }} submit={submit} />);
  expect(screen.queryByText('需要确认')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '结束事项' }));
  expect(screen.getByText('操作对象：整理审查结论')).toBeTruthy();
  expect(screen.getByText(archive.fields.description)).toBeTruthy();
  expect(screen.getByText('确认后提交执行；尚未发送请求。')).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
});

it('locates required input in declared language and preserves another completed field', async () => {
  const submit = vi.fn<ActionSubmit>();
  const create = {
    ...action,
    fields: {
      type: 'object',
      properties: {
        goal: { type: 'string', title: '目标' },
        note: { type: 'string', title: '备注' },
      },
      required: ['goal'],
    },
  };
  const view = render(<ActionRunner rel="opaque:one" action={create} submit={submit} />);
  fireEvent.click(screen.getByRole('button', { name: '移出材料' }));
  fireEvent.change(screen.getByRole('textbox', { name: /备注/ }), {
    target: { value: '保留这段' },
  });
  fireEvent.submit(view.container.querySelector('form')!);
  expect(await screen.findByText('请填写“目标”。')).toBeTruthy();
  expect(screen.queryByText('Errors')).toBeNull();
  expect((screen.getByRole('textbox', { name: /备注/ }) as HTMLInputElement).value).toBe(
    '保留这段',
  );
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: /目标/ }), {
    target: { value: '补齐目标' },
  });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
});

it('keeps the member available after a refused unlink and prevents a duplicate in-flight submission', async () => {
  let finish: ((result: Awaited<ReturnType<ActionSubmit>>) => void) | undefined;
  const submit = vi.fn<ActionSubmit>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <EntityCacheProvider fetcher={async () => entity} versionFetcher={async () => 'v'}>
      <ActionGroup entity={entity} submit={submit} />
    </EntityCacheProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '移出材料' }));
  const remove = await screen.findByRole('button', { name: '移出 季度汇报' });
  fireEvent.click(remove);
  fireEvent.click(remove);
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  finish?.({ ok: false, status: 409, layer: 'guard', reason: '材料正在审核' });
  await screen.findByText('材料正在审核');
  expect(
    (screen.getByRole('button', { name: '移出 季度汇报' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it('a confirmation requirement cannot be bypassed by the selection annotation', () => {
  const submit = vi.fn<ActionSubmit>();
  const risky = { ...action, 'requires-confirmation': 'high' as const };
  const view = render(<ActionGroup entity={{ ...entity, actions: [risky] }} submit={submit} />);
  fireEvent.click(screen.getByRole('button', { name: '移出材料' }));
  fireEvent.submit(view.container.querySelector('form')!);
  expect(screen.getByRole('button', { name: '确认并执行移出材料' })).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
});

it('does not call a failed confirmation submission unsent', async () => {
  const submit = vi.fn<ActionSubmit>(async () => ({
    ok: false,
    status: 503,
    layer: 'network',
    reason: '服务暂不可用',
  }));
  render(
    <ActionGroup
      entity={{
        ...entity,
        actions: [
          {
            ...action,
            fields: { type: 'object', properties: {} },
            'requires-confirmation': 'high',
          },
        ],
      }}
      submit={submit}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '移出材料' }));
  fireEvent.click(screen.getByRole('button', { name: '确认并执行移出材料' }));
  await screen.findByText('尚未取得成功回执；再次确认将重新提交。');
  expect(screen.queryByText('确认后提交执行；尚未发送请求。')).toBeNull();
});

it('preserves an accepted unlink receipt when refreshing afterward fails', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(entity)
    .mockResolvedValueOnce(entity)
    .mockRejectedValue(new Error('refresh unavailable'));
  const submit = vi.fn<ActionSubmit>(async () => ({ ok: true, entity }));
  render(
    <EntityCacheProvider fetcher={read} versionFetcher={async () => 'v'}>
      <ActionGroup entity={entity} submit={submit} />
    </EntityCacheProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '移出材料' }));
  fireEvent.click(await screen.findByRole('button', { name: '移出 季度汇报' }));
  await screen.findByText('已移出引用，但暂时无法更新材料列表。请重新打开。');
  expect(screen.queryByRole('button', { name: '移出 季度汇报' })).toBeNull();
  expect(screen.queryByText('尚未取得执行结果，请刷新材料后核对。')).toBeNull();
});
