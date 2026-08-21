// @vitest-environment jsdom
/**
 * BIOS 页面主体取数状态机(T4 Phase C Phase Verification units):
 * ActivationPageBody / FlowDefinitionBody 的 404(missing)与 ready 路径。
 * 纯视图与列表主体已各有组件测试;此处补齐剩余 Web 改动文件的对应测试
 * (workflow Step 2:Phase 变更逐文件覆盖)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { ActivationPageBody } from './activation-view';
import { FlowDefinitionBody } from './flow-definition-view';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const flowEntity: SirenEntity = {
  class: ['meta', 'flow-definition'],
  properties: { name: 'post-status', version: 1, status: 'active', initial: 'published', terminal: ['archived'] },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/flow:post-status' }],
  'guard-results': [],
  entities: [],
};

const approvedActivation: SirenEntity = {
  class: ['meta', 'activation', 'approved'],
  properties: {
    id: 'a1',
    flow: 'post-status',
    status: 'approved',
    version: 2,
    artifact: 'fnv1',
    checks: [{ name: 'edge-targets-exist', pass: true }],
    'requested-by': { actor: 'agent' },
    'approved-by': { actor: 'human' },
  },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/activation:a1' }],
  'guard-results': [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ActivationPageBody(取数状态机)', () => {
  it('ready:已决策激活渲染审计视图(approved-by 留痕,无审批按钮)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, approvedActivation)));
    render(<ActivationPageBody id="a1" />);
    await waitFor(() => expect(screen.getByText(/approved-by/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
  });

  it('404 → missing 提示(激活不存在)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: '实体不存在' })),
    );
    render(<ActivationPageBody id="ghost" />);
    await waitFor(() => expect(screen.getByText(/不存在/)).toBeTruthy());
  });

  it('服务异常 → error 提示(读取激活失败)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { error: 'db' })));
    render(<ActivationPageBody id="a1" />);
    await waitFor(() => expect(screen.getByText(/读取激活失败/)).toBeTruthy());
  });
});

describe('FlowDefinitionBody(取数状态机)', () => {
  it('ready:定义详情渲染(属性表可见),请求打 meta/flow:<name>', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, flowEntity));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<FlowDefinitionBody rel="meta/flow:post-status" />);
    await waitFor(() => expect(screen.getByText('archived')).toBeTruthy());
    expect(fetchMock.mock.calls[0]![0]).toBe('/_meta/api/entity?rel=meta%2Fflow%3Apost-status');
    expect(container.querySelector('h1')!.textContent).toBe('post-status');
  });

  it('404 → missing 提示(定义不存在)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: '实体不存在' })),
    );
    render(<FlowDefinitionBody rel="meta/flow:ghost" />);
    await waitFor(() => expect(screen.getByText(/定义 "meta\/flow:ghost" 不存在/)).toBeTruthy());
  });
});
