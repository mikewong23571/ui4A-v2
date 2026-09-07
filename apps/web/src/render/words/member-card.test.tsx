// @vitest-environment jsdom
/**
 * member-card 词条测试(T33 Phase D):集合成员携带已声明动作时,成员渲染为
 * 决策卡(身份行 + 动作行);动作数据全部来自成员合同(actions/guard-results/
 * properties),渲染器零类型分支(D50:责任点一等)。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import {
  ActionSubmitProvider,
  createDirectActionSubmit,
} from '../../components/actions/action-submit';
import { MemberCardWord } from './member-card';

const approveAction: SirenAction = {
  name: 'approve',
  title: '批准',
  method: 'POST',
  href: '/api/exec',
  fields: { type: 'object', properties: {} },
};

const rejectAction: SirenAction = {
  name: 'reject',
  title: '驳回',
  method: 'POST',
  href: '/api/exec',
  fields: { type: 'object', properties: {} },
};

function confirmationDocument(status = 'pending') {
  return {
    properties: {
      rel: 'confirmation:c1',
      'target-rel': 'post:post-welcome',
      'target-action': 'archive',
      'policy-reason': '完整审核依据',
      status,
      ...(status === 'pending' ? {} : { 'decided-by': { actor: 'human' } }),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(confirmationDocument()), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderCard(props: Record<string, unknown>): void {
  render(
    <ActionSubmitProvider
      submit={createDirectActionSubmit(
        vi.fn(async () => ({ ok: true as const, entity: {} as SirenEntity })),
        { clientParams: () => ({}) },
      )}
    >
      <MemberCardWord {...props} />
    </ActionSubmitProvider>,
  );
}

describe('member-card 词条', () => {
  it('inbox resume does not replace full fresh decision facts or duplicate raw first-screen metadata', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            properties: {
              rel: 'confirmation:c1',
              'target-rel': 'post:post-welcome',
              'target-action': 'archive',
              'policy-reason': '需要核对完整的风险依据，而非截断摘要',
              params: { explanation: '完整参数必须保留，不能随截断摘要一起消失' },
              status: 'pending',
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderCard({
      label: 'archive · 由 agent 提议',
      rel: 'confirmation:c1',
      status: 'pending',
      detail: '对象 post:post-welcome · 截断摘要',
      actions: [{ ...approveAction, 'requires-confirmation': 'high' }],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/entity?rel=confirmation%3Ac1', {
      cache: 'no-store',
    });
    const info = await screen.findByTestId('decision-info');
    expect(info.textContent).toContain('需要核对完整的风险依据，而非截断摘要');
    expect(info.querySelector('[data-decision-row="change"]')?.textContent).toContain('未提供');
    expect(info.querySelector('[data-decision-row="params"]')?.textContent).toContain(
      '完整参数必须保留，不能随截断摘要一起消失',
    );
    expect(screen.queryByText('对象 post:post-welcome · 截断摘要')).toBeNull();
    const audit = screen.getByText('合同详情').closest('details')!;
    expect(audit.open).toBe(false);
    expect(audit.textContent).toContain('confirmation:c1');
    expect(screen.queryByText('操作规则')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '批准' }));
    expect(screen.getByRole('button', { name: '确认并执行批准' })).toBeTruthy();
  });
  it('确认读取后保留合同动作,机器标识按需披露', async () => {
    renderCard({
      label: 'archive · 由 agent 提议',
      rel: 'confirmation:c1',
      actions: [approveAction, rejectAction],
      guardResults: [
        { action: 'approve', blocked: false, guards: [] },
        { action: 'reject', blocked: false, guards: [] },
      ],
    });

    expect(screen.getByText('archive · 由 agent 提议')).toBeTruthy();
    const approve = (await screen.findByRole('button', { name: '批准' })) as HTMLButtonElement;
    expect(screen.getByRole('link', { name: '查看确认合同' }).getAttribute('href')).toBe(
      '/canvas?focus=confirmation%3Ac1',
    );
    expect(approve.dataset.action).toBe('approve');
    expect(approve.disabled).toBe(false);
    expect(screen.getByRole('button', { name: '驳回' })).toBeTruthy();
    expect(screen.queryByText('操作规则')).toBeNull();
  });

  it('成员无动作 → 只有身份行,无动作区(渲染器零分支)', () => {
    renderCard({ label: '情报收集', rel: 'delegation:d1', actions: [] });

    expect(screen.getByText('情报收集')).toBeTruthy();
    expect(screen.queryByText('操作规则')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('已决 fresh 合同保留决定回执,不再呈现陈旧动作与resume', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify(confirmationDocument('rejected')), { status: 200 }),
      ),
    );
    renderCard({
      label: 'archive · 由 agent 提议',
      rel: 'confirmation:c1',
      detail: '对象 post:post-welcome',
      status: 'pending',
      actions: [approveAction, rejectAction],
    });
    const info = await screen.findByTestId('decision-info');
    expect(info.textContent).toContain('已由 human 驳回');
    expect(screen.queryByText('对象 post:post-welcome')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('读取失败明确保留重试和合同入口,恢复后再呈现决定控件', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(
        async () => new Response(JSON.stringify(confirmationDocument()), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderCard({
      label: '待审核事项',
      rel: 'confirmation:c1',
      detail: '截断摘要',
      actions: [approveAction],
    });
    const retry = await screen.findByRole('button', { name: '重试读取' });
    expect(screen.getByRole('status').textContent).toContain('无法读取完整决定信息');
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
    expect(screen.getByRole('link', { name: '待审核事项' }).getAttribute('href')).toBe(
      '/canvas?focus=confirmation%3Ac1',
    );
    fireEvent.click(retry);
    await screen.findByTestId('decision-info');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '批准' })).toBeTruthy();
  });

  it('an observed status change refreshes the same mounted confirmation and shows its receipt', async () => {
    let document = confirmationDocument();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(document), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const submit = vi.fn();
    const viewOf = (status: string, actions: SirenAction[]) => (
      <ActionSubmitProvider submit={submit}>
        <MemberCardWord
          label="待审核事项"
          rel="confirmation:c1"
          status={status}
          actions={actions}
        />
      </ActionSubmitProvider>
    );
    const view = render(viewOf('pending', [approveAction]));
    await screen.findByRole('button', { name: '批准' });
    document = confirmationDocument('approved');
    view.rerender(viewOf('approved', []));
    expect(await screen.findByText('已由 human 批准')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it('与 member-table 共用 presentations 概览，正文可读且 identity/status 不重复', () => {
    renderCard({
      label: '评论审核',
      rel: 'comment:c1',
      status: '待处理',
      actions: [approveAction],
      fields: { body: '这是一条需要先阅读的评论。', status: 'pending', tags: ['产品', '体验'] },
      presentations: [
        {
          path: 'properties.fields.body',
          title: '评论内容',
          role: 'primary-content',
          overview: true,
        },
        { path: 'properties.fields.status', title: '状态', role: 'status', overview: true },
        { path: 'properties.fields.tags', title: '标签', role: 'metadata', overview: true },
      ],
    });

    expect(screen.getByText('这是一条需要先阅读的评论。')).toBeTruthy();
    expect(screen.getByText('产品、体验')).toBeTruthy();
    expect(screen.queryByText('pending')).toBeNull();
    expect(document.querySelectorAll('[data-column="properties.fields.body"]')).toHaveLength(1);
  });

  it('label/rel 缺失 → 响亮抛错(合同形状守卫)', () => {
    expect(() => renderCard({ rel: 'confirmation:c1', actions: [] })).toThrow(/member-card/);
    expect(() => renderCard({ label: 'x', actions: [] })).toThrow(/member-card/);
  });

  it('density=compact → 卡片收紧留白与行距(标题/详情单行截断,零布局分支)', () => {
    renderCard({
      label: '一篇需要截断的长标题文章',
      rel: 'post:a',
      status: '已发布',
      detail: '摘要也很长,compact 下单行截断',
      actions: [approveAction],
      density: 'compact',
    });

    const card = document.querySelector('[data-word="member-card"]')!;
    expect(card.getAttribute('data-density')).toBe('compact');
    expect(card.className).toContain('p-1.5');
    expect(card.className).not.toContain('p-3');
    // 标题与详情在 compact 下都是单行截断(truncate),不是多行换行
    expect(screen.getByText('一篇需要截断的长标题文章').className).toContain('truncate');
    expect(screen.getByText('摘要也很长,compact 下单行截断').className).toContain('truncate');
  });

  it('未声明密度 → comfortable 缺省(既有排版零变化)', () => {
    renderCard({
      label: '普通卡片',
      rel: 'post:b',
      status: '已发布',
      actions: [approveAction],
    });

    const card = document.querySelector('[data-word="member-card"]')!;
    expect(card.getAttribute('data-density')).toBeNull();
    expect(card.className).toContain('p-3');
    expect(card.className).not.toContain('p-1.5');
  });
});
