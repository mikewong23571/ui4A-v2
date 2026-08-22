'use client';
/**
 * BIOS flow 拓扑图(T13 Phase A Task 2;spec 架构决定 1):flow-definition
 * 投影的只读拓扑渲染。
 *
 * - 数据:flowTopology(投影实体 → graph 数据,节点 label=title、边
 *   label=action 名)+ flowTopologyLayout(复用 T7 layeredLayout,BFS 深度
 *   × 层内声明序,同输入同布局);渲染复用 flow 词条同一 @xyflow/react
 *   组件,不经词条注册表/deref 通道——零新依赖;
 * - 只读投影:nodesDraggable/nodesConnectable/elementsSelectable 全关,仅
 *   保留缩放/平移走查;不做拖拽编辑,编辑仍走合同动词(D19-7);
 * - 渲染零 AI(铁律 5):纯机械投影,不引入任何 AI/LLM 依赖(源级断言见
 *   diff-render.test.tsx)。
 */
import { ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { SirenEntity } from '@ui4a/engine';

import { flowTopology, flowTopologyLayout } from './flow-topology';

import '@xyflow/react/dist/style.css';

export interface FlowTopologyViewProps {
  entity: SirenEntity;
}

/** flow-definition 投影的只读拓扑图(节点=title,边=action 名;确定性布局)。 */
export function FlowTopologyView({ entity }: FlowTopologyViewProps) {
  const topology = flowTopology(entity);
  const layout = flowTopologyLayout(topology);

  const flowNodes: Node[] = topology.nodes.map((node) => ({
    id: node.id,
    position: layout.get(node.id) ?? { x: 0, y: 0 },
    data: { label: node.label ?? node.id },
  }));
  const flowEdges: Edge[] = topology.edges.map((edge, index) => ({
    id: `e${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
  }));

  return (
    <div data-topology="flow" className="h-72 w-full rounded-md border border-border bg-muted/50">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}
