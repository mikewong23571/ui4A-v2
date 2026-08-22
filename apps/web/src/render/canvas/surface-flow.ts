/**
 * 画布 surface 规划流(T7 Phase B / spec 架构决定 2/3):纯装配层。
 *
 * spec(凝固或新生成)→ 零字面/词条形状校验 → 引用收集 → fetch 引用
 * 实体进缓存(客户端拥有数据模型)→ deref → A2UI 四消息:
 * createSurface(catalogId 协商)/ updateDataModel(渲染器私有)/
 * updateComponents(组件 props 全为数据模型路径绑定)。
 *
 * 我们侧强制(spec 架构决定 3):a) agent 侧只产 spec(引用树),数值
 * 永远经渲染器私有 updateDataModel 注入;b) deleteSurface 用于 surface
 * 重建(同 concern 重新规划前先删,避免组件 id 冲突)。
 */
import type { SirenEntity } from '@ui4a/engine';

import {
  derefSpecWithDiagnostics,
  type DerefWarning,
  type EntityCache,
} from '../deref';
import { CATALOG_ID } from '../registry';
import { ENTITY_REF_PREFIX, parseFieldRef, type BindTree, type RenderSpec } from '../spec';
import { validateSpec } from '../validator';
import { validateWordBind } from '../word-bind';

/** A2UI 服务端→客户端消息(四消息子集;SDK 的 A2uiMessage 宽形状)。 */
export type A2uiCanvasMessage =
  | { version: 'v0.9'; createSurface: { surfaceId: string; catalogId: string } }
  | { version: 'v0.9'; updateDataModel: { surfaceId: string; path: string; value: unknown } }
  | { version: 'v0.9'; updateComponents: { surfaceId: string; components: Record<string, unknown>[] } }
  | { version: 'v0.9'; deleteSurface: { surfaceId: string } };

/** 实体拉取函数(fetch 注入;404 → null 其余抛错,exec-client 同口径)。 */
export type FetchEntityFn = (rel: string) => Promise<SirenEntity | null>;

/** 一个 spec 的 surface 规划产物(消息序列 + 解引用缓存[白名单注册用])。 */
export interface SurfacePlan {
  spec: RenderSpec;
  surfaceId: string;
  messages: A2uiCanvasMessage[];
  cache: EntityCache;
  warnings: DerefWarning[];
}

/** bind 树引用的全部 rel(去重,首见序;fetch 清单)。 */
export function collectRefs(bind: BindTree): string[] {
  const refs: string[] = [];
  const visit = (node: BindTree): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    if ('ref' in node && typeof node.ref === 'string') {
      const rel = node.ref.startsWith(ENTITY_REF_PREFIX) ? node.ref.slice(ENTITY_REF_PREFIX.length) : node.ref;
      if (!refs.includes(rel)) refs.push(rel);
      return;
    }
    if ('field' in node && typeof node.field === 'string') {
      const parsed = parseFieldRef(node.field);
      if (parsed !== undefined && !refs.includes(parsed.rel)) refs.push(parsed.rel);
      return;
    }
    if ('collection' in node && typeof node.collection === 'string') {
      if (!refs.includes(node.collection)) refs.push(node.collection);
      return;
    }
    for (const child of Object.values(node)) visit(child as BindTree);
  };
  visit(bind);
  return refs;
}

/** surfaceId 消毒:非 [字母数字-_] 折成连字符并去重(确定性标识)。 */
export function surfaceIdOf(concern: string): string {
  return (
    concern
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'surface'
  );
}

/**
 * 规划一个 spec 的 surface 消息序列(校验失败/实体缺失响亮抛错)。
 * 组件树消息的 props 全为 {path} 绑定:数据与组件分离,数值只经
 * updateDataModel(渲染器私有)注入。
 */
export async function planSurface(spec: RenderSpec, fetchEntity: FetchEntityFn): Promise<SurfacePlan> {
  const validation = validateSpec(spec);
  if (!validation.valid) {
    const summary = validation.errors.map((error) => `${error.path}: ${error.message}`);
    throw new Error(`render spec 校验失败:\n${summary.join('\n')}`);
  }
  const wordBind = validateWordBind(spec.bind, spec.component);
  if (!wordBind.valid) {
    const summary = wordBind.errors.map((error) => `${error.path}: ${error.message}`);
    throw new Error(`词条形状不符(${spec.component}):\n${summary.join('\n')}`);
  }

  const cache: EntityCache = new Map();
  for (const rel of collectRefs(spec.bind)) {
    const entity = await fetchEntity(rel);
    if (entity === null) {
      throw new Error(`被引用实体 "${rel}" 不存在(404)——缺数据不造数据`);
    }
    cache.set(rel, entity);
  }

  const { props, warnings } = derefSpecWithDiagnostics(spec, cache);
  const surfaceId = surfaceIdOf(spec.concern);
  const propsPath = `/concerns/${surfaceId}/props`;
  // A2UI surface 的组件树根组件 id 固定为 'root'(A2uiSurface 渲染入口)。
  const component: Record<string, unknown> = {
    component: spec.component,
    id: 'root',
    // 词条 bind 的每个 prop → 数据模型路径绑定(数据与组件分离)。
    ...Object.fromEntries(Object.keys(props).map((key) => [key, { path: `${propsPath}/${key}` }])),
  };

  return {
    spec,
    surfaceId,
    cache,
    warnings,
    messages: [
      { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
      { version: 'v0.9', updateDataModel: { surfaceId, path: propsPath, value: props } },
      { version: 'v0.9', updateComponents: { surfaceId, components: [component] } },
    ],
  };
}
