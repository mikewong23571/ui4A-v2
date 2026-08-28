/**
 * flow:<name> 实体投影合同补全(T2 Phase E 先行任务,编排 prompt 2026-08-21)。
 *
 * 背景:sitemap surfaces 已声明 `flow:<name>` 表面,但 /api/entity?rel=flow:…
 * 曾 404——合同出现"只能靠 startRel 特权进入向导"的缺口。
 *
 * 补全口径(纯 web 服务层实现,packages/engine 语义不动):
 * - **向导类 flow(单实例语义)**:`flow:<name>` 别名解析为该 flow 唯一实例的
 *   rel(article-drafting:main),GET 与 exec 一并别名(exec 落日志记实例 rel,
 *   不产生幽灵实体);多实例/零实例的 flow 不冒充实体(404 维持诚实)。
 * - **集合入口链接**:以 append 效果向集合产出成员的 flow,在该集合实体 links
 *   补 `flow:<name>` 入口链接——从 articles 出发沿 links 能到达向导实例,
 *   零 startRel 特权的完整导航(处境披露的根基)。
 */
import { appendedCollections } from '@ui4a/engine';
import type { FlowDefinition, SirenEntity, SirenLink } from '@ui4a/engine';
import type { EngineSnapshot, InstanceSnapshot } from '@ui4a/shared';

const FLOW_REL_PREFIX = 'flow:';

/**
 * `flow:<name>` → 唯一实例 rel;非 flow rel 原样返回(undefined 表示不适用)。
 * 单实例才具备"向导入口"语义;恰一个实例时别名,否则不解析。
 */
export function resolveFlowRelAlias(rel: string, snapshot: EngineSnapshot): string | undefined {
  if (!rel.startsWith(FLOW_REL_PREFIX)) return undefined;
  const flowName = rel.slice(FLOW_REL_PREFIX.length);
  if (flowName === '') return undefined;
  const instances = Object.values(snapshot.instances).filter(
    (instance) => instance.flow === flowName,
  );
  if (instances.length !== 1) return undefined;
  return instances[0]!.rel;
}

/**
 * 集合实体补 flow 入口链接:为每个向该集合 append 成员的 flow 生成
 * `{rel: ['flow'], href: /api/entity?rel=flow:<name>}`。非集合实体原样返回。
 * 目标集合推导复用引擎 `appendedCollections`(与实例正向链同一口径,T37)。
 */
export function withCollectionFlowEntryLinks(
  entity: SirenEntity,
  flows: readonly FlowDefinition[],
): SirenEntity {
  if (!entity.class.includes('collection')) return entity;
  const existing = new Set(entity.links.map((link) => link.href));
  const entryLinks: SirenLink[] = [];
  for (const flow of flows) {
    if (!appendedCollections(flow).includes(entity.properties.rel as string)) continue;
    const href = `/api/entity?rel=${encodeURIComponent(`${FLOW_REL_PREFIX}${flow.name}`)}`;
    if (existing.has(href)) continue;
    entryLinks.push({ rel: ['flow'], href });
  }
  if (entryLinks.length === 0) return entity;
  return { ...entity, links: [...entity.links, ...entryLinks] };
}

/**
 * `flow:<name>` 的实例集合投影(T35 F-02):sitemap 已声明 `flow:<name>` 表面,
 * 但别名只在恰一实例(向导语义)时解析;状态机类 flow(零或多实例)此前 404,
 * "查看活实例"跨面桥因此落空。本投影把零/多实例兑现为**只读集合列举**——成员
 * 即实例自身快照字段,零目标实体内容复制(T26 口径);非 flow rel 或未知 flow 名
 * 返回 null(404 诚实不变)。
 */
export function flowInstancesCollection(
  rel: string,
  snapshot: EngineSnapshot,
  flows: readonly FlowDefinition[],
): SirenEntity | null {
  const flowName = nonEmptySuffixOf(rel, FLOW_REL_PREFIX);
  if (flowName === null) return null;
  const definition = flows.find((flow) => flow.name === flowName);
  if (definition === undefined) return null;
  const members = Object.values(snapshot.instances).filter(
    (instance) => instance.flow === flowName,
  );
  return {
    class: ['collection', 'flow-instances'],
    properties: {
      rel,
      flow: flowName,
      title: `${definition.title ?? definition.name} · 活实例`,
      count: members.length,
    },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` }],
    entities: members.map((instance) => ({
      class: ['flow-instance'],
      properties: {
        rel: instance.rel,
        flow: instance.flow,
        node: instance.node,
        identity: instanceIdentity(instance),
      },
      actions: [],
      links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(instance.rel)}` }],
    })),
  };
}

function nonEmptySuffixOf(value: string, prefix: string): string | null {
  if (!value.startsWith(prefix)) return null;
  const suffix = value.slice(prefix.length);
  return suffix.trim() === '' ? null : suffix;
}

/**
 * `flow:<name>` 读面补全(T36 B2 自 service.ts getEntity 下沉):别名解析 →
 * 常规投影;未命中再兑现零/多实例的只读实例集合;命中后补集合入口链接。
 * 未知 flow 名返回 undefined(404 诚实);projectEntity 由调用方注入
 * (快照与投影依赖留在 service 装配层)。
 */
export function completeFlowEntity(
  rel: string,
  snapshot: EngineSnapshot,
  flows: readonly FlowDefinition[],
  projectEntity: (target: string) => SirenEntity | undefined,
): SirenEntity | undefined {
  const target = resolveFlowRelAlias(rel, snapshot) ?? rel;
  let entity = projectEntity(target);
  if (entity === undefined) {
    entity = flowInstancesCollection(rel, snapshot, flows) ?? undefined;
  }
  if (entity === undefined) return undefined;
  return withCollectionFlowEntryLinks(entity, flows);
}

/** 实例成员的一行身份:声明 identity 字段优先,回退 rel(零发明)。 */
function instanceIdentity(instance: InstanceSnapshot): string {
  const declared = instance.fields['identity'];
  if (typeof declared === 'string' && declared !== '') return declared;
  const title = instance.fields['title'];
  if (typeof title === 'string' && title !== '') return title;
  return instance.rel;
}
