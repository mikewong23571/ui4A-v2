/**
 * 效果词汇表应用器:transition / set-field / append / spawn(stub)。
 *
 * 纯函数:输入请求 + 裁决通过的效果列表 + 旧快照 → 新快照 + 待追加事件列表。
 * 不可变产出(应用核心是日志的纯函数,I5 的前提);spawn 在 T2 只产出事件
 * 记录、不改状态(T3 接 Temporal 后由 worker 消费 spawn-requested 事件)。
 */
import type { EngineSnapshot, FieldValue, ParamOrigin } from '@ui4a/shared';

import { canTransition } from './machine';
import type { ExecRequest } from './judge';
import type { EffectDefinition, FlowDefinition } from './types';

/** 引擎产出的事件(append 到事件日志;seq/ts 由日志层分配——时钟是 capability)。 */
export interface EngineEvent {
  kind:
    | 'action-executed'
    | 'entity-appended'
    | 'spawn-requested'
    | 'confirmation-requested'
    | 'confirmation-approved'
    | 'confirmation-rejected';
  rel: string;
  action: string;
  actor: 'human' | 'agent';
  principal?: string;
  channel?: string;
  /** 带出处的参数快照(事件溯源的求值输入)。 */
  params?: Record<string, FieldValue>;
  /** action-executed:迁移目标节点。 */
  to?: string;
  /** action-executed:本次动作追加的新实例 rel 列表。 */
  appended?: string[];
  /** entity-appended:新实例 rel 与集合。 */
  appendedRel?: string;
  collection?: string;
  /** spawn-requested:T3 起 Temporal workflow 的输入。 */
  capability?: string;
  bind?: Record<string, unknown>;
  'on-done'?: string;
  /**
   * confirmation-*:结构化载荷(ConfirmationRequestDetail / ConfirmationDecisionDetail,
   * 见 confirmation.ts;与日志层 LogEvent.detail 同一落点)。
   */
  detail?: unknown;
}

/** 效果应用结果:新快照 + 待追加事件(顺序即日志顺序,重放确定性依赖它)。 */
export interface EffectOutcome {
  snapshot: EngineSnapshot;
  events: EngineEvent[];
}

export interface EffectDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
}

/** 参数出处:显式声明优先,缺省 intent(直接意图提交)。 */
function originOf(
  request: ExecRequest,
  name: string,
): ParamOrigin {
  return request.paramOrigins?.[name] ?? 'intent';
}

/** title → post-welcome 风格的实例名 slug。 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'item' : slug;
}

function resourceType(effect: Extract<EffectDefinition, { type: 'append' }>): string {
  if (effect['resource-type'] !== undefined) return effect['resource-type'];
  // 集合名缺省按英文单数化(articles → article)
  const collection = effect.collection;
  return collection.endsWith('s') ? collection.slice(0, -1) : collection;
}

/** 确定性命名:显式 name > name-from 参数 slug > 集合名+序号;冲突递增后缀。 */
function instanceName(
  effect: Extract<EffectDefinition, { type: 'append' }>,
  request: ExecRequest,
  instances: EngineSnapshot['instances'],
  type: string,
): string {
  const base =
    effect.name ??
    (effect['name-from'] !== undefined
      ? slugify(String(request.params?.[effect['name-from']] ?? ''))
      : `${type}-${Object.keys(instances).length + 1}`);
  if (instances[`${type}:${base}`] === undefined) return base;
  let counter = 2;
  while (instances[`${type}:${base}-${counter}`] !== undefined) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

/** 请求参数 → 带出处的字段(可按白名单过滤;confirmation 模块与 web 服务层共用口径)。 */
export function paramsToFields(
  request: ExecRequest,
  whitelist?: string[],
): Record<string, FieldValue> {
  const entries = Object.entries(request.params ?? {});
  const filtered = whitelist ? entries.filter(([name]) => whitelist.includes(name)) : entries;
  return Object.fromEntries(
    filtered.map(([name, value]) => [name, { value, origin: originOf(request, name) }]),
  );
}

/**
 * 应用效果列表。顺序:先落参数字段,再按声明序执行效果;
 * 事件顺序固定 action-executed → entity-appended* → spawn-requested*。
 */
export function applyEffects(
  request: ExecRequest,
  effects: readonly EffectDefinition[],
  snapshot: EngineSnapshot,
  deps: EffectDeps,
): EffectOutcome {
  const instance = snapshot.instances[request.rel];
  if (instance === undefined) {
    throw new Error(`实例 "${request.rel}" 不存在,无法应用效果`);
  }

  // 参数按声明字段落入实例(schema 层已拒多余参数,此处整包写入)。
  const paramFields = paramsToFields(request);
  const instances: EngineSnapshot['instances'] = {
    ...snapshot.instances,
    [request.rel]: { ...instance, fields: { ...instance.fields, ...paramFields } },
  };
  const collections: Record<string, string[]> = { ...snapshot.collections };

  let to: string | undefined;
  const appendedRels: string[] = [];
  const appendedEvents: EngineEvent[] = [];
  const spawnEvents: EngineEvent[] = [];

  for (const effect of effects) {
    if (effect.type === 'transition') {
      const flow = deps.flows[instance.flow];
      const target = effect.to;
      if (flow === undefined || target === undefined) {
        throw new Error(`transition 缺少可校验的目标(流程 "${instance.flow}" 或 to 未定义)`);
      }
      if (!canTransition(flow, instances[request.rel]!.node, target)) {
        throw new Error(
          `非法迁移:${flow.name} 不允许 ${instances[request.rel]!.node} --${request.action}--> ${target}`,
        );
      }
      to = target;
      instances[request.rel] = { ...instances[request.rel]!, node: target };
    } else if (effect.type === 'set-field') {
      const origin: ParamOrigin = effect.origin ?? 'effect';
      instances[request.rel] = {
        ...instances[request.rel]!,
        fields: {
          ...instances[request.rel]!.fields,
          [effect.field]: { value: effect.value, origin },
        },
      };
    } else if (effect.type === 'append') {
      const type = resourceType(effect);
      const name = instanceName(effect, request, instances, type);
      const rel = `${type}:${name}`;
      instances[rel] = {
        rel,
        flow: effect.flow ?? instance.flow,
        node: effect.node ?? deps.flows[instance.flow]?.initial ?? instance.node,
        fields: paramsToFields(request, effect.fields),
      };
      collections[effect.collection] = [...(collections[effect.collection] ?? []), rel];
      appendedRels.push(rel);
      appendedEvents.push({
        kind: 'entity-appended',
        rel: request.rel,
        appendedRel: rel,
        collection: effect.collection,
        action: request.action,
        actor: request.actor ?? 'human',
        principal: request.principal,
        channel: request.channel,
        params: paramFields,
      });
    } else {
      spawnEvents.push({
        kind: 'spawn-requested',
        rel: request.rel,
        action: request.action,
        actor: request.actor ?? 'human',
        principal: request.principal,
        channel: request.channel,
        capability: effect.capability,
        bind: effect.bind,
        'on-done': effect['on-done'],
      });
    }
  }

  const executedEvent: EngineEvent = {
    kind: 'action-executed',
    rel: request.rel,
    action: request.action,
    actor: request.actor ?? 'human',
    principal: request.principal,
    channel: request.channel,
    params: paramFields,
    ...(to !== undefined ? { to } : {}),
    ...(appendedRels.length > 0 ? { appended: appendedRels } : {}),
  };

  return {
    snapshot: { instances, collections, confirmations: { ...snapshot.confirmations } },
    events: [executedEvent, ...appendedEvents, ...spawnEvents],
  };
}
