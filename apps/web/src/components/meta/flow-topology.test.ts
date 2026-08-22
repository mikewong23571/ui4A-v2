/**
 * BIOS flow 拓扑推导(T13 Phase A Task 1,TDD 红→绿;spec 架构决定 1):
 * - 输入 = meta/flow 投影实体(SirenEntity,node/action 子实体;FlowDefinitionBody
 *   经 useMetaEntity 拿到的同一对象,meta/self 同形);
 * - 输出 = flow 词条同形 graph 数据(节点 label=title,边 label=action 名,
 *   边经 shared flowEdges 推导)+ 复用 T7 layeredLayout 的确定性布局;
 * - 真实 seed(article-drafting,含循环边 publish→basic-info,D11)断言全拓扑;
 *   孤立/terminal 节点口径与 flow 词条一致(同一布局函数)。
 */
import type { SirenEntity } from '@ui4a/engine';
import type { FlowDefinition } from '@ui4a/shared';
import { describe, expect, it } from 'vitest';

import { articleDraftingFlow } from '@/domain/flows';

import { flowTopology, flowTopologyLayout } from './flow-topology';

// ---- fixtures(形状镜像 packages/engine/src/siren.ts 的 projectNodeDefinition /
//      actionDefinitionProperties:节点子实体 {name,title},动作子实体声明全文)----

function definitionEntityOf(flow: FlowDefinition): SirenEntity {
  return {
    class: ['meta', 'flow-definition'],
    properties: {
      name: flow.name,
      version: 1,
      status: 'active',
      initial: flow.initial,
      terminal: [],
    },
    actions: [],
    links: [],
    entities: flow.nodes.map((node) => ({
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: node.name, title: node.title ?? node.name },
      actions: [],
      links: [],
      entities: node.actions.map((action) => ({
        class: ['meta', 'action-definition'],
        rel: ['action'],
        properties: {
          ...action,
          method: action.method ?? 'POST',
          effect:
            action.effect === undefined
              ? []
              : Array.isArray(action.effect)
                ? action.effect
                : [action.effect],
        },
        actions: [],
        links: [],
      })),
    })),
  };
}

describe('flowTopology(flow-definition 投影 → graph 数据)', () => {
  it('真实 seed article-drafting:节点/边齐全,label 正确(含循环边 publish→basic-info)', () => {
    const topology = flowTopology(definitionEntityOf(articleDraftingFlow));

    // 全部节点按声明序,label 取节点 title。
    expect(topology.nodes).toEqual([
      { id: 'basic-info', label: '基本信息' },
      { id: 'classification', label: '分类' },
      { id: 'content', label: '正文' },
      { id: 'ready', label: '就绪' },
      { id: 'done', label: '完成' },
    ]);
    // 全部边按声明序,label 取 action 名;publish→basic-info 为循环边(D11)。
    expect(topology.edges).toEqual([
      { from: 'basic-info', to: 'classification', label: 'next' },
      { from: 'basic-info', to: 'done', label: 'abandon' },
      { from: 'classification', to: 'content', label: 'next' },
      { from: 'content', to: 'ready', label: 'next' },
      { from: 'ready', to: 'basic-info', label: 'publish' },
    ]);
  });

  it('非 flow-definition 投影(缺节点子实体)→ 响亮抛错(缺数据不造数据)', () => {
    const notDefinition: SirenEntity = {
      class: ['meta', 'flow-definition'],
      properties: { name: 'x', initial: 'x' },
      actions: [],
      links: [],
    };
    expect(() => flowTopology(notDefinition)).toThrow(/flow-definition/);
  });

  it('节点/动作声明缺 name → 响亮抛错', () => {
    const brokenNode = definitionEntityOf(articleDraftingFlow);
    brokenNode.entities![0].properties = { title: '缺名节点' };
    expect(() => flowTopology(brokenNode)).toThrow(/节点/);

    const brokenAction = definitionEntityOf(articleDraftingFlow);
    brokenAction.entities![0].entities![0].properties = { title: '缺名动作' };
    expect(() => flowTopology(brokenAction)).toThrow(/动作/);
  });
});

describe('flowTopologyLayout(复用 T7 layeredLayout 确定性分层)', () => {
  it('循环图(article-drafting):全入边保底起点 + BFS 深度 × 层内声明序', () => {
    const topology = flowTopology(definitionEntityOf(articleDraftingFlow));
    const layout = flowTopologyLayout(topology);

    // 循环图无零入边节点 → 保底以首个声明节点为源:basic-info 深度 0。
    expect(layout.get('basic-info')).toEqual({ x: 0, y: 0 });
    expect(layout.get('classification')).toEqual({ x: 220, y: 0 });
    expect(layout.get('done')).toEqual({ x: 220, y: 96 });
    expect(layout.get('content')).toEqual({ x: 440, y: 0 });
    expect(layout.get('ready')).toEqual({ x: 660, y: 0 });
    // 确定性:同输入同坐标(两次调用全等)。
    expect(flowTopologyLayout(topology)).toEqual(layout);
  });

  it('孤立节点归第 0 层、terminal 节点照常分层(与 flow 词条口径一致)', () => {
    const flow: FlowDefinition = {
      name: 'isolated-fixture',
      initial: 'a',
      nodes: [
        { name: 'a', title: '起点', actions: [{ name: 'next', title: '下一步', to: 'b' }] },
        // terminal:有入边、无出边。
        { name: 'b', title: '终点', actions: [] },
        // 孤立:无入边亦无出边。
        { name: 'c', title: '孤岛', actions: [] },
      ],
    };
    const topology = flowTopology(definitionEntityOf(flow));

    // 孤立/terminal 节点均不丢,孤立节点不产生边。
    expect(topology.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(topology.edges).toEqual([{ from: 'a', to: 'b', label: 'next' }]);

    const layout = flowTopologyLayout(topology);
    expect(layout.get('a')).toEqual({ x: 0, y: 0 });
    expect(layout.get('b')).toEqual({ x: 220, y: 0 });
    // 孤立节点与起点同层(深度 0),层内按声明序排第二行。
    expect(layout.get('c')).toEqual({ x: 0, y: 96 });
  });
});
