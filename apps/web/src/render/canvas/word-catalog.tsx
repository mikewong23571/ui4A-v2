'use client';
/**
 * 画布 A2UI 词汇目录(T7 Phase B / spec 架构决定 1/3,DECISIONS D12):
 * 官方 SDK(@a2ui/web_core + @a2ui/react v0_9)的自定义扩展目录。
 *
 * - 目录 = basicCatalog 布局原语 + 我们渲染词汇表的十数据词条
 *   (createSurface 以 catalogId = /api/render/catalog 的稳定 URI 协商);
 * - 词条实现 = createBinderlessComponentImplementation(官方 API):渲染期
 *   经 dataContext.resolveDynamicValue 一次性同步解析 {path} 绑定(静态投影
 *   无响应式消费方;响应式 generic binder 与词条内 store 钩子互通知会死循环,
 *   见 DECISIONS D18)→ 转发词条组件(words/);
 * - 词条组件零改动:目录层只是 A2UI surface 宿主与词条之间的适配。
 */
import {
  basicCatalog,
  createBinderlessComponentImplementation,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import { Catalog, DataBindingSchema, FunctionCallSchema } from '@a2ui/web_core/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { z } from 'zod';

import { CATALOG_ID } from '../registry';
import { usePresentationDensity } from '../presentation-density';
import { ChartWord } from '../words/chart';
import { CollectionFiltersWord } from '../words/collection-filters';
import { DetailWord } from '../words/detail';
import { DiffWord } from '../words/diff';
import { EntityLinkWord } from '../words/entity-link';
import { FlowWord } from '../words/flow';
import { FormWord } from '../words/form';
import { KanbanWord } from '../words/kanban';
import { MemberCardWord } from '../words/member-card';
import { MemberTableWord } from '../words/member-table';
import { EmptyStateWord } from '../words/empty-state';
import { MarkdownWord } from '../words/markdown';
import type { WordProps } from '../words/shared';
import { PageLinksWord } from '../words/page-links';
import { StatWord } from '../words/stat';
import { TableWord } from '../words/table';
import { TimelineWord } from '../words/timeline';

/** 目录公共 props(basic 原语同形状:weight/accessibility)。 */
const commonProps = {
  accessibility: z.record(z.string(), z.any()).optional(),
  weight: z.number().optional(),
};

/** DynamicValue 联合:字面量 | {path} 数据绑定 | {call} 函数调用。 */
function dynamic(base: z.ZodTypeAny): z.ZodTypeAny {
  return z.union([base, DataBindingSchema, FunctionCallSchema]);
}

/** 词条 props(schema 推断后的宽类型;binder 解析后的值转发词条组件)。 */
type WordRenderProps = Record<string, unknown> & { isValid?: boolean; validationErrors?: string[] };

/** 词条渲染适配:binder 解析后的 props → 词条组件(剥离 binder 注入的元键)。 */
function toWordProps(props: WordRenderProps): WordProps {
  const { isValid: _isValid, validationErrors: _validationErrors, ...rest } = props;
  return rest;
}

/**
 * 词条实现工厂(词名 + props 形状 → ReactComponentImplementation)。
 *
 * 一次性同步解析(2026-08-22 卡死修复):用 binderless 实现 + resolveDynamicValue
 * 渲染期直读数据模型,**不建响应式订阅**。依据:本站 surface 是静态投影——
 * agent 不发 updateDataModel(spec 架构决定 3),action 执行后整面 reload 重建,
 * 响应式绑定无消费方;而官方 generic binder 的 useSyncExternalStore 与词条内部
 * 的 store 钩子(如 TanStack useReactTable 渲染期 setOptions)相互通知会形成
 * render/commit 死循环(实测:canvas 页任意二次状态变更主线程卡死)。
 */
function wordImplementation(
  name: string,
  shape: Record<string, z.ZodTypeAny>,
  Word: (props: WordProps) => React.ReactElement,
): ReactComponentImplementation {
  const api: ComponentApi = {
    name,
    schema: z.object({ ...commonProps, ...shape }).strict(),
  };
  return createBinderlessComponentImplementation(api, ({ context }) => {
    // 用户级密度偏好贯通:同面偏好注入每个词条(词条按需消费,零 per-app;
    // 无 Provider 时 hook 取 comfortable,行为不变)。
    const density = usePresentationDensity();
    const raw = context.componentModel.properties as Record<string, unknown>;
    const resolved = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        // DynamicValue 联合(字面量 | {path} | {call});componentModel.properties
        // 的存储类型是 unknown,schema 已在 createSurface 协商侧把关。
        context.dataContext.resolveDynamicValue(
          value as Parameters<typeof context.dataContext.resolveDynamicValue>[0],
        ),
      ]),
    );
    return <Word {...toWordProps(resolved as WordRenderProps)} density={density} />;
  });
}

/** Plain semantic text avoids Basic Text's implicit Markdown renderer contract. */
function SemanticTextWord(props: WordProps) {
  const value = String(props.value ?? '');
  if (props.variant === 'heading') {
    return <h1 className="text-2xl font-semibold tracking-tight">{value}</h1>;
  }
  if (props.variant === 'status') {
    return <em className="text-sm not-italic text-muted-foreground">{value}</em>;
  }
  return <p className="whitespace-pre-wrap leading-7">{value}</p>;
}

/** 十词条的 A2UI 实现(props 全 DynamicValue;形状与注册表 bindSchema 同语义)。 */
const wordImplementations: ReactComponentImplementation[] = [
  wordImplementation(
    'semantic-text',
    {
      value: dynamic(z.union([z.string(), z.number(), z.boolean()])),
      variant: z.enum(['heading', 'prose', 'status']),
    },
    SemanticTextWord,
  ),
  wordImplementation(
    'table',
    { rows: dynamic(z.array(z.any())), caption: dynamic(z.string()).optional() },
    TableWord,
  ),
  wordImplementation(
    'chart',
    { series: dynamic(z.array(z.any())), caption: dynamic(z.string()).optional() },
    ChartWord,
  ),
  wordImplementation(
    'stat',
    { value: dynamic(z.union([z.string(), z.number()])), label: dynamic(z.string()).optional() },
    StatWord,
  ),
  wordImplementation(
    'timeline',
    { events: dynamic(z.array(z.any())), caption: dynamic(z.string()).optional() },
    TimelineWord,
  ),
  wordImplementation('flow', { graph: dynamic(z.any()) }, FlowWord),
  wordImplementation('form', { entity: dynamic(z.any()) }, FormWord),
  wordImplementation('diff', { entity: dynamic(z.any()) }, DiffWord),
  wordImplementation('kanban', { columns: dynamic(z.array(z.any())) }, KanbanWord),
  wordImplementation('markdown', { entity: dynamic(z.any()) }, MarkdownWord),
  wordImplementation(
    'detail',
    { entity: dynamic(z.any()), mode: z.enum(['full', 'actions', 'links']).optional() },
    DetailWord,
  ),
  wordImplementation(
    'entity-link',
    {
      label: dynamic(z.string()),
      rel: dynamic(z.string()),
      status: dynamic(z.string()).optional(),
      detail: dynamic(z.string()).optional(),
    },
    EntityLinkWord,
  ),
  wordImplementation(
    'member-card',
    {
      label: dynamic(z.string()),
      rel: dynamic(z.string()),
      status: dynamic(z.string()).optional(),
      detail: dynamic(z.string()).optional(),
      actions: dynamic(z.array(z.any())).optional(),
      guardResults: dynamic(z.array(z.any())).optional(),
      fields: dynamic(z.record(z.string(), z.any())).optional(),
      presentations: dynamic(z.array(z.any())).optional(),
    },
    MemberCardWord,
  ),
  wordImplementation(
    'member-table',
    {
      label: dynamic(z.string()),
      rel: dynamic(z.string()),
      status: dynamic(z.string()).optional(),
      detail: dynamic(z.string()).optional(),
      actions: dynamic(z.array(z.any())).optional(),
      guardResults: dynamic(z.array(z.any())).optional(),
      fields: dynamic(z.record(z.string(), z.any())).optional(),
      presentations: dynamic(z.array(z.any())).optional(),
    },
    MemberTableWord,
  ),
  wordImplementation(
    'collection-filters',
    {
      declarations: dynamic(z.array(z.any())),
      links: dynamic(z.array(z.any())).optional(),
    },
    CollectionFiltersWord,
  ),
  wordImplementation('page-links', { links: dynamic(z.array(z.any())) }, PageLinksWord),
  wordImplementation('empty-state', { meaning: dynamic(z.string()) }, EmptyStateWord),
];

/**
 * 画布目录:basic 布局原语 + 十数据词条(自定义扩展目录;id 与
 * /api/render/catalog 的 $id/catalogId 同源,createSurface 协商用)。
 */
export const ui4aRenderCatalog: Catalog<ReactComponentImplementation> = new Catalog(CATALOG_ID, [
  ...basicCatalog.components.values(),
  ...wordImplementations,
]);
