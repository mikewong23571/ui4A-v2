/**
 * BIOS flow 拓扑推导(T13 Phase A;spec 架构决定 1):meta/flow 投影实体 →
 * flow 词条同形的 graph 数据 + 确定性分层布局。
 *
 * - 输入选 **投影实体(SirenEntity)** 而非 FlowDefinition:BIOS 页面
 *   (FlowDefinitionBody)经 useMetaEntity 拿到的就是 flow-definition 投影
 *   (node/action 子实体,meta/self 同形),无需另开原始定义取数通道;
 * - 边经 shared 的 flowEdges 推导(与引擎 terminal/可达性同一口径,含
 *   action.to 缺省回退单条 transition 效果):先把子实体声明还原成
 *   FlowDefinition 再调用,不复制推导逻辑;
 * - 布局复用 T7 flow 词条的 layeredLayout(BFS 深度 × 层内声明序,同输入
 *   同布局)——其输入契约即 graph 实体的 properties.nodes/edges
 *   (graphPayload 校验),拓扑数据原样包成 graph 实体传入,词条零改动;
 * - 形状非法响亮抛错(缺数据不造数据,同 graphPayload 口径);渲染零 AI。
 */
import type { SirenEntity } from '@ui4a/engine';
import { flowEdges, type ActionDefinition, type FlowDefinition } from '@ui4a/shared';

import { layeredLayout } from '@/render/words/flow';

/** flow 拓扑 graph 数据(与 flow 词条 graph 载荷同形:id/from/to + label)。 */
export interface FlowTopology {
  nodes: Array<{ id: string; label?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 动作子实体 → ActionDefinition(flowEdges 只读 name/to/effect;声明全文投影不裁剪)。 */
function actionDefinitionOf(entity: SirenEntity, nodeName: string): ActionDefinition {
  const { name, title, to, effect } = entity.properties;
  if (typeof name !== 'string' || typeof title !== 'string') {
    throw new Error(`flow 拓扑推导:节点 "${nodeName}" 的动作声明缺 name/title(字符串)`);
  }
  if (to !== undefined && typeof to !== 'string') {
    throw new Error(`flow 拓扑推导:动作 "${name}" 的 to 不是字符串`);
  }
  if (
    effect !== undefined &&
    !isRecord(effect) &&
    !(Array.isArray(effect) && effect.every(isRecord))
  ) {
    throw new Error(`flow 拓扑推导:动作 "${name}" 的 effect 形状非法`);
  }
  return {
    name,
    title,
    ...(to !== undefined ? { to } : {}),
    // effect 经上方守卫收紧为声明原文(record/数组);flowEdges 内部再按
    // transition 形状谓词判断,不读其他字段。
    ...(effect !== undefined ? { effect: effect as ActionDefinition['effect'] } : {}),
  };
}

/** 节点子实体 → NodeDefinition(title 缺省回退 name,与投影 projectNodeDefinition 同口径)。 */
function nodeDefinitionOf(entity: SirenEntity): FlowDefinition['nodes'][number] {
  const { name, title } = entity.properties;
  if (typeof name !== 'string') {
    throw new Error('flow 拓扑推导:节点声明缺 name(字符串)');
  }
  return {
    name,
    title: typeof title === 'string' ? title : name,
    actions: (entity.entities ?? []).map((action) => actionDefinitionOf(action, name)),
  };
}

/** flow-definition 投影实体 → FlowDefinition(还原声明;缺投影要件即抛)。 */
function flowDefinitionOf(entity: SirenEntity): FlowDefinition {
  const { name, initial } = entity.properties;
  if (typeof name !== 'string' || typeof initial !== 'string' || !Array.isArray(entity.entities)) {
    throw new Error(
      'flow 拓扑推导:实体不是 flow-definition 投影(缺 name/initial 属性或节点子实体)',
    );
  }
  // 子实体按 class 选择:节点声明(node-definition)之外还有版本摘要
  // (definition-version,T13 Phase B)——拓扑只还原节点,版本子实体不参与。
  return {
    name,
    initial,
    nodes: entity.entities
      .filter((sub) => sub.class.includes('node-definition'))
      .map(nodeDefinitionOf),
  };
}

/**
 * flow-definition 投影实体 → graph 数据:全部节点按声明序(label=节点 title),
 * 边按声明序(label=action 名;孤立/terminal 节点无出边但节点不丢)。
 */
export function flowTopology(entity: SirenEntity): FlowTopology {
  const definition = flowDefinitionOf(entity);
  return {
    nodes: definition.nodes.map((node) => ({ id: node.name, label: node.title ?? node.name })),
    edges: flowEdges(definition).map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.action,
    })),
  };
}

/** 拓扑的确定性分层布局(复用 flow 词条 layeredLayout;同输入同坐标)。 */
export function flowTopologyLayout(topology: FlowTopology): Map<string, { x: number; y: number }> {
  return layeredLayout({
    class: [],
    properties: { nodes: topology.nodes, edges: topology.edges },
    actions: [],
    links: [],
  });
}
