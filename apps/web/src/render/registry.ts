/**
 * 渲染词汇表注册表(T7 spec 架构决定 1):词条 = {名字, 组件(lazy 引用),
 * bind schema, dimension 支持}。词汇表身份 = A2UI 自定义扩展目录——
 * 基础目录只有布局原语,数据词条我们补;目录以 JSON URL 引用
 * (createSurface 的 catalogId 协商口径,A2UI 目录 JSON 形状:$id/
 * catalogId + components{词名: JSON Schema}),经 /api/render/catalog 提供。
 *
 * MVP 十词(选型 §6):table/chart/stat/timeline/flow/form/diff/kanban/
 * markdown/detail。Phase A 只落注册表与目录端点骨架——component 为 lazy
 * 占位(Phase B 接真实组件:table→TanStack Table、chart→shadcn Charts、
 * stat→Tremor、timeline→react-chrono、flow→React Flow、form→RJSF(已有)、
 * diff→react-diff-view(已有)、kanban→dnd-kit、markdown→react-markdown、
 * detail→shadcn Sheet/Card),bindSchema 描述该词条 bind 的形状约束
 * (渲染器侧消费;spec 生成路径的词条校验同源)。
 */
import type { ComponentType } from 'react';

import { lazyPlaceholder } from './words/placeholder';

/** 渲染词条(lazy 组件 + bind 形状约束 + 聚合数据源声明)。 */
export interface RenderWordEntry {
  /** 词名(RenderSpec.component 的取值;目录 components 的键)。 */
  name: string;
  /** 人读标题。 */
  title: string;
  /** 词条说明(目录 JSON 的 description;spec 生成路径的语义锚)。 */
  description: string;
  /**
   * 词条组件的 lazy 引用(Phase B 接入真实组件;占位约定:调用即返回
   * Promise<ComponentType>,不持有模块级组件引用——目录可序列化)。
   */
  component: () => Promise<ComponentType<Record<string, unknown>>>;
  /** 该词条 bind 的形状约束(JSON Schema;目录 components 的值)。 */
  bindSchema: Record<string, unknown>;
  /** 是否消费 dimension 聚合数据源(collection+dimension → 分组计数)。 */
  supportsDimension: boolean;
}

/** 目录端点路径(A2UI 以 URL 引用目录)。 */
export const catalogUrl = '/api/render/catalog';

/** 目录稳定 URI(A2UI 惯例:catalogId 是标识,不承诺运行时下载)。 */
export const CATALOG_ID = 'https://ui4a.dev/render/v1/catalog.json';

/** 词条:表格(TanStack Table;rows = 集合引用,成员实体为行)。 */
const tableWord: RenderWordEntry = {
  name: 'table',
  title: '表格',
  description: '集合数据的表格视图:rows 绑定集合引用,成员实体的 properties 为行',
  component: lazyPlaceholder('table'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: '表格词条:rows 为集合引用(collection);可选 caption 为字段引用',
    properties: {
      rows: { description: '集合引用:成员实体(行)' },
      caption: { description: '字段引用:表格标题' },
    },
    required: ['rows'],
  },
};

/** 词条:图表(shadcn Charts/Recharts;series = collection+dimension 聚合)。 */
const chartWord: RenderWordEntry = {
  name: 'chart',
  title: '图表',
  description: '聚合图表:series 绑定集合引用 + dimension 维度声明,解引用器分组计数',
  component: lazyPlaceholder('chart'),
  supportsDimension: true,
  bindSchema: {
    type: 'object',
    description: '图表词条:series 为集合引用(带 dimension 维度声明)→ [{key,count}]',
    properties: {
      series: { description: '集合引用 + 维度声明:分组计数数据源' },
      caption: { description: '字段引用:图表标题' },
    },
    required: ['series'],
  },
};

/** 词条:统计卡(Tremor;value = 字段引用,数值来自实体)。 */
const statWord: RenderWordEntry = {
  name: 'stat',
  title: '统计卡',
  description: '单个数值/文本的统计卡:value 绑定字段引用(数值来自实体快照)',
  component: lazyPlaceholder('stat'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: '统计卡词条:value 为字段引用;label 为字段引用(标题)',
    properties: {
      value: { description: '字段引用:统计值' },
      label: { description: '字段引用:标签' },
    },
    required: ['value'],
  },
};

/** 词条:时间线(react-chrono;events = 集合引用,append 序即时间序)。 */
const timelineWord: RenderWordEntry = {
  name: 'timeline',
  title: '时间线',
  description: '事件时间线:events 绑定集合引用,成员按集合 append 序渲染(零 AI)',
  component: lazyPlaceholder('timeline'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: '时间线词条:events 为集合引用(append 序即时间序)',
    properties: {
      events: { description: '集合引用:事件成员' },
      caption: { description: '字段引用:时间线标题' },
    },
    required: ['events'],
  },
};

/** 词条:流程图(React Flow;graph = 实体引用,拓扑来自实体)。 */
const flowWord: RenderWordEntry = {
  name: 'flow',
  title: '流程图',
  description: '流程拓扑图:graph 绑定实体引用(XState 图谱/sitemap 拓扑来自实体)',
  component: lazyPlaceholder('flow'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: '流程图词条:graph 为实体引用(节点/边数据来自实体)',
    properties: { graph: { description: '实体引用:拓扑数据' } },
    required: ['graph'],
  },
};

/** 词条:表单(RJSF 已有;entity = 实体引用,字段 schema 来自 actions)。 */
const formWord: RenderWordEntry = {
  name: 'form',
  title: '表单',
  description: '哑表单:entity 绑定实体引用,字段 schema 从实体 actions 生成(RJSF)',
  component: lazyPlaceholder('form'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: '表单词条:entity 为实体引用(动作字段 schema 即输入)',
    properties: { entity: { description: '实体引用:动作与字段 schema 来源' } },
    required: ['entity'],
  },
};

/** 词条:diff(react-diff-view 已有;entity = 实体引用,机械 diff)。 */
const diffWord: RenderWordEntry = {
  name: 'diff',
  title: '差异',
  description: '机械 diff 视图:entity 绑定实体引用,渲染纯数据 diff(零 AI)',
  component: lazyPlaceholder('diff'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: 'diff 词条:entity 为实体引用(diff 载荷来自实体)',
    properties: { entity: { description: '实体引用:diff 数据来源' } },
    required: ['entity'],
  },
};

/** 词条:看板(dnd-kit;columns = 集合引用,成员按维度分列)。 */
const kanbanWord: RenderWordEntry = {
  name: 'kanban',
  title: '看板',
  description: '看板视图:columns 绑定集合引用,成员实体为卡片(分组由词条内部投影)',
  component: lazyPlaceholder('kanban'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: '看板词条:columns 为集合引用(成员为卡片)',
    properties: { columns: { description: '集合引用:卡片成员' } },
    required: ['columns'],
  },
};

/** 词条:markdown(react-markdown;entity = 实体引用,内容来自实体)。 */
const markdownWord: RenderWordEntry = {
  name: 'markdown',
  title: '文档',
  description: 'Markdown 视图:entity 绑定实体引用,内容字段来自实体(正文零 AI)',
  component: lazyPlaceholder('markdown'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: 'markdown 词条:entity 为实体引用(内容来自实体字段)',
    properties: { entity: { description: '实体引用:内容来源' } },
    required: ['entity'],
  },
};

/** 词条:详情(shadcn Sheet/Card;entity = 实体引用,四件组装直出)。 */
const detailWord: RenderWordEntry = {
  name: 'detail',
  title: '详情',
  description: '实体详情:entity 绑定实体引用,properties/actions/links 四件组装直出',
  component: lazyPlaceholder('detail'),
  supportsDimension: false,
  bindSchema: {
    type: 'object',
    description: '详情词条:entity 为实体引用(四件组装)',
    properties: { entity: { description: '实体引用:详情数据' } },
    required: ['entity'],
  },
};

/** MVP 十词条(顺序即目录展示序;spec 架构决定 1 的词条表)。 */
export const RENDER_WORDS: readonly RenderWordEntry[] = [
  tableWord,
  chartWord,
  statWord,
  timelineWord,
  flowWord,
  formWord,
  diffWord,
  kanbanWord,
  markdownWord,
  detailWord,
];

/** 词名 → 词条(未知词名 undefined;spec 生成/凝固路径的词条校验入口)。 */
export function wordOf(name: string): RenderWordEntry | undefined {
  return RENDER_WORDS.find((word) => word.name === name);
}

/** A2UI 扩展目录 JSON($id/catalogId 同 URI;components 与注册表同源)。 */
export interface RenderCatalogJson {
  $id: string;
  catalogId: string;
  components: Record<string, Record<string, unknown>>;
}

/** 产出目录 JSON(createSurface 以 catalogUrl 引用;端点直接返回)。 */
export function renderCatalogJson(): RenderCatalogJson {
  const components: Record<string, Record<string, unknown>> = {};
  for (const word of RENDER_WORDS) {
    components[word.name] = { ...word.bindSchema, description: word.description };
  }
  return { $id: CATALOG_ID, catalogId: CATALOG_ID, components };
}
