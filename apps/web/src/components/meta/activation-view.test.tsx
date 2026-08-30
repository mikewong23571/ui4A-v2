// @vitest-environment jsdom
/**
 * BIOS 激活详情面(T4 Phase C Task 2;spec 架构决定 7)。
 *
 * - checks 列表逐项显示(名称 + 通过/失败 + 失败明细);
 * - 机械 diff 用内建 react-diff-view 渲染(不经过被审批者的任何渲染器);
 * - approve/reject 是已声明动作(RJSF:reject reason 必填),提交走
 *   /_meta/api/exec；浏览器不提交身份，服务端注入 human principal(铁律 5);
 * - 已决策(approved/rejected)是审计视图:无审批动作。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DefinitionDiff, SirenAction, SirenEntity } from '@ui4a/engine';

import { ActivationView } from './activation-view';

/** 表单内提交按钮按结构定位(铁律 3 的 data-action 挂点);触发键与提交键同名。 */
function submitButton(action: string): HTMLElement {
  const button = document.querySelector(`button[data-action="${action}"]`);
  if (!(button instanceof HTMLElement)) throw new Error(`missing submit button: ${action}`);
  return button;
}

// ---- fixtures(形状与 projectActivation 投影一致)---------------------------

const approveAction: SirenAction = {
  name: 'approve',
  title: '批准',
  method: 'POST',
  href: '/_meta/api/exec',
  'requires-confirmation': 'high',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const rejectAction: SirenAction = {
  name: 'reject',
  title: '驳回',
  method: 'POST',
  href: '/_meta/api/exec',
  'requires-confirmation': 'high',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { reason: { type: 'string', format: 'textarea', minLength: 1, title: '原因' } },
    required: ['reason'],
    additionalProperties: false,
  },
};

const diff: DefinitionDiff = {
  algorithm: 'deep-object-diff',
  before: {
    name: 'article-drafting',
    title: '文章发布向导',
    initial: 'basic-info',
    nodes: [
      { name: 'ready', title: '就绪', actions: [{ name: 'publish', title: '发布', to: 'done' }] },
    ],
  },
  after: {
    name: 'article-drafting',
    title: '文章发布向导',
    initial: 'basic-info',
    nodes: [
      {
        name: 'ready',
        title: '就绪',
        actions: [
          { name: 'publish', title: '发布', to: 'done' },
          { name: 'pin', title: '置顶', to: 'done', guards: [] },
        ],
      },
    ],
  },
  changed: {
    added: {
      nodes: { 0: { actions: { 1: { name: 'pin', title: '置顶', to: 'done', guards: [] } } } },
    },
    deleted: {},
    updated: {},
  },
};

function activationEntity(
  status: 'pending-approval' | 'approved' | 'rejected',
  overrides: Record<string, unknown> = {},
): SirenEntity {
  const pending = status === 'pending-approval';
  return {
    class: ['meta', 'activation', status],
    properties: {
      id: 'a1',
      flow: 'article-drafting',
      status,
      version: 2,
      artifact: 'fnv9f3k2',
      checks: [
        { name: 'edge-targets-exist', pass: true },
        { name: 'guards-registered', pass: true },
        { name: 'field-types-known', pass: true },
        { name: 'effect-known', pass: true },
        { name: 'initial-exists', pass: true },
        {
          name: 'terminal-reachable',
          pass: false,
          detail: ['nodes[ready].actions[pin]: to "done" 不在节点集'],
        },
      ],
      diff,
      'requested-by': { actor: 'agent', principal: 'user:mike' },
      ...(status === 'approved'
        ? { 'approved-by': { actor: 'human', principal: 'user:mike' } }
        : {}),
      ...(status === 'rejected' ? { 'rejected-reason': '理由' } : {}),
      ...overrides,
    },
    actions: pending ? [approveAction, rejectAction] : [],
    links: [
      { rel: ['self'], href: '/_meta/api/entity?rel=meta/activation:a1' },
      { rel: ['target'], href: '/_meta/api/entity?rel=meta/flow:article-drafting' },
    ],
    'guard-results': pending
      ? [
          {
            action: 'approve',
            blocked: true,
            reason: 'guard 不满足: actor-is-human=false',
            guards: [{ name: 'actor-is-human', pass: false }],
          },
          {
            action: 'reject',
            blocked: true,
            reason: 'guard 不满足: actor-is-human=false',
            guards: [{ name: 'actor-is-human', pass: false }],
          },
        ]
      : [],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ActivationView(BIOS 激活详情)', () => {
  it('checks 列表逐项显示:名称 + 通过/失败标记 + 失败明细', () => {
    render(<ActivationView id="a1" entity={activationEntity('pending-approval')} />);

    expect(screen.getByText('edge-targets-exist')).toBeTruthy();
    expect(screen.getByText('terminal-reachable')).toBeTruthy();
    expect(screen.getAllByText('通过').length).toBe(5);
    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText(/to "done" 不在节点集/)).toBeTruthy();
  });

  it('机械 diff 用内建 react-diff-view 呈现:新增动作 pin 可见(绿行)', () => {
    const { container } = render(
      <ActivationView id="a1" entity={activationEntity('pending-approval')} />,
    );
    expect(container.querySelector('table.diff')).not.toBeNull();
    const inserts = [...container.querySelectorAll('.diff-code-insert')].map(
      (node) => node.textContent ?? '',
    );
    expect(inserts.join('\n')).toContain('pin');
  });

  it('stages the real human-only decision before a fresh read and shows the decided receipt inline', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, activationEntity('pending-approval')))
      .mockResolvedValueOnce(jsonResponse(200, { entity: activationEntity('approved') }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ActivationView id="a1" entity={activationEntity('pending-approval')} />);

    fireEvent.click(screen.getByRole('button', { name: '批准' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/已请求.*尚未执行/);
    fireEvent.click(screen.getByRole('button', { name: '确认并执行批准' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_meta/api/entity?rel=meta%2Factivation%3Aa1');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/_meta/api/exec');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      rel: 'meta/activation:a1',
      action: 'approve',
    });
    const decided = await screen.findByRole('status');
    expect(decided.textContent).toContain('approved');
    expect(decided.textContent).toContain('user:mike');
  });

  it('cancels a real human-only decision with Escape, restores focus, and emits no request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ActivationView id="a1" entity={activationEntity('pending-approval')} />);

    const trigger = screen.getByRole('button', { name: '批准' });
    fireEvent.click(trigger);
    const requested = screen.getByText(/已请求.*尚未执行/);
    fireEvent.keyDown(requested, { key: 'Escape' });

    expect(screen.queryByText(/已请求.*尚未执行/)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reject reason 必填:空原因提交被 RJSF 拦截(不发请求),填写后带 reason 提交', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, activationEntity('pending-approval')))
      .mockResolvedValueOnce(jsonResponse(200, { entity: activationEntity('rejected') }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ActivationView id="a1" entity={activationEntity('pending-approval')} />);

    // D50:驳回表单默认收起,先打开;空原因:RJSF required 校验拦截,不产生任何请求。
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    fireEvent.click(submitButton('reject'));
    await waitFor(() => expect(screen.getByText(/reason|原因|required/i)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();

    // 填写原因后先进入 high-risk 请求态，再确认提交 params.reason。
    fireEvent.change(screen.getByLabelText(/原因/), { target: { value: 'pin 动作不该无 guard' } });
    fireEvent.click(submitButton('reject'));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并执行驳回' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      rel: 'meta/activation:a1',
      action: 'reject',
      params: { reason: 'pin 动作不该无 guard' },
    });
  });

  it('已决策(approved)是审计视图:无 approve/reject 按钮,决策者留痕可见', () => {
    render(<ActivationView id="a1" entity={activationEntity('approved')} />);
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
    expect(screen.queryByRole('button', { name: '驳回' })).toBeNull();
    // requested-by(agent 提议)与 approved-by(human 决策)都留在审计视图。
    expect(screen.getAllByText(/user:mike/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/approved-by/)).toBeTruthy();
  });
});
