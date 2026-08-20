/**
 * sitemap 推导:从 flow 常量纯推导"应用交互拓扑的完整声明"
 * (arch-brief §2:界面清单、流程图、迁移规则、每节点的 action schema)。
 *
 * 版本号 = 内容 hash 短码(同内容同版本,缓存键;定义激活即重生成)。
 * hash 用 64 位 FNV-1a(BigInt 实现,同步、两栖、无 Node crypto 依赖)——
 * 定位是缓存版本号而非内容寻址工件,T4 的 versions 才上 sha256。
 */
import type { ActionDefinition, FieldDefinition, FlowDefinition } from './types';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from './schema';

/** 界面清单条目:资源 rel / 标题(集合或 flow 定义实体)。 */
export interface SitemapSurface {
  rel: string;
  title: string;
  collection?: boolean;
}

/** action 摘要(含参数 schema,agent 工具投影的原料)。 */
export interface SitemapAction {
  name: string;
  title: string;
  method: string;
  to?: string;
  guards: string[];
  'requires-confirmation'?: 'low' | 'medium' | 'high';
  fields: Record<string, unknown>;
}

export interface SitemapNode {
  name: string;
  title: string;
  /** 节点字段定义(语义锚点:semantics/source 原样保留)。 */
  fields: FieldDefinition[];
  actions: SitemapAction[];
}

export interface SitemapEdge {
  from: string;
  action: string;
  to: string;
}

/** 流程拓扑(用户故事的机器可读形态)。 */
export interface SitemapFlow {
  name: string;
  title: string;
  initial: string;
  nodes: SitemapNode[];
  edges: SitemapEdge[];
}

export interface Sitemap {
  version: string;
  surfaces: SitemapSurface[];
  flows: SitemapFlow[];
  generatedAt?: string;
}

export interface DeriveSitemapOptions {
  /** 种子域中无 append 来源的资源面(如 comments 集合)。 */
  extraSurfaces?: SitemapSurface[];
  /** 生成时刻(时钟由调用方注入,保证推导纯函数)。 */
  generatedAt?: string;
}

function toActionSummary(
  action: ActionDefinition,
  nodeFields: readonly FieldDefinition[],
): SitemapAction {
  const summary: SitemapAction = {
    name: action.name,
    title: action.title,
    method: action.method ?? 'POST',
    guards: [...(action.guards ?? [])],
    fields: fieldDefinitionsToJsonSchema(mergeFieldDefinitions(nodeFields, action.fields ?? [])),
  };
  if (action.to !== undefined) summary.to = action.to;
  if (action['requires-confirmation'] !== undefined) {
    summary['requires-confirmation'] = action['requires-confirmation'];
  }
  return summary;
}

function toSitemapFlow(flow: FlowDefinition): SitemapFlow {
  const nodes: SitemapNode[] = flow.nodes.map((node) => ({
    name: node.name,
    title: node.title ?? node.name,
    fields: [...(node.fields ?? [])],
    actions: node.actions.map((action) => toActionSummary(action, node.fields ?? [])),
  }));
  const edges: SitemapEdge[] = flow.nodes.flatMap((node) =>
    node.actions
      .filter((action) => action.to !== undefined)
      .map((action) => ({ from: node.name, action: action.name, to: action.to as string })),
  );
  return {
    name: flow.name,
    title: flow.title ?? flow.name,
    initial: flow.initial,
    nodes,
    edges,
  };
}

/** 64 位 FNV-1a(BigInt 算术,同步、浏览器/Node 两栖)。 */
function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** canonical JSON:递归键排序后稳定序列化(键序无关的哈希输入)。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 内容 hash 短码(12 hex = 48 bit,缓存键用途足够)。 */
export function contentVersion(payload: unknown): string {
  return fnv1a64(canonicalJson(payload)).slice(0, 12);
}

/** 从 flow 常量推导 sitemap(纯函数;定义激活即重生成,版本号即缓存键)。 */
export function deriveSitemap(
  flows: readonly FlowDefinition[],
  options?: DeriveSitemapOptions,
): Sitemap {
  const sitemapFlows = flows.map(toSitemapFlow);

  // 界面清单:flow 定义实体 + append 目标集合(首次出现序,去重)。
  const surfaces: SitemapSurface[] = sitemapFlows.map((flow) => ({
    rel: `flow:${flow.name}`,
    title: flow.title,
  }));
  const seenCollections = new Set<string>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      for (const action of node.actions) {
        const effects = Array.isArray(action.effect)
          ? action.effect
          : action.effect !== undefined
            ? [action.effect]
            : [];
        for (const effect of effects) {
          if (effect.type === 'append' && !seenCollections.has(effect.collection)) {
            seenCollections.add(effect.collection);
            surfaces.push({ rel: effect.collection, title: effect.collection, collection: true });
          }
        }
      }
    }
  }
  surfaces.push(...(options?.extraSurfaces ?? []));

  const sitemap: Sitemap = {
    version: contentVersion({ surfaces, flows: sitemapFlows }),
    surfaces,
    flows: sitemapFlows,
  };
  if (options?.generatedAt !== undefined) {
    sitemap.generatedAt = options.generatedAt;
  }
  return sitemap;
}
