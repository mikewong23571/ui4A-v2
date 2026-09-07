// @vitest-environment jsdom
/**
 * T56 P3.1 Red→Green:材料关联与 pin 的语义分离(US06/US04、FR5;design §2
 * pin 行、D78 决定 3)。
 *
 * - **pin = 固定视图快捷入口**(本机呈现偏好,localStorage 按线隔离);
 *   **membership = 线合同 context 成员**(事件真相,只由显式 attach/detach
 *   改变)。两者文案可辨、计数分离:工作集计数只算成员,固定视图区单列
 *   pin-only,后者明确不属材料;
 * - pin/取消 pin 零业务事件、不进 references 合同(合同层断言见
 *   presentation-surface-host.thread-nav.test);
 * - membership 与 HTTP 同源:工作集 = /api/entity 的 references.context;
 * - 失败不假成功:detach 被拒时材料仍在、pin 不被清除、拒绝原因可读;
 * - 重复添加明确拒绝(候选禁选),同一对象只出现一次、只产生一次 attach;
 * - archived 线(合同无声明动作)不显示可用的写动作;guard 投影 blocked
 *   (权限收回)的动作对应控件不可用。
 *
 * 取数口径:UI 与断言都走同一个 HTTP 合同桩(GET /api/entity 读、POST
 * /api/exec 裁决并记事件),attach 幂等性不做桩内兜底——重复提交会如实
 * 产生重复 membership,使「只提交一次」可被断言。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuardResultEntry, SirenAction, SirenEntity } from '@ui4a/engine';

import { ThreadDesk, threadPinsKey } from './thread-desk';
import { EntityCacheProvider } from '../../entity-cache-provider';
import { PresentationSurfaceHost } from '../presentation-surface-host';
import { renderCatalogJson } from '@/render/registry';

vi.mock('next/navigation', () => ({
  usePathname: () => '/canvas',
  useSearchParams: () => new URLSearchParams('thread=t1&focus=thread%3At1'),
}));

const referenceFields = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['context', 'active', 'approval', 'event'], title: '类别' },
    rel: { type: 'string', title: '关联对象', minLength: 1 },
  },
  required: ['category', 'rel'],
  additionalProperties: false,
} as const;

const attachAction: SirenAction = {
  name: 'attach',
  title: '添加关联',
  method: 'POST',
  href: '/api/exec',
  fields: referenceFields,
};
const detachAction: SirenAction = { ...attachAction, name: 'detach', title: '移出关联' };

interface MemberFacts {
  identity: string;
  status?: string;
}

interface ThreadState {
  context: string[];
  status: 'open' | 'archived';
  /** 模拟权限收回后的投影:guard-results 标记 blocked(控件消失)。 */
  detachBlocked?: boolean;
  /** 模拟提交时才发生的服务端拒绝(读后权限变化等):投影无 blocked,
   *  控件在场但 exec 被拒(D78 决定 4:owner guard 在 exec 时裁决)。 */
  rejectDetach?: boolean;
  identities: Record<string, MemberFacts>;
  /** 业务事件种类流水(attach/detach 各记一次;pin 永不入账)。 */
  events: string[];
}

function memberEntity(rel: string, facts: MemberFacts): SirenEntity {
  return {
    class: ['flow-instance'],
    properties: { rel, identity: facts.identity, status: facts.status, fields: {} },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` }],
    'guard-results': [],
  };
}

function threadProjection(state: ThreadState): SirenEntity {
  const archived = state.status === 'archived';
  const guardResults: GuardResultEntry[] = state.detachBlocked
    ? [
        {
          action: 'detach',
          blocked: true,
          reason: 'guard 不满足: thread-owner=false',
          guards: [{ name: 'thread-owner', pass: false }],
        },
        { action: 'attach', blocked: false, guards: [] },
      ]
    : [
        { action: 'attach', blocked: false, guards: [] },
        { action: 'detach', blocked: false, guards: [] },
      ];
  return {
    class: archived ? ['work-thread', 'archived'] : ['work-thread', 'open'],
    properties: {
      rel: 'thread:t1',
      id: 't1',
      identity: '处理 CVE 批次',
      status: state.status,
      statusText: archived ? '已归档' : '进行中',
      context: [...state.context],
      active: [],
      approval: [],
      'recent-events': [],
    },
    actions: archived ? [] : [attachAction, detachAction],
    links: [{ rel: ['self'], href: '/api/entity?rel=thread%3At1' }],
    'guard-results': guardResults,
    entities: state.context.map((rel) => ({
      class: ['thread-reference'],
      properties: {
        rel,
        identity: state.identities[rel]?.identity ?? rel,
        ...(state.identities[rel]?.status === undefined
          ? {}
          : { status: state.identities[rel]?.status }),
      },
      actions: [],
      links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` }],
    })),
  };
}

function todosCollection(): SirenEntity {
  return {
    class: ['collection', 'todos'],
    properties: { rel: 'todos', count: 1, title: '待办' },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=todos' }],
    'guard-results': [],
    entities: [
      {
        class: ['flow-instance', 'todo-capture'],
        properties: {
          rel: 'todo:buy',
          identity: '买牛奶',
          status: 'capture',
          fields: { title: '买牛奶' },
        },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=todo%3Abuy' }],
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function baseState(overrides: Partial<ThreadState> = {}): ThreadState {
  return {
    context: ['todo:t35'],
    status: 'open',
    identities: {
      'todo:t35': { identity: '完成 T35 全轨道验收', status: 'archived' },
      'post:p1': { identity: '第一篇', status: 'published' },
      'todo:buy': { identity: '买牛奶', status: 'capture' },
    },
    events: [],
    ...overrides,
  };
}

/** HTTP 合同桩:GET 读投影、POST 裁决并记账;attach 不去重(重复提交会真重复)。 */
function stubContract(state: ThreadState): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/render/catalog') return jsonResponse(renderCatalogJson());
    if (url.startsWith('/api/presentation')) return jsonResponse({ error: 'not found' }, 404);
    if (url.startsWith('/api/entity?rel=')) {
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel') ?? '';
      if (rel === 'render-specs')
        return jsonResponse({
          class: ['collection'],
          properties: { rel },
          entities: [],
          actions: [],
          links: [],
        });
      if (rel === 'thread:t1') return jsonResponse(threadProjection(state));
      if (rel === 'todos') return jsonResponse(todosCollection());
      const facts = state.identities[rel];
      return facts === undefined
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse(memberEntity(rel, facts));
    }
    if (url.startsWith('/.well-known/ui4a.json')) {
      return jsonResponse({
        version: 'v-test',
        surfaces: [{ rel: 'todos', title: '待办', collection: true }],
      });
    }
    if (url.includes('/api/exec')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        action?: string;
        params?: { rel?: string };
      };
      if (state.status === 'archived') {
        return jsonResponse(
          {
            layer: 'undeclared',
            reason: `动作 "${body.action}" 未声明于 archived Work Thread`,
          },
          403,
        );
      }
      if (body.action === 'attach') {
        state.events.push('thread-reference-attached');
        state.context = [...state.context, String(body.params?.rel)];
        return jsonResponse({ entity: threadProjection(state) });
      }
      if (body.action === 'detach') {
        if (state.rejectDetach === true) {
          return jsonResponse({ layer: 'guard', reason: 'guard 不满足: thread-owner=false' }, 403);
        }
        state.events.push('thread-reference-detached');
        state.context = state.context.filter((rel) => rel !== body.params?.rel);
        return jsonResponse({ entity: threadProjection(state) });
      }
      return jsonResponse({ entity: threadProjection(state) });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function httpFetcher(rel: string): Promise<SirenEntity | null> {
  const response = await fetch(`/api/entity?rel=${encodeURIComponent(rel)}`);
  return response.ok ? ((await response.json()) as SirenEntity) : null;
}

function renderDesk(): ReturnType<typeof render> {
  return render(
    <EntityCacheProvider fetcher={httpFetcher} versionFetcher={async () => 'v-test'}>
      <ThreadDesk threadId="t1" />
    </EntityCacheProvider>,
  );
}

async function httpContext(): Promise<string[]> {
  const response = await fetch('/api/entity?rel=thread%3At1');
  const body = (await response.json()) as SirenEntity;
  return body.properties.context as string[];
}

function pinStorage(): string[] {
  const raw = globalThis.localStorage?.getItem(threadPinsKey('t1'));
  return JSON.parse(raw ?? '[]') as string[];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
});

describe('材料/pin 语义分离(US06/FR5;T56 P3.1)', () => {
  it('pin-only 对象在「固定视图」区:不入工作集 membership 计数,与 HTTP 合同一致', async () => {
    const state = baseState();
    globalThis.localStorage?.setItem(threadPinsKey('t1'), JSON.stringify(['post:p1']));
    vi.stubGlobal('fetch', stubContract(state));
    const { container } = renderDesk();
    await screen.findByText('完成 T35 全轨道验收');

    // 工作集计数只算 membership(context 成员),pin-only 不冒充材料。
    expect(screen.getByTestId('desk-working-set-count').textContent).toBe('关联（1）');
    // 工作集条目只有成员;pin-only 单列固定视图区。
    const entries = [...container.querySelectorAll('[data-desk-entry]')].map((element) =>
      element.getAttribute('data-desk-entry'),
    );
    expect(entries).toEqual(['todo:t35']);
    const pinned = screen.getByTestId('desk-pinned');
    expect(pinned.textContent).toContain('第一篇');
    expect(pinned.textContent).toContain('固定视图');
    // 两种语义在 HTTP 合同层同源可辨:references.context 不含 pin-only。
    expect(await httpContext()).toEqual(['todo:t35']);
    expect(state.events).toEqual([]);
  });

  it('两者都有 = 成员且已固定:只列一次,移出与取消固定两个动作并存', async () => {
    const state = baseState();
    globalThis.localStorage?.setItem(threadPinsKey('t1'), JSON.stringify(['todo:t35']));
    vi.stubGlobal('fetch', stubContract(state));
    const { container } = renderDesk();
    await screen.findByText('完成 T35 全轨道验收');

    expect(container.querySelectorAll('[data-desk-entry]')).toHaveLength(1);
    expect(screen.queryByTestId('desk-pinned')).toBeNull();
    expect(screen.getByTestId('desk-remove:todo:t35')).toBeTruthy();
    expect(screen.getByTestId('desk-unpin:todo:t35')).toBeTruthy();
  });

  it('detach 被拒:材料仍在、pin 不被清除、拒绝原因可读、零业务事件', async () => {
    const state = baseState({ rejectDetach: true });
    globalThis.localStorage?.setItem(threadPinsKey('t1'), JSON.stringify(['todo:t35']));
    vi.stubGlobal('fetch', stubContract(state));
    renderDesk();
    await screen.findByText('完成 T35 全轨道验收');

    fireEvent.click(screen.getByTestId('desk-remove:todo:t35'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('guard');
    expect(alert.textContent).toContain('thread-owner');

    // 不假成功:成员仍在(未乐观移除),pin 不被顺手清掉(不清另一种状态)。
    expect(screen.getByText('完成 T35 全轨道验收')).toBeTruthy();
    expect(pinStorage()).toEqual(['todo:t35']);
    expect(state.events).toEqual([]);
    expect(await httpContext()).toEqual(['todo:t35']);
  });

  it('archived 线合同无声明动作:添加/移出写动作不显示;已固定仍可取消固定', async () => {
    const state = baseState({ status: 'archived' });
    globalThis.localStorage?.setItem(threadPinsKey('t1'), JSON.stringify(['post:p1']));
    vi.stubGlobal('fetch', stubContract(state));
    const { container } = renderDesk();
    await screen.findByText('完成 T35 全轨道验收');

    // US04:归档线不显示可用的写动作——写控件不可提交路径存在即失败。
    expect(screen.queryByTestId('desk-add-material')).toBeNull();
    expect(screen.queryByTestId('desk-remove:todo:t35')).toBeNull();
    // 固定视图是本机呈现偏好,不依赖合同动作,照常可取消。
    expect(screen.getByTestId('desk-unpin:post:p1')).toBeTruthy();
    expect(container.querySelector('[data-desk-entry="todo:t35"]')).not.toBeNull();
  });

  it('权限收回(guard 投影 detach blocked):移出动作不可用', async () => {
    const state = baseState({ detachBlocked: true });
    vi.stubGlobal('fetch', stubContract(state));
    renderDesk();
    await screen.findByText('完成 T35 全轨道验收');

    expect(screen.queryByTestId('desk-remove:todo:t35')).toBeNull();
  });

  it('membership 与 HTTP 同源:添加/移出后工作集与 /api/entity 的 context 一致', async () => {
    const state = baseState();
    vi.stubGlobal('fetch', stubContract(state));
    const { container } = renderDesk();
    await screen.findByText('完成 T35 全轨道验收');

    fireEvent.click(screen.getByTestId('desk-add-material'));
    fireEvent.click(await screen.findByTestId('desk-selector-pick:todo:buy'));
    await screen.findByText('买牛奶');

    const uiRels = [...container.querySelectorAll('[data-desk-entry]')]
      .map((element) => element.getAttribute('data-desk-entry'))
      .sort();
    expect(uiRels).toEqual(['todo:buy', 'todo:t35']);
    expect(await httpContext()).toEqual(['todo:t35', 'todo:buy']);

    fireEvent.click(screen.getByTestId('desk-remove:todo:buy'));
    await waitFor(() => expect(container.querySelector('[data-desk-entry="todo:buy"]')).toBeNull());
    expect(await httpContext()).toEqual(['todo:t35']);
    expect(state.events).toEqual(['thread-reference-attached', 'thread-reference-detached']);
  });

  it('重复添加明确拒绝:已固定对象挂入后只列一次、只产生一次 attach', async () => {
    const state = baseState();
    globalThis.localStorage?.setItem(threadPinsKey('t1'), JSON.stringify(['todo:buy']));
    vi.stubGlobal('fetch', stubContract(state));
    const { container } = renderDesk();
    await screen.findByText('买牛奶');

    fireEvent.click(screen.getByTestId('desk-add-material'));
    fireEvent.click(await screen.findByTestId('desk-selector-pick:todo:buy'));
    await waitFor(() =>
      expect(
        (screen.getByTestId('desk-selector-pick:todo:buy') as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // 成员只列一次;固定视图区不再重复列出(对象已成为成员)。
    const buyRows = [...container.querySelectorAll('[data-desk-entry]')].filter(
      (element) => element.getAttribute('data-desk-entry') === 'todo:buy',
    );
    expect(buyRows).toHaveLength(1);
    expect(screen.queryByTestId('desk-pinned')).toBeNull();
    expect(state.events).toEqual(['thread-reference-attached']);
  });
});

function renderDeskAndSurface() {
  return render(
    <EntityCacheProvider fetcher={httpFetcher} versionFetcher={async () => 'v-test'}>
      <ThreadDesk threadId="t1" />
      <section data-testid="main-surface">
        <PresentationSurfaceHost parameters={{ focus: 'thread:t1', thread: 't1' }} />
      </section>
    </EntityCacheProvider>,
  );
}

it('membership mutations refresh the same-page Surface as well as the drawer', async () => {
  const state = baseState();
  vi.stubGlobal('fetch', stubContract(state));
  renderDeskAndSurface();
  const main = screen.getByTestId('main-surface');
  const mainMembers = () =>
    [...main.querySelectorAll('[data-nav="presentation:member"]')].map((link) => link.textContent);
  await waitFor(() => expect(mainMembers()).toEqual(['完成 T35 全轨道验收']));
  fireEvent.click(screen.getByTestId('desk-remove:todo:t35'));
  await waitFor(() =>
    expect(screen.getByTestId('desk-working-set-count').textContent).toBe('关联（0）'),
  );
  await waitFor(() => expect(mainMembers()).toEqual([]));
  fireEvent.click(screen.getByTestId('desk-add-material'));
  fireEvent.click(await screen.findByTestId('desk-selector-pick:todo:buy'));
  await waitFor(() => expect(mainMembers()).toEqual(['买牛奶']));
  expect(screen.getByTestId('desk-working-set-count').textContent).toBe('关联（1）');
  expect(state.events).toEqual(['thread-reference-detached', 'thread-reference-attached']);
});

it('a rejected membership change retains material in both the Surface and drawer', async () => {
  const state = baseState({ rejectDetach: true });
  const fetchMock = stubContract(state);
  vi.stubGlobal('fetch', fetchMock);
  renderDeskAndSurface();
  const main = screen.getByTestId('main-surface');
  await waitFor(() =>
    expect(main.querySelector('[data-nav="presentation:member"]')?.textContent).toBe(
      '完成 T35 全轨道验收',
    ),
  );
  const presentationReads = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/presentation')).length;
  const readsBefore = presentationReads();
  fireEvent.click(screen.getByTestId('desk-remove:todo:t35'));
  await screen.findByTestId('desk-failure');
  expect(main.querySelector('[data-nav="presentation:member"]')?.textContent).toBe(
    '完成 T35 全轨道验收',
  );
  expect(screen.getByTestId('desk-working-set-count').textContent).toBe('关联（1）');
  expect(presentationReads()).toBe(readsBefore);
  expect(state.events).toEqual([]);
});
