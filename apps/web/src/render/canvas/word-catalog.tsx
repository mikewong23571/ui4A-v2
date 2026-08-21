'use client';
/**
 * 画布 A2UI 词汇目录(T7 Phase B / spec 架构决定 1/3,DECISIONS D12):
 * 官方 SDK(@a2ui/web_core + @a2ui/react v0_9)的自定义扩展目录。
 *
 * - 目录 = basicCatalog 布局原语 + 我们渲染词汇表的十数据词条
 *   (createSurface 以 catalogId = /api/render/catalog 的稳定 URI 协商);
 * - 词条实现 = createComponentImplementation(官方 API):props schema 用
 *   DynamicValue 联合(字面量 | {path} 数据绑定 | 函数调用),generic binder
 *   把 {path} 解析成渲染器私有数据模型的值 → 转发词条组件(words/);
 * - 词条组件零改动:目录层只是 A2UI surface 宿主与词条之间的适配。
 */
import {
  basicCatalog,
  createComponentImplementation,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import {
  Catalog,
  DataBindingSchema,
  FunctionCallSchema,
} from '@a2ui/web_core/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { z } from 'zod';

import { CATALOG_ID } from '../registry';
import { ChartWord } from '../words/chart';
import { DetailWord } from '../words/detail';
import { DiffWord } from '../words/diff';
import { FlowWord } from '../words/flow';
import { FormWord } from '../words/form';
import { KanbanWord } from '../words/kanban';
import { MarkdownWord } from '../words/markdown';
import type { WordProps } from '../words/shared';
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

/** 词条实现工厂(词名 + props 形状 → ReactComponentImplementation)。 */
function wordImplementation(
  name: string,
  shape: Record<string, z.ZodTypeAny>,
  Word: (props: WordProps) => React.ReactElement,
): ReactComponentImplementation {
  const api: ComponentApi = {
    name,
    schema: z.object({ ...commonProps, ...shape }).strict(),
  };
  return createComponentImplementation(api, ({ props }) => <Word {...toWordProps(props as WordRenderProps)} />);
}

/** 十词条的 A2UI 实现(props 全 DynamicValue;形状与注册表 bindSchema 同语义)。 */
const wordImplementations: ReactComponentImplementation[] = [
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
  wordImplementation('detail', { entity: dynamic(z.any()) }, DetailWord),
];

/**
 * 画布目录:basic 布局原语 + 十数据词条(自定义扩展目录;id 与
 * /api/render/catalog 的 $id/catalogId 同源,createSurface 协商用)。
 */
export const ui4aRenderCatalog: Catalog<ReactComponentImplementation> = new Catalog(
  CATALOG_ID,
  [...basicCatalog.components.values(), ...wordImplementations],
);
