// @vitest-environment jsdom
/**
 * BIOS 能力详情面(T13 Phase C Task 3;spec 架构决定 3):
 * meta/capability:<name> 属性投影渲染——属性表形状(name/title/kind/intent/
 * input/output 原样键值),只读零动作按钮;取数状态机 404/异常如实呈现。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { CapabilityDefinitionBody, CapabilityDefinitionView } from './capability-definition-view';

const draftEntity: SirenEntity = {
  class: ['meta', 'capability-definition'],
  properties: {
    name: 'draft',
    title: '工件起草',
    kind: 'extract',
    intent: '价值载体字段的草稿工件起草。',
    input: '字段语义与上下文工件。',
    output: '草稿工件候选集。',
  },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/capability:draft' }],
  'guard-results': [],
};

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

describe('CapabilityDefinitionView(纯渲染)', () => {
  it('属性表呈现 name/title/kind/intent/input/output;只读零动作按钮', () => {
    render(<CapabilityDefinitionView rel="meta/capability:draft" entity={draftEntity} />);
    // 标题(heading)与属性表单元格同文,分别断言。
    expect(screen.getByRole('heading', { name: '工件起草' })).toBeTruthy();
    for (const text of [
      'draft',
      'extract',
      '价值载体字段的草稿工件起草。',
      '字段语义与上下文工件。',
      '草稿工件候选集。',
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    // title 值同时是 heading,属性表行也在场(两处以上)。
    expect(screen.getAllByText('工件起草').length).toBeGreaterThanOrEqual(2);
    // 属性键同样可见(属性表形状:键值两列)。
    for (const key of ['name', 'title', 'kind', 'intent', 'input', 'output']) {
      expect(screen.getByText(key)).toBeTruthy();
    }
    expect(screen.getByText('meta/capability:draft')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('CapabilityDefinitionBody(取数状态机)', () => {
  it('ready:请求 /_meta/api/entity?rel=meta/capability:<name> 并渲染属性', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, draftEntity));
    vi.stubGlobal('fetch', fetchMock);
    render(<CapabilityDefinitionBody rel="meta/capability:draft" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '工件起草' })).toBeTruthy());
    expect(fetchMock.mock.calls[0]![0]).toBe('/_meta/api/entity?rel=meta%2Fcapability%3Adraft');
  });

  it('404 → missing 提示(能力不存在);不造数据', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: '实体不存在' })),
    );
    render(<CapabilityDefinitionBody rel="meta/capability:ghost" />);
    await waitFor(() => expect(screen.getByText(/不存在/)).toBeTruthy());
    expect(screen.queryByRole('button')).toBeNull();
  });
});
