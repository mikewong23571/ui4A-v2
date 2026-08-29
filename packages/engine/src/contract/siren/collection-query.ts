/**
 * 集合读面查询(T38 FR1/FR2):分页参数解析、目标判定与页链接语义。
 *
 * 纯函数;页大小 = 投影策略常量(住投影层)——渲染器零页尺寸常量、零页码
 * 推算,只跟随合同声明的 next/prev 链接。不带参数 = 全量(合同零窄化):
 * 查询机制只在参数在场时生效,无参数投影路径零形状漂移(CLI/外部 agent 的
 * 全量发现面承诺,product-vision §二 CLI 三纪律)。读面参数零事件、零鉴权
 * 输入(D51):解析与切片不接触任何 principal/scope 语义。
 */
import type { EngineSnapshot } from '@ui4a/shared';

import { actionEffects } from '../../core/parse';
import type { FlowDefinition } from '../../core/types';

/** 每页成员数(投影策略;服务端驱动分页的唯一页尺寸来源)。 */
export const COLLECTION_PAGE_SIZE = 20;

/** 原始读面查询:HTTP 查询串的机械提取(全字符串;判定全部在引擎层)。 */
export interface RawCollectionQuery {
  offset?: string;
}

/** 已解析的集合读面查询(纯数据,直接驱动投影切片)。 */
export interface CollectionQuery {
  offset: number;
}

/** 结构化拒绝(拒绝即教育):读面零事件,layer/reason 由 HTTP 层原样透出。 */
export interface CollectionQueryRejection {
  layer: 'query';
  reason: 'invalid-offset' | 'query-target-not-pageable';
  message: string;
}

export type ParsedCollectionQuery =
  | { kind: 'none' }
  | { kind: 'query'; query: CollectionQuery }
  | { kind: 'rejected'; rejection: CollectionQueryRejection };

/**
 * 原始查询 → 解析结果。无参数(全量)与带参数(分页)是同一合同的两态;
 * 非法值结构化拒绝,零静默修正(拒绝即教育)。
 */
export function parseCollectionQuery(raw: RawCollectionQuery | undefined): ParsedCollectionQuery {
  if (raw === undefined || raw.offset === undefined) return { kind: 'none' };
  const text = raw.offset;
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    return {
      kind: 'rejected',
      rejection: {
        layer: 'query',
        reason: 'invalid-offset',
        message: `分页参数 offset 必须是非负安全整数,得到 "${text}"`,
      },
    };
  }
  return { kind: 'query', query: { offset: Number(text) } };
}

/**
 * 业务成员集合判定:快照集合表在案,或活跃定义的 append 效果声明
 * (空态诚实投影同口径)。inbox/threads 等系统集合视图与实例实体不在此列。
 */
export function isMemberCollectionRel(
  snapshot: EngineSnapshot,
  flows: Readonly<Record<string, FlowDefinition>>,
  rel: string,
): boolean {
  if (rel in snapshot.collections) return true;
  for (const flow of Object.values(flows)) {
    for (const node of flow.nodes) {
      for (const action of node.actions) {
        for (const effect of actionEffects(action)) {
          if (effect.type === 'append' && effect.collection === rel) return true;
        }
      }
    }
  }
  return false;
}

/**
 * 查询参数在场时的目标判定:仅业务成员集合接受分页/过滤参数;其余(实例、
 * 系统集合视图、flow 别名等)结构化拒绝,零静默忽略。
 */
export function queryTargetRejection(
  snapshot: EngineSnapshot,
  flows: Readonly<Record<string, FlowDefinition>>,
  rel: string,
): CollectionQueryRejection | undefined {
  if (isMemberCollectionRel(snapshot, flows, rel)) return undefined;
  return {
    layer: 'query',
    reason: 'query-target-not-pageable',
    message: `集合读面查询参数(分页/过滤)仅对业务成员集合生效,"${rel}" 不是成员集合`,
  };
}
