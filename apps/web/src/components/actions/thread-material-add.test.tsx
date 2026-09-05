// @vitest-environment jsdom
/**
 * G07 材料入口收敛:非书桌宿主(首页工作线区/实体页)的「添加涉及对象」。
 *
 * - 主路径 = 授权发现选择器(与书桌同一 ObjectSelectorPanel):点击候选经
 *   宿主 submit 适配器提交 attach(category 缺省 context),成功后失效线缓存
 *   并广播 THREAD_UPDATED_EVENT;
 * - 裸 rel RJSF 表单仅为「高级」回退:默认不可见,展开后合同字段(类别/rel)
 *   原样可达,同一提交适配器;
 * - 已在本线的候选禁选(重复不可提交);本组件只提交 attach,移出不删除对象
 *   本身(合同 detach 语义由既有入口承担);
 * - guard blocked 投影为 disabled + 原因 status。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ThreadMaterialAdd } from './thread-material-add';
import type { ActionSubmit } from './action-submit';
import { THREAD_UPDATED_EVENT } from '../canvas/desk/thread-desk-shared';
import { EntityCacheProvider } from '../entity-cache-provider';

const attachAction: SirenAction = {
  name: 'attach',
  title: '添加涉及对象',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['context', 'active', 'approval', 'event'], title: '类别' },
      rel: { type: 'string', title: '涉及对象', minLength: 1 },
    },
    required: ['category', 'rel'],
    additionalProperties: false,
  } as SirenAction['fields'],
};

function threadEntity(context: string[]): SirenEntity {
  return {
    class: ['work-thread', 'open'],
    properties: {
      rel: 'thread:t1',
      identity: '完成跨应用评审闭环',
      context,
      statusText: '进行中',
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=thread:t1' }],
    'guard-results': [],
    entities: [],
  };
}

function todosCollection(): SirenEntity {
  return {
    class: ['collection', 'todos'],
    properties: { rel: 'todos', title: '待办', count: 1 },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=todos' }],
    'guard-results': [],
    entities: [
      {
        class: ['flow-instance', 'todo-item'],
        properties: {
          rel: 'todo:buy',
          identity: '买牛奶',
          title: '进行中',
          status: 'open',
          fields: { title: '买牛奶' },
          presentation: {
            version: 1,
            fields: [
              {
                path: 'properties.fields.title',
                title: '待办标题',
                role: 'identity',
                overview: true,
              },
            ],
          },
        },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=todo:buy' }],
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

function renderMaterialAdd(
  store: Record<string, SirenEntity>,
  submit: ActionSubmit,
  props: { onExecuted?: (rel: string) => void; blocked?: boolean; blockReason?: string } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('ui4a.json')) {
        return jsonResponse({
          version: 'v-test',
          surfaces: [{ rel: 'todos', title: '待办', collection: true }],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return render(
    <EntityCacheProvider
      fetcher={async (rel) => store[rel] ?? null}
      versionFetcher={async () => 'v-test'}
    >
      <ThreadMaterialAdd
        rel="thread:t1"
        action={attachAction}
        submit={submit}
        onExecuted={props.onExecuted}
        blocked={props.blocked}
        blockReason={props.blockReason}
      />
    </EntityCacheProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThreadMaterialAdd(材料入口收敛)', () => {
  it('主路径 = 授权选择器:点击候选经宿主适配器提交 attach(category=context),成功后广播线更新且候选转禁选', async () => {
    const store: Record<string, SirenEntity> = {
      'thread:t1': threadEntity([]),
      todos: todosCollection(),
    };
    const onExecuted = vi.fn();
    const submit = vi.fn(async ({ params }: { params?: Record<string, unknown> }) => {
      const rel = (params ?? {}).rel;
      if (rel === 'todo:buy') {
        store['thread:t1'] = threadEntity(['todo:buy']);
      }
      return { ok: true as const, entity: store['thread:t1']! };
    }) as unknown as ActionSubmit;
    const updated = vi.fn();
    window.addEventListener(THREAD_UPDATED_EVENT, updated);

    renderMaterialAdd(store, submit, { onExecuted });
    // 默认无裸 rel 输入(主路径不是手填表单)。
    expect(screen.queryByLabelText(/涉及对象/)).toBeNull();
    fireEvent.click(screen.getByTestId('thread-add-material'));
    fireEvent.click(await screen.findByTestId('desk-selector-pick:todo:buy'));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        rel: 'thread:t1',
        action: attachAction,
        params: { category: 'context', rel: 'todo:buy' },
      }),
    );
    expect(onExecuted).toHaveBeenCalledWith('thread:t1');
    expect(updated).toHaveBeenCalled();
    // 挂入重读后:同一候选禁选并标注,不可重复提交。
    await waitFor(() =>
      expect(
        (screen.getByTestId('desk-selector-pick:todo:buy') as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(screen.getByTestId('desk-selector-pick:todo:buy').textContent).toContain('已在本线');
    window.removeEventListener(THREAD_UPDATED_EVENT, updated);
  });

  it('已在本线的候选初始即禁选;移出语义不在此组件(仅提交 attach)', async () => {
    const store: Record<string, SirenEntity> = {
      'thread:t1': threadEntity(['todo:buy']),
      todos: todosCollection(),
    };
    const submit = vi.fn(async () => ({
      ok: true as const,
      entity: threadEntity([]),
    })) as unknown as ActionSubmit;
    renderMaterialAdd(store, submit);
    fireEvent.click(screen.getByTestId('thread-add-material'));
    const attached = await screen.findByTestId('desk-selector-pick:todo:buy');
    expect((attached as HTMLButtonElement).disabled).toBe(true);
    expect(attached.textContent).toContain('已在本线');
    expect(submit).not.toHaveBeenCalled();
  });

  it('裸 rel 表单仅为高级回退:默认收起,展开后合同字段原样可达并走同一适配器', async () => {
    const store: Record<string, SirenEntity> = { 'thread:t1': threadEntity([]) };
    const submit = vi.fn(async () => ({
      ok: true as const,
      entity: threadEntity([]),
    })) as unknown as ActionSubmit;
    const { container } = renderMaterialAdd(store, submit);

    // 高级未展开:无裸 rel 文本框。
    expect(screen.queryByLabelText(/涉及对象/)).toBeNull();
    fireEvent.click(screen.getByTestId('thread-add-material-advanced'));
    // 原始通用表单(ActionRunner)原样呈现:触发键 → RJSF 字段。
    fireEvent.click(screen.getByRole('button', { name: '添加涉及对象' }));
    const relInput = (await screen.findByLabelText(/涉及对象/)) as HTMLInputElement;
    fireEvent.change(relInput, { target: { value: 'idea:ux0905' } });
    // RJSF v6 enum select 的 DOM value 是选项下标(indexed),变更后解码回真值。
    fireEvent.change(screen.getByLabelText(/类别/), { target: { value: '0' } });
    fireEvent.click(container.querySelector('button[type="submit"][data-action="attach"]')!);

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        rel: 'thread:t1',
        action: attachAction,
        params: { category: 'context', rel: 'idea:ux0905' },
      }),
    );
  });

  it('guard blocked 投影为触发键 disabled + 原因 status', () => {
    const submit = vi.fn() as unknown as ActionSubmit;
    renderMaterialAdd({ 'thread:t1': threadEntity([]) }, submit, {
      blocked: true,
      blockReason: 'guard 不满足: thread-open=false',
    });
    expect((screen.getByTestId('thread-add-material') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('guard 不满足: thread-open=false');
  });
});
