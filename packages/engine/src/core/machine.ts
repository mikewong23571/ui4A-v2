/**
 * machine-as-JSON → XState v5 运行时构造与转移校验。
 *
 * 引擎不长期驻留 actor:每次校验从 flow 常量重建 machine,
 * 以 `resolveState` + `snapshot.can` 做纯函数式的转移合法性判断
 * (spec 架构决定 3:转移合法性用 createMachine(config) 运行时构造校验)。
 */
import { createMachine } from 'xstate';

import type { ActionDefinition, FlowDefinition } from './types';

function hasTarget(action: ActionDefinition): action is ActionDefinition & { to: string } {
  return action.to !== undefined;
}

/** flow 常量 → XState machine config(动作名即事件名,meta 携带节点标题)。 */
export function toMachineConfig(flow: FlowDefinition): {
  id: string;
  initial: string;
  states: Record<
    string,
    {
      meta: { title: string };
      on: Record<string, { target: string }>;
    }
  >;
} {
  return {
    id: flow.name,
    initial: flow.initial,
    states: Object.fromEntries(
      flow.nodes.map((node) => [
        node.name,
        {
          meta: { title: node.title ?? node.name },
          on: Object.fromEntries(
            node.actions.filter(hasTarget).map((action) => [action.name, { target: action.to }]),
          ),
        },
      ]),
    ),
  };
}

/** 由 flow 定义构造的 XState 状态机(类型由 config 推断)。 */
export type FlowMachine = ReturnType<typeof createFlowMachine>;

export function createFlowMachine(flow: FlowDefinition) {
  return createMachine(toMachineConfig(flow));
}

/**
 * `from` 节点上是否存在可用动作把实例迁到 `to` 节点。
 * 合法性由 machine 运行时裁决:`resolveState` 还原快照后逐动作 `can(event)`。
 */
export function canTransition(flow: FlowDefinition, from: string, to: string): boolean {
  const node = flow.nodes.find((candidate) => candidate.name === from);
  if (!node) return false;
  if (!flow.nodes.some((candidate) => candidate.name === to)) return false;
  const machine = createFlowMachine(flow);
  const state = machine.resolveState({ value: from, context: undefined });
  return node.actions.some((action) => action.to === to && state.can({ type: action.name }));
}

/** 动作事件在当前节点是否可用(供裁决层/投影层复核声明性)。 */
export function canSendEvent(flow: FlowDefinition, node: string, actionName: string): boolean {
  if (!flow.nodes.some((candidate) => candidate.name === node)) return false;
  const machine = createFlowMachine(flow);
  return machine.resolveState({ value: node, context: undefined }).can({ type: actionName });
}
