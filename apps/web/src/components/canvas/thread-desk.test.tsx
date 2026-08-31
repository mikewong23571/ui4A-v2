// @vitest-environment jsdom
/**
 * T35 §十定稿:线工作台书桌(纯读目录)与舞台动作组的组件契约。
 *
 * - 书桌 = 叙述(目标/状态/停在哪/来源) + 工作集条目;**零整面 surface、零
 *   属性表**(此前 W2 左栏实时渲染整面是塞爆根因,pin=上下文引用);
 * - 工作集 = 线 context 成员(合同 detach 移出) + 钉住页(本地取消)合并去重;
 * - 「＋添加涉及对象」→ 对象选择器(sitemap 集合面成员,机械派生),点击即挂
 *   category=context(F-27② 裸填 rel 退位),已挂对象标记"已在本线";
 * - 舞台动作组:生命周期操作呈现,书桌覆盖的 attach/detach 不重复;
 *   危险组按 requires-confirmation 通用分层(归档与推进操作分隔)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ThreadDesk, threadPinsKey } from './thread-desk';
import { THREAD_UPDATED_EVENT } from './thread-desk-shared';
import { ThreadStageActions } from './thread-stage-actions';
import { EntityCacheProvider } from '../entity-cache-provider';

const referenceFields = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['context', 'active', 'approval', 'event'], title: '类别' },
    rel: { type: 'string', title: '涉及对象', minLength: 1 },
  },
  required: ['category', 'rel'],
  additionalProperties: false,
} as const;

const emptySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

function plainAction(name: string, title: string): SirenAction {
  return { name, title, method: 'POST', href: '/api/exec', fields: emptySchema };
}

const attachAction: SirenAction = {
  name: 'attach',
  title: '添加涉及对象',
  method: 'POST',
  href: '/api/exec',
  fields: referenceFields,
};
const detachAction: SirenAction = { ...attachAction, name: 'detach', title: '移出涉及对象' };
const archiveAction: SirenAction = {
  ...plainAction('archive', '归档工作线'),
  'requires-confirmation': 'high',
};

function threadEntity(): SirenEntity {
  return {
    class: ['work-thread', 'open'],
    properties: {
      rel: 'thread:t1',
      identity: '处理 CVE 批次',
      id: 't1',
      goal: { text: '处理 CVE 批次', source: 'chat 消息' },
      // 投影已把可解析来源转成任务语;书桌只消费投影字段,不直读 raw source。
      goalSourceText: 'chat 消息',
      status: 'open',
      statusText: '进行中',
      context: ['todo:t35'],
      resume: '停在「open」',
      active: [],
      approval: [],
      'recent-events': [],
    },
    actions: [
      attachAction,
      detachAction,
      plainAction('pause', '暂停工作线'),
      plainAction('complete', '完成工作线'),
      archiveAction,
    ],
    links: [{ rel: ['self'], href: '/api/entity?rel=thread:t1' }],
    'guard-results': [],
    entities: [
      {
        class: ['thread-reference'],
        properties: { rel: 'todo:t35', identity: '完成 T35 全轨道验收', status: 'archived' },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=todo:t35' }],
      },
    ],
  };
}

function postEntity(): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    properties: { rel: 'post:p1', title: '第一篇', status: 'draft', fields: {} },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=post:p1' }],
    'guard-results': [],
  };
}

function todosCollection(): SirenEntity {
  return {
    class: ['collection', 'todos'],
    properties: { rel: 'todos', count: 1 },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=todos' }],
    'guard-results': [],
    entities: [
      {
        class: ['flow-instance', 'todo-capture'],
        properties: {
          rel: 'todo:buy',
          identity: '买牛奶',
          title: '捕捉',
          status: 'capture',
          fields: { title: '买牛奶' },
        },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=todo:buy' }],
      },
    ],
  };
}

function renderDesk(entities: Record<string, SirenEntity>, threadId = 't1') {
  return render(
    <EntityCacheProvider
      scope={undefined}
      fetcher={async (rel) => entities[rel] ?? null}
      versionFetcher={async () => 'v-test'}
    >
      <ThreadDesk threadId={threadId} />
    </EntityCacheProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ThreadDesk(书桌目录)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.localStorage?.clear();
  });

  it('叙述卡渲染目标/状态/停在哪/来源,且书桌零整面 surface(无属性表、无动作按钮)', async () => {
    const { container } = renderDesk({ 'thread:t1': threadEntity() });
    await screen.findByText('处理 CVE 批次');
    expect(screen.getByTestId('desk-status').textContent).toBe('进行中');
    expect(container.textContent).toContain('停在「open」');
    expect(container.textContent).toContain('来源:chat 消息');
    // 纯读轨:书桌不承载任何合同动作按钮(data-action 唯一挂点),无属性表
    expect(container.querySelector('[data-action]')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('来源不可解析时干净省略来源行,裸标识不泄漏为可见文案(F-08)', async () => {
    const entity = threadEntity();
    delete entity.properties.goalSourceText;
    const { container } = renderDesk({ 'thread:t1': entity });
    await screen.findByText('处理 CVE 批次');
    expect(container.textContent).not.toContain('来源:');
    expect(container.textContent).not.toContain('chat 消息');
  });

  it('工作集 = context 成员 + 钉住页合并;context 移出走合同 detach,钉住页仅本地取消', async () => {
    globalThis.localStorage?.setItem(threadPinsKey('t1'), JSON.stringify(['post:p1']));
    const execCalls: Record<string, unknown>[] = [];
    const entity = threadEntity();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/exec')) {
          execCalls.push(JSON.parse(String(init?.body ?? '{}')));
          return jsonResponse({ entity });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    renderDesk({ 'thread:t1': entity, 'post:p1': postEntity() });
    await screen.findByText('完成 T35 全轨道验收');
    await screen.findByText('第一篇');
    // 去重:同一 rel 只出现一次;钉住 rel 已在 context 时不重复
    expect(screen.getAllByText('完成 T35 全轨道验收')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('desk-remove:todo:t35'));
    await waitFor(() =>
      expect(execCalls).toEqual([
        {
          rel: 'thread:t1',
          action: 'detach',
          params: { category: 'context', rel: 'todo:t35' },
          actor: 'human',
          principal: 'local-user',
          channel: 'renderer',
        },
      ]),
    );

    fireEvent.click(screen.getByTestId('desk-remove:post:p1'));
    await waitFor(() => {
      const raw = globalThis.localStorage?.getItem(threadPinsKey('t1'));
      expect(JSON.parse(raw ?? '[]')).toEqual([]);
    });
    expect(execCalls).toHaveLength(1);
  });

  it('「＋添加涉及对象」打开选择器(sitemap 集合面成员),点击即挂 context;已挂对象标记不可再选', async () => {
    const execCalls: Record<string, unknown>[] = [];
    let context: string[] = [];
    const store: Record<string, SirenEntity> = {
      'thread:t1': threadEntity(),
      todos: todosCollection(),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/exec')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            action?: string;
            params?: { rel?: string };
          };
          execCalls.push(body);
          if (body.action === 'attach' && body.params?.rel !== undefined) {
            context = [...context, body.params.rel];
            const base = threadEntity();
            store['thread:t1'] = { ...base, properties: { ...base.properties, context } };
          }
          return jsonResponse({ entity: store['thread:t1'] });
        }
        if (url.includes('ui4a.json')) {
          return jsonResponse({
            version: 'v-test',
            surfaces: [
              { rel: 'todos', title: 'todos', collection: true },
              { rel: 'flow:todo-capture', title: '待办捕捉' },
            ],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    renderDesk(store);
    fireEvent.click(await screen.findByTestId('desk-add-material'));
    const panel = await screen.findByTestId('desk-selector');
    // 候选 = 集合面成员(业务标题);flow 面不是集合,不入候选
    await screen.findByText('买牛奶');
    expect(panel.textContent).toContain('todos');
    // 已挂对象(context 成员 todo:t35 不在 todos 集合,但选择器应标注已在本线的成员)
    fireEvent.click(screen.getByTestId('desk-selector-pick:todo:buy'));
    await waitFor(() =>
      expect(execCalls).toEqual([
        {
          rel: 'thread:t1',
          action: 'attach',
          params: { category: 'context', rel: 'todo:buy' },
          actor: 'human',
          principal: 'local-user',
          channel: 'renderer',
        },
      ]),
    );
    // 挂载后重读 → 选择器内该项标记"已在本线"且不可再点
    await waitFor(() =>
      expect(
        (screen.getByTestId('desk-selector-pick:todo:buy') as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(screen.getByTestId('desk-selector-pick:todo:buy').textContent).toContain('已在本线');
  });

  it('exec 拒绝如实呈现(role=alert),不伪造成功', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ layer: 'guard', reason: '仅人类可执行' }, 403)),
    );
    renderDesk({ 'thread:t1': threadEntity() });
    await screen.findByText('完成 T35 全轨道验收');
    fireEvent.click(screen.getByTestId('desk-remove:todo:t35'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('guard');
    expect(alert.textContent).toContain('仅人类可执行');
  });
});

describe('ThreadStageActions(舞台动作组)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('生命周期操作呈现;attach/detach 不重复(书桌覆盖);归档落危险组', async () => {
    const { container } = render(
      <EntityCacheProvider
        fetcher={async (rel) => (rel === 'thread:t1' ? threadEntity() : null)}
        versionFetcher={async () => 'v-test'}
      >
        <ThreadStageActions threadId="t1" />
      </EntityCacheProvider>,
    );
    expect(await screen.findByRole('button', { name: '暂停工作线' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '完成工作线' })).toBeTruthy();
    expect(container.querySelector('[data-action="attach"]')).toBeNull();
    expect(container.querySelector('[data-action="detach"]')).toBeNull();
    const danger = screen.getByTestId('action-danger-group');
    expect(danger.querySelector('[data-action-group-item="archive"]')).not.toBeNull();
  });

  it('exec 成功后广播线程更新事件(书桌据此重读)', async () => {
    const updated = vi.fn();
    window.addEventListener(THREAD_UPDATED_EVENT, updated);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ entity: threadEntity() })),
    );
    const { container } = render(
      <EntityCacheProvider
        fetcher={async (rel) => (rel === 'thread:t1' ? threadEntity() : null)}
        versionFetcher={async () => 'v-test'}
      >
        <ThreadStageActions threadId="t1" />
      </EntityCacheProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '完成工作线' }));
    await waitFor(() => expect(updated).toHaveBeenCalled());
    window.removeEventListener(THREAD_UPDATED_EVENT, updated);
    container.remove();
  });
});
