// @vitest-environment jsdom
/**
 * member-table 词条测试:集合成员呈现为表格行(通用词汇,密度声明驱动)。
 * 行=成员;列:主体(label 链接 → 画布落面 + mono rel)/ 状态 / 详情 / 操作
 * (ActionGroup density='compact' 行内动作)。渲染器零实体类型分支。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import {
  ActionSubmitProvider,
  createDirectActionSubmit,
} from '../../components/actions/action-submit';
import { ACTION_CONTRACT_LEGEND } from '../../components/actions/action-group';
import { MemberTableWord } from './member-table';

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

function renderRow(props: Record<string, unknown>): ReturnType<typeof render> {
  return render(
    <ActionSubmitProvider
      submit={createDirectActionSubmit(
        vi.fn(async () => ({ ok: true as const, entity: {} as SirenEntity })),
      )}
    >
      <MemberTableWord {...props} />
    </ActionSubmitProvider>,
  );
}

describe('member-table 词条', () => {
  it('成员=行:主体单元格 label 链接指向画布落面并下挂 mono rel,状态/详情直出', () => {
    renderRow({
      label: 'archive · 由 agent 提议',
      rel: 'confirmation:c1',
      status: '待决',
      detail: '归档请求等待人工裁决',
      actions: [approveAction],
      guardResults: [{ action: 'approve', blocked: false, guards: [] }],
    });

    // 语义表格:一张表、一行、四列。
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(1);
    expect(screen.getAllByRole('cell')).toHaveLength(4);

    // 主体列:href 走 canvasEntityHref(rel) 的画布落面。
    const link = screen.getByRole('link', { name: 'archive · 由 agent 提议' });
    expect(link.getAttribute('href')).toBe(
      `/canvas?focus=${encodeURIComponent('confirmation:c1')}`,
    );
    expect(screen.getByText('confirmation:c1')).toBeTruthy();
    expect(screen.getByText('待决')).toBeTruthy();
    expect(screen.getByText('归档请求等待人工裁决')).toBeTruthy();
  });

  it('操作列含行内动作按钮(compact:无图例、无边框盒子),危险动作仍隔离呈现', () => {
    const { container } = renderRow({
      label: 'archive · 由 agent 提议',
      rel: 'confirmation:c1',
      actions: [approveAction, rejectAction],
      guardResults: [
        { action: 'approve', blocked: false, guards: [] },
        { action: 'reject', blocked: false, guards: [] },
      ],
    });

    const approve = screen.getByRole('button', { name: '批准' }) as HTMLButtonElement;
    expect(approve.dataset.action).toBe('approve');
    expect(approve.disabled).toBe(false);
    expect(screen.getByRole('button', { name: '驳回' })).toBeTruthy();

    // compact 密度:合同图例保留在详情面,行内零图例;条目不套全宽边框盒子。
    expect(screen.queryByText(ACTION_CONTRACT_LEGEND)).toBeNull();
    for (const item of container.querySelectorAll('[data-action-group-item]')) {
      expect(item.className).not.toContain('border');
      expect(item.className).not.toContain('rounded-md');
    }
  });

  it('成员无动作 → 操作列留空(零分支),其余列照常', () => {
    renderRow({ label: '情报收集', rel: 'delegation:d1', status: '进行中', actions: [] });

    expect(screen.getByRole('link', { name: '情报收集' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(ACTION_CONTRACT_LEGEND)).toBeNull();
    expect(screen.getAllByRole('cell')).toHaveLength(4);
  });

  it('单词段缺省 → 诚实空单元格,不发明占位事实', () => {
    renderRow({ label: '裸成员', rel: 'record:x', actions: [] });

    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(4);
    expect(cells[1]!.textContent).toBe('');
    expect(cells[2]!.textContent).toBe('');
  });

  it('guard blocked → 按钮 disabled + 原因投影(compact 与 default 同一裁决)', () => {
    renderRow({
      label: 'archive · 由 agent 提议',
      rel: 'confirmation:c1',
      actions: [approveAction],
      guardResults: [
        {
          action: 'approve',
          blocked: true,
          reason: 'guard 不满足: item-ready=false',
          guards: [{ name: 'item-ready', pass: false }],
        },
      ],
    });

    const approve = screen.getByRole('button', { name: '批准' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('guard 不满足: item-ready=false');
  });

  it('label/rel 缺失 → 响亮抛错(合同形状守卫)', () => {
    expect(() => renderRow({ rel: 'confirmation:c1', actions: [] })).toThrow(/member-table/);
    expect(() => renderRow({ label: 'x', actions: [] })).toThrow(/member-table/);
  });

  describe('T38 FR4 概览列(presentation.fields 的 overview hint,声明驱动)', () => {
    const presentations = [
      { path: 'properties.fields.title', title: '标题', role: 'identity', overview: true },
      { path: 'properties.fields.body', title: '正文', role: 'primary-content', overview: true },
      { path: 'properties.fields.category', title: '分类', role: 'metadata', overview: true },
    ];

    it('概览列按声明序进概览行(identity 角色跳过),状态列保留(US2 过滤语义锚)', () => {
      renderRow({
        label: '第一篇',
        rel: 'post:p1',
        status: 'published',
        detail: 'resume 文本',
        actions: [approveAction],
        fields: { title: '第一篇', body: '正文内容', category: '随笔' },
        presentations,
      });

      // 主体 + 状态 + 2 概览列(title 为 identity 角色,主体列已有,跳过)+ 操作。
      expect(screen.getAllByRole('cell')).toHaveLength(5);
      // 状态列保留:US2 过滤的语义锚,不被概览声明挤掉。
      expect(screen.getByText('published')).toBeTruthy();
      // 详情位被声明概览取代(诚实按声明)。
      expect(screen.queryByText('resume 文本')).toBeNull();
      // identity 字段不重复成概览列:主体列(链接+rel)已有,值只出现一次。
      expect(screen.getAllByText('第一篇')).toHaveLength(1);
      // 列语义来自声明数据(零渲染器发明文案)。
      const bodyCell = screen.getByText('正文内容').closest('td');
      expect(bodyCell?.getAttribute('data-column')).toBe('properties.fields.body');
      expect(bodyCell?.getAttribute('title')).toBe('正文');
      // 声明序即列序(identity 跳过):body → category。
      const columns = [...screen.getAllByRole('cell')]
        .map((cell) => cell.getAttribute('data-column'))
        .filter((value) => value !== null && value.startsWith('properties.fields.'));
      expect(columns).toEqual(['properties.fields.body', 'properties.fields.category']);
    });

    it('status 角色的声明字段跳过概览列(状态列即其语义,零重复)', () => {
      renderRow({
        label: '第三篇',
        rel: 'post:p3',
        status: 'published',
        actions: [],
        fields: { state: 'published', body: '正文内容' },
        presentations: [
          { path: 'properties.fields.state', title: '状态', role: 'status', overview: true },
          {
            path: 'properties.fields.body',
            title: '正文',
            role: 'primary-content',
            overview: true,
          },
        ],
      });

      const cells = screen.getAllByRole('cell');
      // 主体 + 状态 + 正文概览 + 操作;状态声明字段不另成列。
      expect(cells).toHaveLength(4);
      expect(cells[1]!.textContent).toBe('published');
      expect(screen.getByText('正文内容')).toBeTruthy();
      expect(
        [...cells].filter((cell) => cell.getAttribute('data-column') === 'properties.fields.state'),
      ).toHaveLength(0);
    });

    it('成员缺声明字段 → 诚实空单元格,不发明占位事实', () => {
      renderRow({
        label: '第二篇',
        rel: 'post:p2',
        actions: [],
        fields: { title: '第二篇' },
        presentations,
      });

      const cells = screen.getAllByRole('cell');
      expect(cells).toHaveLength(5);
      expect(cells[1]!.textContent).toBe('');
      const bodyCell = cells[2]!;
      expect(bodyCell.getAttribute('data-column')).toBe('properties.fields.body');
      expect(bodyCell.textContent).toBe('');
      const categoryCell = cells[3]!;
      expect(categoryCell.getAttribute('data-column')).toBe('properties.fields.category');
      expect(categoryCell.textContent).toBe('');
    });

    it('无有效概览列(含 presentations 缺省)→ 回退现状四列(身份/状态/详情/操作)', () => {
      renderRow({
        label: '裸成员',
        rel: 'record:x',
        status: '进行中',
        detail: 'resume',
        actions: [],
        presentations: [{ path: 'properties.fields.title', title: '标题', role: 'identity' }],
      });
      expect(screen.getAllByRole('cell')).toHaveLength(4);
      expect(screen.getByText('进行中')).toBeTruthy();
      expect(screen.getByText('resume')).toBeTruthy();

      cleanup();
      renderRow({ label: '另一成员', rel: 'record:y', actions: [] });
      expect(screen.getAllByRole('cell')).toHaveLength(4);
    });
  });
});
