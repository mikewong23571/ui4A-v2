// @vitest-environment jsdom
/**
 * member-card 词条测试(T33 Phase D):集合成员携带已声明动作时,成员渲染为
 * 决策卡(身份行 + 动作行);动作数据全部来自成员合同(actions/guard-results/
 * properties),渲染器零类型分支(D50:责任点一等)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
  it('成员带已声明动作 → 身份行 + 收起动作行(批准一击,零参数)', () => {
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
    expect(screen.getByText('confirmation:c1')).toBeTruthy();
    const approve = screen.getByRole('button', { name: '批准' }) as HTMLButtonElement;
    expect(approve.dataset.action).toBe('approve');
    expect(approve.disabled).toBe(false);
    expect(screen.getByRole('button', { name: '驳回' })).toBeTruthy();
    // 同一合同图例(D47.1)
    expect(screen.getByText('你和助手使用同一合同，由同一规则裁决')).toBeTruthy();
  });

  it('成员无动作 → 只有身份行,无动作区(渲染器零分支)', () => {
    renderCard({ label: '情报收集', rel: 'delegation:d1', actions: [] });

    expect(screen.getByText('情报收集')).toBeTruthy();
    expect(screen.queryByText('你和助手使用同一合同，由同一规则裁决')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
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
