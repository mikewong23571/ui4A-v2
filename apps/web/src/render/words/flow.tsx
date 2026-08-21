'use client';
/**
 * flow 词条(T7 Phase B / 选型 §6):React Flow 渲染流程拓扑。
 *
 * - graph = 实体引用的解引用结果;拓扑来自实体数据(properties.nodes/
 *   edges——XState 图谱或 sitemap 拓扑,词条只做投影);
 * - layeredLayout:确定性分层布局(BFS 深度 × 层内声明序)——同输入同布局,
 *   重放一致(快照对拍可断言节点位置)。
 */
import { ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { SirenEntity } from '@ui4a/engine';

import { asEntity, type WordProps } from './shared';

import '@xyflow/react/dist/style.css';

/** 层间距/行间距(确定性布局参数)。 */
const LAYER_X = 220;
const ROW_Y = 96;

interface GraphNodeData {
  id: string;
  label?: string;
}

interface GraphEdgeData {
  from: string;
  to: string;
  label?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 拓扑载荷解析(缺 nodes/edges 或形状非法 → 响亮抛错,缺数据不造数据)。 */
export function graphPayload(graph: SirenEntity): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const { nodes, edges } = graph.properties;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !nodes.every(isRecord)) {
    throw new Error(
      '词条 flow 的 graph 实体缺拓扑载荷(properties.nodes/edges 数组——XState 图谱或 sitemap 拓扑)',
    );
  }
  const parsedEdges = edges.filter(isRecord).map((edge) => edge as unknown as GraphEdgeData);
  if (!parsedEdges.every((edge) => typeof edge.from === 'string' && typeof edge.to === 'string')) {
    throw new Error('词条 flow 的 graph 边载荷缺 from/to(字符串)');
  }
  const parsedNodes = nodes.filter(isRecord).map((node) => node as unknown as GraphNodeData);
  if (!parsedNodes.every((node) => typeof node.id === 'string')) {
    throw new Error('词条 flow 的 graph 节点载荷缺 id(字符串)');
  }
  return { nodes: parsedNodes, edges: parsedEdges };
}

/** 确定性分层布局:BFS 深度分层,层内按节点声明序;孤立节点归第 0 层。 */
export function layeredLayout(graph: SirenEntity): Map<string, { x: number; y: number }> {
  const { nodes, edges } = graphPayload(graph);
  const depthOf = (start: string): Map<string, number> => {
    const depths = new Map<string, number>([[start, 0]]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.from === current && !depths.has(edge.to)) {
          depths.set(edge.to, depths.get(current)! + 1);
          queue.push(edge.to);
        }
      }
    }
    return depths;
  };
  // 多起点(无入边的节点)BFS 取最小深度;有环/全入边的节点保底深度 0。
  const depths = new Map<string, number>();
  const roots = nodes
    .map((node) => node.id)
    .filter((id) => !edges.some((edge) => edge.to === id));
  const sources = roots.length > 0 ? roots : nodes.slice(0, 1).map((node) => node.id);
  for (const source of sources) {
    for (const [id, depth] of depthOf(source)) {
      depths.set(id, Math.min(depths.get(id) ?? Number.MAX_SAFE_INTEGER, depth));
    }
  }
  const perLayer = new Map<number, number>();
  const layout = new Map<string, { x: number; y: number }>();
  nodes.forEach((node) => {
    const depth = depths.get(node.id) ?? 0;
    const row = perLayer.get(depth) ?? 0;
    perLayer.set(depth, row + 1);
    layout.set(node.id, { x: depth * LAYER_X, y: row * ROW_Y });
  });
  return layout;
}

export function FlowWord(props: WordProps) {
  const graph = asEntity(props.graph, 'flow', 'graph');
  const { nodes, edges } = graphPayload(graph);
  const layout = layeredLayout(graph);

  const flowNodes: Node[] = nodes.map((node) => ({
    id: node.id,
    position: layout.get(node.id) ?? { x: 0, y: 0 },
    data: { label: node.label ?? node.id },
  }));
  const flowEdges: Edge[] = edges.map((edge, index) => ({
    id: `e${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
  }));

  return (
    <div data-word="flow" className="h-72 w-full rounded-md border border-zinc-200 bg-zinc-50">
      <ReactFlow nodes={flowNodes} edges={flowEdges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} />
    </div>
  );
}
