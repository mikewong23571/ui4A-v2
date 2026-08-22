// @vitest-environment jsdom
/**
 * BIOS flow 拓扑图组件(T13 Phase A Task 2,TDD 红→绿;spec 架构决定 1):
 * - 拓扑区可见:section 容器 + ReactFlow 挂载;节点标注 title、边标注 action
 *   名——经 mock 捕获的 ReactFlow 载荷断言(jsdom 无 ResizeObserver 测量,
 *   边不真实渲染,与 flow 词条测试同一口径;真实浏览器渲染由 e2e 覆盖);
 * - 只读投影:nodesDraggable/nodesConnectable/elementsSelectable 全 false,
 *   缩放/平移保留(不设 false);布局确定性——同输入同坐标(两次渲染全等);
 * - 渲染零 AI(铁律 5):源级断言挂 diff-render.test.tsx 的既有名单。
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactFlowProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { FlowTopologyView } from './flow-topology-view';

let mockReactFlowProps: ReactFlowProps | undefined;

// jsdom 无法测量节点(ResizeObserver 桩),真实 ReactFlow 不渲染边;mock 捕获
// 载荷,断言组件交给 ReactFlow 的节点/边标注与只读配置。
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: ReactFlowProps) => {
    mockReactFlowProps = props;
    const nodes = props.nodes ?? [];
    const edges = props.edges ?? [];
    return (
      <div data-mock="reactflow">
        {nodes.map((node) => (
          <div key={node.id} data-mock-node={node.id}>
            {String(node.data.label)}
          </div>
        ))}
        {edges.map((edge) => (
          <div key={edge.id} data-mock-edge={edge.id}>
            {String(edge.label)}
          </div>
        ))}
      </div>
    );
  },
}));

// ---- fixture(形状与 projectFlowDefinition 投影一致:节点 {name,title} +
//      动作子实体声明全文)------------------------------------------------

const reviewFlowEntity: SirenEntity = {
  class: ['meta', 'flow-definition'],
  properties: {
    name: 'review-flow',
    version: 1,
    status: 'active',
    initial: 'draft',
    terminal: ['done'],
  },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/flow:review-flow' }],
  entities: [
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'draft', title: '草稿' },
      actions: [],
      links: [],
      entities: [
        {
          class: ['meta', 'action-definition'],
          rel: ['action'],
          properties: { name: 'submit', title: '提交', method: 'POST', to: 'review' },
          actions: [],
          links: [],
        },
      ],
    },
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'review', title: '审核' },
      actions: [],
      links: [],
      entities: [
        {
          class: ['meta', 'action-definition'],
          rel: ['action'],
          properties: { name: 'approve', title: '批准', method: 'POST', to: 'done' },
          actions: [],
          links: [],
        },
      ],
    },
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'done', title: '完成' },
      actions: [],
      links: [],
      entities: [],
    },
  ],
};

beforeEach(() => {
  mockReactFlowProps = undefined;
});

afterEach(cleanup);

describe('FlowTopologyView(BIOS 只读拓扑图)', () => {
  it('拓扑区可见:容器挂载 ReactFlow,节点按 title 标注', () => {
    const { container } = render(<FlowTopologyView entity={reviewFlowEntity} />);

    expect(container.querySelector('[data-topology="flow"]')).not.toBeNull();
    const labels = (mockReactFlowProps?.nodes ?? []).map((node) => node.data.label);
    expect(labels).toEqual(['草稿', '审核', '完成']);
    // mock DOM 中节点 title 文本可见。
    expect(screen.getByText('草稿')).toBeTruthy();
    expect(screen.getByText('审核')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
  });

  it('边按 action 名标注,拓扑方向来自声明(to/transition)', () => {
    render(<FlowTopologyView entity={reviewFlowEntity} />);

    const edges = mockReactFlowProps?.edges ?? [];
    expect(
      edges.map((edge) => ({ source: edge.source, target: edge.target, label: edge.label })),
    ).toEqual([
      { source: 'draft', target: 'review', label: 'submit' },
      { source: 'review', target: 'done', label: 'approve' },
    ]);
    expect(screen.getByText('submit')).toBeTruthy();
    expect(screen.getByText('approve')).toBeTruthy();
  });

  it('只读配置:拖拽/连线/选中全关,缩放/平移保留(不设 false)', () => {
    render(<FlowTopologyView entity={reviewFlowEntity} />);

    expect(mockReactFlowProps?.nodesDraggable).toBe(false);
    expect(mockReactFlowProps?.nodesConnectable).toBe(false);
    expect(mockReactFlowProps?.elementsSelectable).toBe(false);
    // 缩放/平移走查保留(ReactFlow 默认开;组件不得显式关闭)。
    expect(mockReactFlowProps?.zoomOnScroll).not.toBe(false);
    expect(mockReactFlowProps?.panOnDrag).not.toBe(false);
    expect(mockReactFlowProps?.fitView).toBe(true);
  });

  it('布局确定性:同输入同坐标(BFS 深度 × 层内声明序,复用 T7 layeredLayout)', () => {
    render(<FlowTopologyView entity={reviewFlowEntity} />);
    const positions = new Map<string, { x: number; y: number }>(
      (mockReactFlowProps?.nodes ?? []).map((node) => [node.id, node.position]),
    );
    expect(positions.get('draft')).toEqual({ x: 0, y: 0 });
    expect(positions.get('review')).toEqual({ x: 220, y: 0 });
    expect(positions.get('done')).toEqual({ x: 440, y: 0 });

    cleanup();
    render(<FlowTopologyView entity={reviewFlowEntity} />);
    const again = new Map<string, { x: number; y: number }>(
      (mockReactFlowProps?.nodes ?? []).map((node) => [node.id, node.position]),
    );
    expect(again).toEqual(positions);
  });
});
