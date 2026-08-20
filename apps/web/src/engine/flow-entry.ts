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
import { actionEffects } from '@ui4a/engine';
import type { FlowDefinition, SirenEntity, SirenLink } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

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

/** flow 的 append 效果目标集合(article-drafting → articles)。 */
function appendedCollections(flow: FlowDefinition): string[] {
  const collections = new Set<string>();
  for (const node of flow.nodes) {
    for (const action of node.actions) {
      for (const effect of actionEffects(action)) {
        if (effect.type === 'append') collections.add(effect.collection);
      }
    }
  }
  return [...collections];
}

/**
 * 集合实体补 flow 入口链接:为每个向该集合 append 成员的 flow 生成
 * `{rel: ['flow'], href: /api/entity?rel=flow:<name>}`。非集合实体原样返回。
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
