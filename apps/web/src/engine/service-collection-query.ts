/**
 * 集合读面查询的服务层编排(T38,自 service.ts 拆出,GR3 沿功能边界分解):
 * 解析(语法层)→ 投影(切片/过滤只对成员集合生效)→ 目标与声明裁决
 * (存在性先行:未知 rel 保持 404;存在的非成员目标、声明外维度、值域外
 * 取值结构化拒绝,拒绝即教育)。读面零事件、零鉴权输入(D51)。
 */
import {
  parseCollectionQuery,
  project,
  queryTargetRejection,
  resolveCollectionFilters,
  type CollectionQueryRejection,
  type FlowDefinition,
  type ProjectDeps,
  type RawCollectionQuery,
  type SirenEntity,
} from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import { completeFlowEntity, resolveFlowRelAlias } from './flow-entry';

/**
 * 集合读面查询拒绝(结构化 layer/reason):HTTP 层据此映射 400(拒绝即教育)。
 */
export class CollectionQueryError extends Error {
  readonly rejection: CollectionQueryRejection;

  constructor(rejection: CollectionQueryRejection) {
    super(rejection.message);
    this.name = 'CollectionQueryError';
    this.rejection = rejection;
  }
}

/**
 * 带查询的实体读取:query 缺省 = 全量原路径(合同零窄化);query 在场时投影
 * 先收窄,随后目标裁决与过滤声明裁决(存在性语义不受查询参数影响)。
 */
export function readCollectionQueriedEntity(
  rel: string,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
  activeFlows: () => Record<string, FlowDefinition>,
  rawQuery: RawCollectionQuery | undefined,
): SirenEntity | undefined {
  const parsed = parseCollectionQuery(rawQuery);
  if (parsed.kind === 'rejected') throw new CollectionQueryError(parsed.rejection);
  const query = parsed.kind === 'query' ? parsed.query : undefined;
  const entity = completeFlowEntity(rel, snapshot, Object.values(activeFlows()), (target) =>
    project(snapshot, target, deps, query),
  );
  if (entity !== undefined && query !== undefined) {
    const target = resolveFlowRelAlias(rel, snapshot) ?? rel;
    const rejection = queryTargetRejection(snapshot, activeFlows(), target);
    if (rejection !== undefined) throw new CollectionQueryError(rejection);
    const filters = resolveCollectionFilters(activeFlows(), target, query.filter);
    if (filters.kind === 'rejected') throw new CollectionQueryError(filters.rejection);
  }
  return entity;
}
