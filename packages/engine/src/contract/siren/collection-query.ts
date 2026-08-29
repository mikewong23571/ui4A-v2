/**
 * 集合读面查询(T38 FR1–FR3):分页/过滤参数解析、目标判定、声明解析与
 * 值域裁决、页链接语义。
 *
 * 纯函数;页大小 = 投影策略常量(住投影层)——渲染器零页尺寸常量、零页码
 * 推算,只跟随合同声明的 next/prev 链接。不带参数 = 全量(合同零窄化):
 * 查询机制只在参数在场时生效,无参数投影路径零形状漂移(CLI/外部 agent 的
 * 全量发现面承诺,product-vision §二 CLI 三纪律)。读面参数零事件、零鉴权
 * 输入(D51):解析与切片不接触任何 principal/scope 语义。
 *
 * 过滤维度声明住定义平面数据(flow 的 collections 声明,FR3);值域引用流
 * 拓扑推导(status = 节点集,select 字段 = options),声明与值域零重复真相;
 * 本模块只做声明消费与机械匹配,零「集合名 → 值域」特判映射(§六)。
 */
import type { EngineSnapshot } from '@ui4a/shared';

import { actionEffects } from '../../core/parse';
import type { FlowDefinition } from '../../core/types';

/** 每页成员数(投影策略;服务端驱动分页的唯一页尺寸来源)。 */
export const COLLECTION_PAGE_SIZE = 20;

/** 原始读面查询:HTTP 查询串的机械提取(全字符串;判定全部在引擎层)。 */
export interface RawCollectionQuery {
  offset?: string;
  /** filter.<dimension>=<value> 请求对(保请求序;重复维度在解析层拒绝)。 */
  filter?: ReadonlyArray<{ dimension: string; value: string }>;
}

/** 已解析的集合读面查询(纯数据,直接驱动投影切片/过滤)。 */
export interface CollectionQuery {
  offset: number;
  filter: ReadonlyArray<{ dimension: string; value: string }>;
}

/** 结构化拒绝(拒绝即教育):读面零事件,layer/reason 由 HTTP 层原样透出。 */
export interface CollectionQueryRejection {
  layer: 'query';
  reason:
    | 'invalid-offset'
    | 'invalid-filter'
    | 'query-target-not-pageable'
    | 'undeclared-filter-dimension'
    | 'unknown-filter-value';
  message: string;
}

export type ParsedCollectionQuery =
  | { kind: 'none' }
  | { kind: 'query'; query: CollectionQuery }
  | { kind: 'rejected'; rejection: CollectionQueryRejection };

/** 解析后的过滤维度声明(值域已由流拓扑封闭推导)。 */
export interface ResolvedFilterDimension {
  field: string;
  title: string;
  values: ReadonlyArray<{ value: string; title: string }>;
}

/**
 * 原始查询 → 解析结果。无参数(全量)与带参数(分页/过滤)是同一合同的两态;
 * 非法值结构化拒绝,零静默修正(拒绝即教育)。filter 在场而 offset 缺省时
 * offset 归 0(过滤本身就是一次收窄的读)。
 */
export function parseCollectionQuery(raw: RawCollectionQuery | undefined): ParsedCollectionQuery {
  if (raw === undefined || (raw.offset === undefined && (raw.filter?.length ?? 0) === 0)) {
    return { kind: 'none' };
  }
  let offset = 0;
  if (raw.offset !== undefined) {
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
    offset = Number(text);
  }
  const filter = [...(raw.filter ?? [])];
  const seen = new Set<string>();
  for (const pair of filter) {
    if (pair.dimension === '') {
      return {
        kind: 'rejected',
        rejection: {
          layer: 'query',
          reason: 'invalid-filter',
          message: '过滤参数维度名不能为空(filter.<dimension>=<value>)',
        },
      };
    }
    if (seen.has(pair.dimension)) {
      return {
        kind: 'rejected',
        rejection: {
          layer: 'query',
          reason: 'invalid-filter',
          message: `过滤维度 "${pair.dimension}" 重复出现,一次请求每维度只接受一个值`,
        },
      };
    }
    seen.add(pair.dimension);
  }
  return { kind: 'query', query: { offset, filter } };
}

/** 业务成员集合判定:快照集合表在案,或活跃定义的 append 效果声明(空态诚实投影同口径)。 */
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

/**
 * 集合的过滤维度声明解析(定义平面 → 值域拓扑推导):
 * status 维度值域 = 声明 flow 的节点集(标题 = 节点标题);select 字段维度
 * 值域 = 字段 options(标题 = 值本身)。多 flow 声明同集合时按字段去重,首
 * 声明优先(活跃定义序,确定性);未声明集合 → 空数组(诚实缺省)。
 */
export function collectionFilterDeclarations(
  flows: Readonly<Record<string, FlowDefinition>>,
  collectionRel: string,
): ResolvedFilterDimension[] {
  const byField = new Map<string, ResolvedFilterDimension>();
  for (const flow of Object.values(flows)) {
    for (const entry of flow.collections ?? []) {
      if (entry.collection !== collectionRel) continue;
      for (const dimension of entry.filters ?? []) {
        if (byField.has(dimension.field)) continue;
        byField.set(dimension.field, resolveDimension(flow, dimension));
      }
    }
  }
  return [...byField.values()];
}

function resolveDimension(
  flow: FlowDefinition,
  dimension: { field: string; title: string },
): ResolvedFilterDimension {
  if (dimension.field === 'status') {
    return {
      field: dimension.field,
      title: dimension.title,
      values: flow.nodes.map((node) => ({ value: node.name, title: node.title ?? node.name })),
    };
  }
  const field = [...(flow.fields ?? []), ...flow.nodes.flatMap((node) => node.fields ?? [])].find(
    (candidate) => candidate.name === dimension.field,
  );
  return {
    field: dimension.field,
    title: dimension.title,
    values: (field?.options ?? []).map((option) => ({ value: option, title: option })),
  };
}

/** 过滤裁决结果:放行(解析后的声明)或结构化拒绝。 */
export type ResolvedCollectionFilters =
  | { kind: 'matched'; declarations: ResolvedFilterDimension[] }
  | { kind: 'rejected'; rejection: CollectionQueryRejection };

/**
 * 过滤参数语义裁决(T38 FR3):每个维度必须已声明,值必须属于拓扑推导的
 * 封闭值域——声明外维度与值域外取值都结构化拒绝,零静默忽略。
 */
export function resolveCollectionFilters(
  flows: Readonly<Record<string, FlowDefinition>>,
  collectionRel: string,
  filter: ReadonlyArray<{ dimension: string; value: string }>,
): ResolvedCollectionFilters {
  const declarations = collectionFilterDeclarations(flows, collectionRel);
  for (const pair of filter) {
    const declaration = declarations.find((candidate) => candidate.field === pair.dimension);
    if (declaration === undefined) {
      const known = declarations.map((candidate) => candidate.field).join(', ');
      return {
        kind: 'rejected',
        rejection: {
          layer: 'query',
          reason: 'undeclared-filter-dimension',
          message: `集合 "${collectionRel}" 未声明过滤维度 "${pair.dimension}"(已声明: ${known || '无'})`,
        },
      };
    }
    if (!declaration.values.some((candidate) => candidate.value === pair.value)) {
      const domain = declaration.values.map((candidate) => candidate.value).join(', ');
      return {
        kind: 'rejected',
        rejection: {
          layer: 'query',
          reason: 'unknown-filter-value',
          message: `过滤值 "${pair.value}" 不在维度 "${pair.dimension}" 的声明值域内(${domain})`,
        },
      };
    }
  }
  return { kind: 'matched', declarations };
}

/**
 * 过滤成员的机械匹配(投影层;纯谓词):status 维度 = 实例节点,字段维度 =
 * 实例字段值;悬空成员(无可判定事实)不匹配任何过滤,零发明。
 */
export function memberMatchesFilter(
  instance: EngineSnapshot['instances'][string] | undefined,
  filter: ReadonlyArray<{ dimension: string; value: string }>,
): boolean {
  if (instance === undefined) return false;
  return filter.every((pair) => {
    if (pair.dimension === 'status') return instance.node === pair.value;
    return instance.fields[pair.dimension]?.value === pair.value;
  });
}
