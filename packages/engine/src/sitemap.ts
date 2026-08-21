/**
 * sitemap 推导:从 flow 常量纯推导"应用交互拓扑的完整声明"
 * (arch-brief §2:界面清单、流程图、迁移规则、每节点的 action schema)。
 * T10 起增 application 分组投影(spec 架构决定 5):扁平 flows 保留且条目
 * 带 app 归属,applications 按定义表声明序分组(发现层两层发现的第一层)。
 *
 * 版本号 = 内容 hash 短码(同内容同版本,缓存键;定义激活即重生成)。
 * hash 用 64 位 FNV-1a(BigInt 实现,同步、两栖、无 Node crypto 依赖)——
 * 定位是缓存版本号而非内容寻址工件,T4 的 versions 才上 sha256。
 */
import type {
  ActionDefinition,
  ApplicationDefinition,
  FieldDefinition,
  FlowDefinition,
} from './types';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from './schema';

/** 界面清单条目:资源 rel / 标题(集合或 flow 定义实体)。 */
export interface SitemapSurface {
  rel: string;
  title: string;
  collection?: boolean;
  /**
   * 归属 application(T10 架构决定 5):flow 面取其 flow.app(归一化后);
   * 集合面取首次 append 它的 flow 的 app;无归属信息归 'default'。
   * 类型上可选(meta 站 surface 复用本类型、无 app 语义),业务 sitemap 投影恒填。
   */
  app?: string;
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
  /** 归属 application(归一化后:flow.app 缺省 → 'default')。 */
  app: string;
  initial: string;
  nodes: SitemapNode[];
  edges: SitemapEdge[];
}

/**
 * application 分组投影(发现层两层发现的第一层:agent 先读 intent 定位
 * app,再在组内选 flow)。flows 与扁平表共享同一份条目投影(形状一致);
 * 无成员的 app 定义也在场(intent 是发现依据,不因空成员缺席)。
 */
export interface SitemapApplication {
  name: string;
  title: string;
  intent: string;
  flows: SitemapFlow[];
}

export interface Sitemap {
  version: string;
  surfaces: SitemapSurface[];
  /** 扁平 flows 索引(向后兼容:既有消费方;条目带 app 归属)。 */
  flows: SitemapFlow[];
  /** 按 app 分组的投影;无 app 定义(applications 缺省)时为空数组。 */
  applications: SitemapApplication[];
  generatedAt?: string;
}

export interface DeriveSitemapOptions {
  /** 种子域中无 append 来源的资源面(如 comments 集合)。 */
  extraSurfaces?: SitemapSurface[];
  /**
   * 活跃 application 定义表(snapshot.applications 的形状)。
   * 缺省 → applications 分组为空数组;分组序 = 定义表声明序。
   */
  applications?: Record<string, ApplicationDefinition>;
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
    app: flow.app ?? 'default',
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
  // app 归属口径:flow 面取其 flow.app(归一化后);集合面取首次 append 它的
  // flow 的 app(append 效果出现在哪个 flow,集合面就归属哪个 flow)。
  const surfaces: SitemapSurface[] = sitemapFlows.map((flow) => ({
    rel: `flow:${flow.name}`,
    title: flow.title,
    app: flow.app,
  }));
  const seenCollections = new Set<string>();
  for (const flow of flows) {
    const app = flow.app ?? 'default';
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
            surfaces.push({ rel: effect.collection, title: effect.collection, collection: true, app });
          }
        }
      }
    }
  }
  // extraSurfaces 由调用方注入,无归属信息时归 'default'。
  for (const extra of options?.extraSurfaces ?? []) {
    surfaces.push({ ...extra, app: extra.app ?? 'default' });
  }

  // application 分组投影:组序 = 定义表声明序;组内 flows = 扁平表声明序过滤
  // (与扁平表共享同一份条目)。flow.app 指向未定义 app 时仅留在扁平表——
  // app-known 不变式保证生产侧不可达,此处不静默归并也不炸。
  const applications: SitemapApplication[] = Object.values(options?.applications ?? {}).map(
    (app) => ({
      name: app.name,
      title: app.title,
      intent: app.intent,
      flows: sitemapFlows.filter((flow) => flow.app === app.name),
    }),
  );

  const sitemap: Sitemap = {
    version: contentVersion({ applications, surfaces, flows: sitemapFlows }),
    surfaces,
    flows: sitemapFlows,
    applications,
  };
  if (options?.generatedAt !== undefined) {
    sitemap.generatedAt = options.generatedAt;
  }
  return sitemap;
}
