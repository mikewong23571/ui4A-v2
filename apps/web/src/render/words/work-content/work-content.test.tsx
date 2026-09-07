// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SirenAction, SirenEntity } from '@ui4a/engine';
import { EntityCacheProvider } from '../../../components/entity-cache-provider';
import { ActionSubmitProvider } from '../../../components/actions/action-submit';
import { WorkContentWord } from './work-content';

const action = (name: string, title: string): SirenAction => ({
  name,
  title,
  href: '/api/exec',
  method: 'POST',
  fields: { type: 'object', properties: {} },
});
const member = (rel: string, identity: string, traits: string[] = []): SirenEntity => ({
  class: [],
  properties: { rel, identity, presentation: { version: 1, traits } },
  actions: [],
  links: [],
});
const source: SirenEntity = {
  ...member('work:a', '当前方案', ['work-queue']),
  properties: {
    rel: 'work:a',
    identity: '当前方案',
    fields: { body: '真实方案全文', secret: '不应显示' },
    presentation: {
      version: 1,
      fields: [{ path: 'properties.fields.body', title: '方案', role: 'primary-content' }],
    },
  },
  actions: [action('revise', '修订')],
};
const material = member('source:a', '调研材料', ['supporting-context']);
const parent = { ...member('thread:a', '界面优化'), actions: [action('pause', '暂停')] };

function setup(
  entities = [member('work:a', '当前方案', ['work-queue']), material],
  options: {
    root?: SirenEntity;
    fetcher?: (rel: string) => Promise<SirenEntity | null>;
  } = {},
) {
  const root = options.root ?? parent;
  const fetcher = vi.fn(
    options.fetcher ??
      (async (rel: string) =>
        rel === source.properties.rel
          ? source
          : rel === root.properties.rel
            ? root
            : (entities.find((entry) => entry.properties.rel === rel) ?? null)),
  );
  const submit = vi.fn(async () => ({ ok: true as const, entity: root }));
  const rendered = render(
    <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
      <ActionSubmitProvider submit={submit}>
        <textarea aria-label="草稿" defaultValue="尚未发送" />
        <WorkContentWord entities={entities} entity={root} links={root.links} />
      </ActionSubmitProvider>
    </EntityCacheProvider>,
  );
  return { ...rendered, fetcher, submit };
}
afterEach(cleanup);

it('keeps plain content literal and only formats declared Markdown below the page heading', async () => {
  const document = structuredClone(source);
  document.properties.fields = { body: '# literal heading' };
  setup(undefined, { fetcher: async () => document });
  expect(await screen.findByText('# literal heading')).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  cleanup();
  (
    document.properties.presentation as { fields: Array<{ contentMediaType?: string }> }
  ).fields[0]!.contentMediaType = 'text/markdown';
  setup(undefined, { fetcher: async () => document });
  expect(await screen.findByRole('heading', { name: 'literal heading', level: 3 })).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
});

it('keeps work readable, materials secondary and management collapsed', async () => {
  const { fetcher } = setup();
  expect(await screen.findByText('真实方案全文')).toBeTruthy();
  expect(screen.queryByText('不应显示')).toBeNull();
  expect(screen.queryByText('调研材料')).toBeNull();
  expect(fetcher).not.toHaveBeenCalledWith('source:a', undefined);
  expect(screen.getByRole('button', { name: '材料 · 1' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '暂停' })).toBeNull();
  expect(screen.getByRole('button', { name: '修订' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();
});

it('material preview is read-only and closing it preserves the working content and draft', async () => {
  const { fetcher } = setup();
  const content = await screen.findByText('真实方案全文');
  const draft = screen.getByRole('textbox', { name: '草稿' });
  fireEvent.change(draft, { target: { value: '继续编辑中' } });
  fireEvent.click(screen.getByRole('button', { name: '材料 · 1' }));
  const dialog = screen.getByRole('dialog', { name: '材料' });
  expect(within(dialog).getByText('调研材料')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalledWith('source:a', undefined);
  fireEvent.click(within(dialog).getByRole('button', { name: '调研材料' }));
  expect(await within(dialog).findByRole('link', { name: '调研材料' })).toBeTruthy();
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('source:a', undefined));
  expect(within(dialog).queryByRole('button', { name: '暂停' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '返回列表' }));
  expect(within(dialog).getByRole('button', { name: '调研材料' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('真实方案全文')).toBe(content);
  expect((draft as HTMLTextAreaElement).value).toBe('继续编辑中');
});

it('every responsibility stays visible even when nested in supporting groups or duplicated', async () => {
  const decision = member('decision:a', '需要决定', ['human-responsibility', 'supporting-context']);
  const second = member('decision:b', '另一项决定', ['human-responsibility']);
  const group: SirenEntity = {
    ...member('group:a', '参考集合', ['supporting-context']),
    properties: {
      ...member('group:a', '参考集合', ['supporting-context']).properties,
      presentation: { version: 1, groupRole: 'context', traits: ['supporting-context'] },
    },
    entities: [decision, second, material],
  };
  setup([group, decision], {
    fetcher: async (rel) =>
      [decision, second, material].find((entry) => entry.properties.rel === rel) ?? null,
  });
  await waitFor(() => expect(screen.getAllByRole('link', { name: '需要决定' })).toHaveLength(1));
  expect(screen.getByRole('link', { name: '另一项决定' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '材料 · 2' })).toBeTruthy();
  expect(screen.queryByText('参考集合')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '材料 · 2' }));
  expect(screen.getByRole('button', { name: '参考集合' })).toBeTruthy();
});

it('retains group content and actions without turning group lifecycle into a responsibility', async () => {
  const child = member('decision:child', '子项决定', ['human-responsibility']);
  const group: SirenEntity = {
    ...member('group:work', '实施工作组', ['human-responsibility', 'work-queue']),
    properties: {
      ...member('group:work', '实施工作组').properties,
      presentation: {
        version: 1,
        groupRole: 'responsibility',
        traits: ['human-responsibility', 'work-queue'],
      },
    },
    actions: [action('pause-group', '暂停工作组')],
    entities: [child],
  };
  setup([group], { fetcher: async (rel) => (rel === 'group:work' ? group : child) });
  expect(await screen.findByRole('button', { name: '暂停工作组' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '实施工作组' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '子项决定' })).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '实施工作组' }).closest('[data-word="member-card"]'),
  ).toBeNull();
});

it('failed source reads keep the responsibility identity, expose retry, and hide stale actions', async () => {
  const decision = {
    ...member('decision:a', '需要决定', ['human-responsibility']),
    actions: [action('approve', '批准')],
  };
  let readable = false;
  setup([decision], { fetcher: async () => (readable ? decision : null) });
  expect((await screen.findByRole('alert')).textContent).toBe('暂时无法读取');
  expect(screen.getByRole('link', { name: '需要决定' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
  readable = true;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('button', { name: '批准' })).toBeTruthy();
});

it('discussion opens the existing assistant with the triggering control', () => {
  setup([]);
  const listener = vi.fn();
  window.addEventListener('ui4a:chat-open', listener);
  const trigger = screen.getByRole('button', { name: '讨论' });
  fireEvent.click(trigger);
  expect(listener).toHaveBeenCalledTimes(1);
  expect((listener.mock.calls[0]![0] as CustomEvent).detail).toBe(trigger);
  window.removeEventListener('ui4a:chat-open', listener);
});

it('empty material collections do not expose an unlink action', () => {
  const detach = action('unlink', '移出');
  detach.fields['x-ui4a-reference-selection'] = { effect: 'unlink', options: [] };
  setup([], { root: { ...parent, actions: [detach] } });
  expect(screen.queryByRole('button', { name: '移出' })).toBeNull();
  expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
});

it('does not repeat supporting materials as primary navigation links', () => {
  setup([material], {
    root: {
      ...parent,
      links: [
        { rel: ['context'], href: '/api/entity?rel=source%3Aa', title: '调研材料' },
        { rel: ['history'], href: '/api/entity?rel=events%3Aa', title: '工作历史' },
      ],
    },
  });
  expect(screen.queryByText('调研材料')).toBeNull();
  expect(screen.getByText('活动与依据')).toBeTruthy();
});

it('rechecks the declared reference and guards before a per-material removal', async () => {
  const detach = action('unlink', '移出');
  detach.fields['x-ui4a-reference-selection'] = {
    effect: 'unlink',
    options: [{ title: '调研材料', params: { rel: 'source:a', category: 'context' } }],
  };
  const root = { ...parent, actions: [detach] };
  let permitted = false;
  const { submit } = setup([material], {
    root,
    fetcher: async (rel) =>
      rel === 'thread:a'
        ? {
            ...root,
            'guard-results': [
              {
                action: 'unlink',
                blocked: !permitted,
                reason: '工作线已关闭',
                guards: [{ name: 'open', pass: permitted }],
              },
            ],
          }
        : material,
  });
  fireEvent.click(screen.getByRole('button', { name: '材料 · 1' }));
  fireEvent.click(screen.getByRole('button', { name: '移出 调研材料' }));
  expect(await screen.findByText('工作线已关闭')).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
  permitted = true;
  fireEvent.click(screen.getByRole('button', { name: '移出 调研材料' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      rel: 'thread:a',
      action: detach,
      params: { rel: 'source:a', category: 'context' },
    }),
  );
});

it('does not submit removal when a reference has disappeared', async () => {
  const detach = action('unlink', '移出');
  detach.fields['x-ui4a-reference-selection'] = {
    effect: 'unlink',
    options: [{ title: '调研材料', params: { rel: 'source:a', category: 'context' } }],
  };
  const { submit } = setup([material], {
    root: { ...parent, actions: [detach] },
    fetcher: async (rel) => (rel === 'thread:a' ? { ...parent, actions: [] } : material),
  });
  fireEvent.click(screen.getByRole('button', { name: '材料 · 1' }));
  fireEvent.click(screen.getByRole('button', { name: '移出 调研材料' }));
  expect(await screen.findByText('引用已变化，请刷新材料')).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
});

it('refreshes an open material list from the canonical root without rebuilding the dialog', async () => {
  let refreshed = false;
  const second = member('source:b', '新增材料', ['supporting-context']);
  setup([material], {
    fetcher: async () => ({ ...parent, entities: refreshed ? [material, second] : [material] }),
  });
  fireEvent.click(screen.getByRole('button', { name: '材料 · 1' }));
  const dialog = screen.getByRole('dialog');
  refreshed = true;
  fireEvent(window, new CustomEvent('ui4a:thread-updated', { detail: 'thread:a' }));
  expect(await within(dialog).findByRole('button', { name: '新增材料' })).toBeTruthy();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.getByTestId('work-materials-trigger').textContent).toBe('材料 · 2');
});

it('a failed root refresh clears old material facts and actions inside the still-open dialog', async () => {
  setup([material], { fetcher: async () => null });
  fireEvent.click(screen.getByRole('button', { name: '材料 · 1' }));
  const dialog = screen.getByRole('dialog');
  fireEvent(window, new CustomEvent('ui4a:thread-updated', { detail: 'thread:a' }));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: '调研材料' })).toBeNull();
  expect(screen.getByTestId('work-materials-trigger').textContent).toBe('材料');
  expect(screen.queryByText('暂停')).toBeNull();
  expect(within(dialog).getByRole('button', { name: '重试' })).toBeTruthy();
});

it('ignores a late root read after a newer refresh has completed', async () => {
  const reads: Array<(entity: SirenEntity) => void> = [];
  setup([material], { fetcher: () => new Promise<SirenEntity>((resolve) => reads.push(resolve)) });
  fireEvent.click(screen.getByRole('button', { name: '材料 · 1' }));
  fireEvent(window, new CustomEvent('ui4a:thread-updated', { detail: 'thread:a' }));
  await waitFor(() => expect(reads).toHaveLength(1));
  fireEvent(window, new CustomEvent('ui4a:thread-updated', { detail: 'thread:a' }));
  await waitFor(() => expect(reads).toHaveLength(2));
  const newer = member('source:b', '最新材料', ['supporting-context']);
  await act(async () => reads[1]!({ ...parent, entities: [newer] }));
  expect(screen.getByRole('button', { name: '最新材料' })).toBeTruthy();
  await act(async () => reads[0]!({ ...parent, entities: [material] }));
  expect(screen.getByRole('button', { name: '最新材料' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '调研材料' })).toBeNull();
});
