// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SirenEntity } from '@ui4a/engine';
import { ObjectSelectorPanel } from '../thread-desk-selector';
import { EntityCacheProvider } from '../../../entity-cache-provider';

const member = (rel: string, title: string): SirenEntity => ({
  class: [],
  properties: {
    rel,
    identity: title,
    fields: { body: `${rel} 的正文` },
    presentation: {
      version: 1,
      fields: [{ path: 'properties.fields.body', title: '正文', role: 'primary-content' }],
    },
  },
  actions: [],
  links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
});
const a = member('item:a', '同名材料');
const b = member('item:b', '同名材料');
// Identity is declared so the content does not become the list title.
for (const item of [a, b]) {
  (item.properties.presentation as { fields: unknown[] }).fields.unshift({
    path: 'properties.identity',
    title: '标题',
    role: 'identity',
  });
}
function setup(onPick = vi.fn(async (_rel: string) => true)) {
  const store: Record<string, SirenEntity> = {
    'item:a': a,
    'item:b': b,
    first: {
      class: [],
      properties: { title: '第一来源' },
      actions: [],
      links: [],
      entities: [a, b],
    },
    second: { class: [], properties: { title: '第二来源' }, actions: [], links: [], entities: [a] },
  };
  const fetcher = vi.fn(async (rel: string) => store[rel] ?? null);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            surfaces: [
              { rel: 'first', collection: true },
              { rel: 'second', collection: true },
            ],
          }),
        ),
    ),
  );
  render(
    <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
      <ObjectSelectorPanel
        attachedRels={new Set()}
        busy={false}
        onPick={onPick}
        onClose={() => undefined}
      />
    </EntityCacheProvider>,
  );
  return { onPick, fetcher, store };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('deduplicates refs, previews authorized content without writing, and keeps selection through searches', async () => {
  const { onPick, fetcher } = setup();
  fireEvent.click(await screen.findByTestId('desk-selector-pick:item:a'));
  expect(screen.getAllByTestId('desk-selector-pick:item:a')).toHaveLength(1);
  expect(screen.getByText('item:a')).toBeTruthy();
  expect(screen.getByText('item:b')).toBeTruthy();
  fireEvent.change(screen.getByTestId('desk-selector-filter'), { target: { value: 'item:b' } });
  fireEvent.click(screen.getByTestId('desk-selector-preview:item:b'));
  expect(await screen.findByText('item:b 的正文')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith('item:b', undefined);
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
  fireEvent.change(screen.getByTestId('desk-selector-filter'), { target: { value: '' } });
  expect((screen.getByTestId('desk-selector-pick:item:a') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByTestId('desk-selector-add'));
  await waitFor(() => expect(onPick).toHaveBeenCalledExactlyOnceWith('item:a'));
});

it('submits sequentially, keeps only failed selection, and reports partial success', async () => {
  let release!: (value: boolean) => void;
  const onPick = vi.fn((rel: string) =>
    rel === 'item:a'
      ? new Promise<boolean>((resolve) => {
          release = resolve;
        })
      : Promise.resolve(false),
  );
  setup(onPick);
  fireEvent.click(await screen.findByTestId('desk-selector-pick:item:a'));
  fireEvent.click(screen.getByTestId('desk-selector-pick:item:b'));
  fireEvent.click(screen.getByTestId('desk-selector-add'));
  expect(onPick).toHaveBeenCalledTimes(1);
  expect((screen.getByTestId('desk-selector-add') as HTMLButtonElement).disabled).toBe(true);
  release(true);
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('已添加 1 项；1 项未确认')).toBeTruthy();
  expect((screen.getByTestId('desk-selector-pick:item:b') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByTestId('desk-selector-pick:item:a') as HTMLInputElement).checked).toBe(false);
});

it('shows unavailable preview honestly and never substitutes stale collection content', async () => {
  const { store, onPick } = setup();
  delete store['item:a'];
  fireEvent.click(await screen.findByTestId('desk-selector-preview:item:a'));
  expect(await screen.findByText('暂时无法读取')).toBeTruthy();
  expect(screen.queryByText('item:a 的正文')).toBeNull();
  expect(onPick).not.toHaveBeenCalled();
});
