/**
 * Siren 投影器:rel → Siren 实体(arch-brief §2 四件组装)。
 *
 * properties / actions / links / guard-results;集合实体经 entities[] 携带
 * 子实体(带直达 href,B2 的"经子实体链接直达 post:post-welcome"即靠它)。
 * 纯函数;href 默认相对路径(/api/exec、/api/entity?rel=…),
 * HTTP 层以 baseHref 注入本源前缀——引擎不知道自己被挂在哪。
 */
import type { EngineSnapshot, GuardEvaluation, GuardRegistry } from '@ui4a/shared';
import { fieldValues } from '@ui4a/shared';

import { evaluateGuards } from './judge';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from './schema';
import type { ActionDefinition, FieldDefinition, FlowDefinition } from './types';

/** Siren action(字段为参数 JSON Schema——RJSF 与 agent 共同输入)。 */
export interface SirenAction {
  name: string;
  title: string;
  method: string;
  href: string;
  fields: Record<string, unknown>;
  'requires-confirmation'?: 'low' | 'medium' | 'high';
}

/** guard 求值结果逐项注入的条目(每个 action 一条,含 blocked 原因)。 */
export interface GuardResultEntry {
  action: string;
  blocked: boolean;
  reason?: string;
  guards: GuardEvaluation[];
}

export interface SirenLink {
  rel: string[];
  href: string;
}

/** Siren 实体(子实体额外带 rel 与直达 href)。 */
export interface SirenEntity {
  class: string[];
  rel?: string[];
  href?: string;
  properties: Record<string, unknown>;
  actions: SirenAction[];
  links: SirenLink[];
  'guard-results'?: GuardResultEntry[];
  entities?: SirenEntity[];
}

export interface ProjectDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
  guards: GuardRegistry;
  /** href 前缀(如 "http://localhost:3100");缺省相对路径。 */
  baseHref?: string;
}

function entityHref(base: string | undefined, rel: string): string {
  return `${base ?? ''}/api/entity?rel=${rel}`;
}

function execHref(base: string | undefined): string {
  return `${base ?? ''}/api/exec`;
}

function toSirenAction(
  action: ActionDefinition,
  nodeFields: readonly FieldDefinition[],
  base: string | undefined,
): SirenAction {
  const sirenAction: SirenAction = {
    name: action.name,
    title: action.title,
    method: action.method ?? 'POST',
    href: execHref(base),
    fields: fieldDefinitionsToJsonSchema(mergeFieldDefinitions(nodeFields, action.fields ?? [])),
  };
  if (action['requires-confirmation'] !== undefined) {
    sirenAction['requires-confirmation'] = action['requires-confirmation'];
  }
  return sirenAction;
}

function guardResultsFor(
  actions: readonly ActionDefinition[],
  instance: EngineSnapshot['instances'][string],
  snapshot: EngineSnapshot,
  guards: GuardRegistry,
): GuardResultEntry[] {
  return actions.map((action) => {
    const evaluations = evaluateGuards(action, instance, snapshot, {}, guards);
    const failed = evaluations.filter((evaluation) => !evaluation.pass);
    const entry: GuardResultEntry = {
      action: action.name,
      blocked: failed.length > 0,
      guards: evaluations,
    };
    if (failed.length > 0) {
      entry.reason = `guard 不满足: ${failed.map((f) => `${f.name}=false`).join(', ')}`;
    }
    return entry;
  });
}

/** 实例实体投影(节点 = 界面:动作、guard、字段全部来自当前节点声明)。 */
function projectInstance(
  instance: EngineSnapshot['instances'][string],
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const flow = deps.flows[instance.flow];
  const node = flow?.nodes.find((candidate) => candidate.name === instance.node);
  const actions = node?.actions ?? [];
  const links: SirenLink[] = [
    { rel: ['self'], href: entityHref(deps.baseHref, instance.rel) },
  ];
  // 成员反查所属集合(导航回链)。
  for (const [collection, members] of Object.entries(snapshot.collections)) {
    if (members.includes(instance.rel)) {
      links.push({ rel: ['collection'], href: entityHref(deps.baseHref, collection) });
    }
  }
  return {
    class: ['flow-instance', instance.flow],
    properties: {
      rel: instance.rel,
      flow: instance.flow,
      node: instance.node,
      title: node?.title ?? instance.node,
      fields: fieldValues(instance.fields),
    },
    actions: actions.map((action) =>
      toSirenAction(action, node?.fields ?? [], deps.baseHref),
    ),
    links,
    'guard-results': guardResultsFor(actions, instance, snapshot, deps.guards),
  };
}

/** 集合实体投影:entities[] 子实体(嵌入投影 + 直达 href)。 */
function projectCollection(
  rel: string,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const members = snapshot.collections[rel] ?? [];
  const entities = members.flatMap((member) => {
    const instance = snapshot.instances[member];
    if (instance === undefined) return [];
    const projected = projectInstance(instance, snapshot, deps);
    return [{ ...projected, rel: ['item'], href: entityHref(deps.baseHref, member) }];
  });
  return {
    class: ['collection', rel],
    properties: { rel, count: members.length },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, rel) }],
    'guard-results': [],
    entities,
  };
}

/** rel → Siren 实体;未知 rel 返回 undefined(HTTP 层映射 404)。 */
export function project(
  snapshot: EngineSnapshot,
  rel: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  const instance = snapshot.instances[rel];
  if (instance !== undefined) {
    return projectInstance(instance, snapshot, deps);
  }
  if (rel in snapshot.collections) {
    return projectCollection(rel, snapshot, deps);
  }
  return undefined;
}
