/**
 * fold 投影:事件日志 → 引擎快照的纯函数(arch-brief §4 事件溯源)。
 *
 * "当前 UI 状态 = 日志折叠后的物化状态";应用核心是日志的纯函数(I5 的根基)。
 * 与在线路径同构:在线 exec = judge(裁决) → applyEffects(效果) → appendEvent(s) →
 * 增量持有新快照;重放 = fold(全部事件) —— 每条 action-executed 事件还原成
 * ExecRequest 后重放同一个 applyEffects(同一 flow 常量、同一效果词汇表),
 * 两条路径产出相同快照(由 I5 集成测试以内容 hash 断言)。
 *
 * 放在 engine(而非 web service 层)的理由:fold 是"应用核心"本体且纯(零 Node API,
 * 两栖),worker(T3 消费 spawn-requested)与任何重放工具都需要它;
 * 日志形状(LogEvent)因此成为引擎公共合同的一部分。
 */
import { fieldValues } from '@ui4a/shared';
import type { EngineSnapshot, InstanceSnapshot } from '@ui4a/shared';

import { applyEffects } from './effects';
import type { EngineEvent } from './effects';
import type { ExecRequest } from './judge';
import { actionEffects } from './parse';
import type { FlowDefinition } from './types';

/** 日志事件种类:引擎产出三种 + 日志层两种(拒绝留痕 I6 / 种子装载)。 */
export type LogEventKind = EngineEvent['kind'] | 'action-rejected' | 'seed';

/**
 * 存储事件(引擎 EngineEvent + 日志层字段)。
 * seq/ts 由日志层分配(时钟是 capability,引擎事件不含二者);
 * reason/detail 由拒绝路径与 seed 装载写入。
 */
export interface LogEvent extends Omit<EngineEvent, 'kind' | 'rel' | 'action' | 'actor'> {
  seq: number;
  /** ISO 时间戳(仅审计;fold 不读它,重放确定性不依赖时钟)。 */
  ts?: string;
  kind: LogEventKind;
  rel?: string;
  action?: string;
  /** 行为者;seed 等事件可缺省(存储层列为 null)。 */
  actor?: 'human' | 'agent';
  reason?: string;
  detail?: unknown;
}

/** seed 事件的 detail 载荷:种子实体与集合(Phase C 启动 seed 写入)。 */
export interface SeedDetail {
  instances: Record<string, InstanceSnapshot>;
  collections?: Record<string, string[]>;
}

/** 由事件参数(带出处)还原 exec 请求的求值输入。 */
function toExecRequest(event: LogEvent): ExecRequest {
  const params = event.params ?? {};
  return {
    rel: event.rel ?? '',
    action: event.action ?? '',
    params: fieldValues(params),
    paramOrigins: Object.fromEntries(
      Object.entries(params).map(([name, entry]) => [name, entry.origin]),
    ),
    actor: event.actor,
    principal: event.principal,
    channel: event.channel,
  };
}

/** seed 合并:只补缺、不覆盖(幂等种子装载;重复 seed 事件无害)。 */
function applySeed(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<SeedDetail> | undefined;
  if (detail === undefined || typeof detail !== 'object' || detail.instances === undefined) {
    throw new Error(`seed 事件(seq=${event.seq})缺少 detail.instances`);
  }
  const instances: EngineSnapshot['instances'] = { ...snapshot.instances };
  for (const [rel, instance] of Object.entries(detail.instances)) {
    if (instances[rel] === undefined) {
      instances[rel] = instance;
    }
  }
  const collections: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(snapshot.collections)) {
    collections[name] = [...members];
  }
  for (const [name, members] of Object.entries(detail.collections ?? {})) {
    const existing = collections[name] ?? [];
    collections[name] = [...existing, ...members.filter((rel) => !existing.includes(rel))];
  }
  return { instances, collections };
}

/**
 * 重放一条 action-executed:按重放位点(flow 常量 × 实例当前节点)查动作声明,
 * 还原求值输入后走同一个 applyEffects。日志与定义漂移时响亮失败(带 seq)——
 * 日志 + 定义 = 完整重放输入,任何缺口都必须被 I5 级测试看见。
 */
function applyExecuted(
  snapshot: EngineSnapshot,
  event: LogEvent,
  flows: Readonly<Record<string, FlowDefinition>>,
): EngineSnapshot {
  const request = toExecRequest(event);
  const where = `seq=${event.seq}(${request.rel}#${request.action})`;

  const instance = snapshot.instances[request.rel];
  if (instance === undefined) {
    throw new Error(`重放失败:${where} 实例不存在(日志与状态漂移)`);
  }
  const flow = flows[instance.flow];
  if (flow === undefined) {
    throw new Error(`重放失败:${where} 流程 "${instance.flow}" 未注册(定义漂移)`);
  }
  const node = flow.nodes.find((candidate) => candidate.name === instance.node);
  if (node === undefined) {
    throw new Error(`重放失败:${where} 节点 "${instance.node}" 不在流程 "${flow.name}" 节点集`);
  }
  const action = node.actions.find((candidate) => candidate.name === request.action);
  if (action === undefined) {
    throw new Error(
      `重放失败:${where} 动作未声明于节点 "${node.name}"(定义与日志漂移)`,
    );
  }

  try {
    return applyEffects(request, actionEffects(action), snapshot, { flows }).snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`重放失败:${where} ${message}`);
  }
}

/**
 * 折叠事件日志为引擎快照(纯函数;events 须按 seq 升序传入)。
 *
 * - action-executed:重放 applyEffects(在线路径同一函数);
 * - action-rejected:不改状态(拒绝即数据,留痕在日志本身,I6);
 * - entity-appended / spawn-requested:伴随事件——状态已由同批 action-executed
 *   重放体现(append 由 applyEffects 落位;spawn 在 T2 不改状态),fold 不双算;
 * - seed:合并种子实体(幂等);
 * - 未知 kind:抛错(日志完整性守卫)。
 */
export function fold(
  events: readonly LogEvent[],
  deps: { flows: Readonly<Record<string, FlowDefinition>> },
): EngineSnapshot {
  let snapshot: EngineSnapshot = { instances: {}, collections: {} };
  for (const event of events) {
    switch (event.kind) {
      case 'seed':
        snapshot = applySeed(snapshot, event);
        break;
      case 'action-executed':
        snapshot = applyExecuted(snapshot, event, deps.flows);
        break;
      case 'action-rejected':
      case 'entity-appended':
      case 'spawn-requested':
        break;
      default:
        throw new Error(`重放失败:未知事件 kind "${String(event.kind)}"(seq=${event.seq})`);
    }
  }
  return snapshot;
}
