// @vitest-environment jsdom
/**
 * BIOS 定义查看面(T4 Phase C Task 2;T13 Phase A 增拓扑区;spec 架构决定 7/1):
 * - meta/flow:<name>:拓扑区(只读图)+ 属性(name/version/status/initial/
 *   terminal)+ 节点表 + 动作表(name/to/guards/requires-confirmation/effect)+
 *   字段表——全部来自 Siren 投影,零业务分支、零 AI;
 * - meta/self 复用同一组件(definition-lifecycle 的状态机视图:拓扑 + 节点/动作
 *   表 + 种子 guard 集)。
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { stubBrowserApis } from '@/test/browser-stubs';

import { FlowDefinitionView } from './flow-definition-view';

// React Flow 在浏览器依赖 ResizeObserver/DOMMatrixReadOnly——jsdom 缺失,
// 统一注入极简 stub(同 flow 词条测试口径)。
stubBrowserApis();

// ---- fixtures(形状与 projectFlowDefinition / projectSelf 投影一致)---------

const postStatusEntity: SirenEntity = {
  class: ['meta', 'flow-definition'],
  properties: {
    name: 'post-status',
    version: 1,
    status: 'active',
    initial: 'published',
    terminal: ['offline', 'archived'],
  },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/flow:post-status' }],
  'guard-results': [],
  entities: [
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'published', title: '已发布' },
      actions: [],
      links: [],
      entities: [
        {
          class: ['meta', 'action-definition'],
          rel: ['action'],
          properties: {
            name: 'archive',
            title: '归档',
            method: 'POST',
            to: 'archived',
            guards: [],
            'requires-confirmation': 'high',
            effect: [{ type: 'transition', to: 'archived' }],
            fields: [{ name: 'note', type: 'text', required: true, semantics: 'intent' }],
          },
          actions: [],
          links: [],
        },
      ],
    },
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'offline', title: '下线' },
      actions: [],
      links: [],
      entities: [],
    },
  ],
};

const selfEntity: SirenEntity = {
  class: ['meta', 'flow-definition'],
  properties: {
    name: 'definition-lifecycle',
    version: 1,
    status: 'active',
    initial: 'draft',
    terminal: ['rejected', 'deprecated'],
    guards: ['is-draft', 'is-active', 'actor-is-human'],
  },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/self' }],
  'guard-results': [],
  entities: [
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'pending-approval', title: '待批准' },
      actions: [],
      links: [],
      entities: [
        {
          class: ['meta', 'action-definition'],
          rel: ['action'],
          properties: {
            name: 'approve',
            title: '批准',
            method: 'POST',
            to: 'active',
            guards: ['actor-is-human'],
          },
          actions: [],
          links: [],
        },
      ],
    },
  ],
};

afterEach(cleanup);

describe('FlowDefinitionView(定义查看,纯文本表格)', () => {
  it('属性表:name/version/status/initial/terminal', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    expect(container.querySelector('h1')!.textContent).toBe('post-status');
    const terminalRow = [...container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent === 'terminal',
    )!;
    expect(terminalRow.textContent).toContain('offline');
    expect(terminalRow.textContent).toContain('archived');
    const statusRow = [...container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent === 'status',
    )!;
    expect(statusRow.textContent).toContain('active');
  });

  it('节点表与动作表:节点标题、动作 to/guards/requires-confirmation/effect 可见', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    // 节点行(限定节点表段:拓扑区同现节点 title,段外不查)。
    const nodeSection = container.querySelector<HTMLElement>('section[aria-label="节点"]')!;
    expect(within(nodeSection).getByText('已发布')).toBeTruthy();
    expect(within(nodeSection).getByText('下线')).toBeTruthy();
    // 动作行(按动作名格精确定位,不与属性表 terminal 相混):archive → archived,
    // guards 空数组,requires-confirmation=high,effect 原文。
    const row = [...container.querySelectorAll('tr')].find((tr) =>
      [...tr.querySelectorAll('td')].some((td) => td.textContent === 'archive'),
    )!;
    expect(row.textContent).toContain('archived');
    expect(row.textContent).toContain('[]');
    expect(row.textContent).toContain('high');
    expect(row.textContent).toContain('"type":"transition"');
  });

  it('字段表:动作字段(name/type/required/semantics)逐行可见', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const row = [...container.querySelectorAll('tr')].find(
      (tr) => tr.textContent?.includes('note') === true,
    )!;
    expect(row.textContent).toContain('text');
    expect(row.textContent).toContain('intent');
  });

  it('拓扑区(T13 Phase A):表格之上的只读拓扑图,节点 title 可见', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const topology = container.querySelector<HTMLElement>('section[aria-label="拓扑"]')!;
    expect(topology).not.toBeNull();
    expect(topology.querySelector('[data-topology="flow"]')).not.toBeNull();
    // 节点 title 出现于拓扑区(jsdom 无测量、边不真实渲染;边/只读口径见
    // flow-topology-view.test.tsx,真实浏览器渲染由 e2e 覆盖)。
    expect(topology.textContent).toContain('已发布');
    expect(topology.textContent).toContain('下线');
    // 视觉层级:拓扑区在属性表之前(spec 架构决定 1「既有表格之上」)。
    const sections = [...container.querySelectorAll('section')].map((section) =>
      section.getAttribute('aria-label'),
    );
    expect(sections.indexOf('拓扑')).toBeLessThan(sections.indexOf('属性'));
  });

  it('meta/self 复用:状态机文本视图 + 种子 guard 集(approve 声明 actor-is-human)', () => {
    const { container } = render(<FlowDefinitionView rel="meta/self" entity={selfEntity} />);
    expect(container.querySelector('h1')!.textContent).toBe('definition-lifecycle');
    const initialRow = [...container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent === 'initial',
    )!;
    expect(initialRow.textContent).toContain('draft');
    // 种子 guard 集(属性表)与动作声明(guards 列)两处可见。
    expect(screen.getAllByText(/actor-is-human/).length).toBeGreaterThanOrEqual(2);
    // 节点 title(限定节点表段:拓扑区同现,段外不查)。
    const nodeSection = container.querySelector<HTMLElement>('section[aria-label="节点"]')!;
    expect(within(nodeSection).getByText('待批准')).toBeTruthy();
    // meta/self 同形投影:拓扑区同样渲染(definition-lifecycle 节点 title)。
    const topology = container.querySelector<HTMLElement>('section[aria-label="拓扑"]')!;
    expect(topology.textContent).toContain('待批准');
  });
});
