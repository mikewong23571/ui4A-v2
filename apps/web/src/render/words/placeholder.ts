/**
 * 词条组件 lazy 占位(T7 Phase A Task 2):Phase B 接入真实组件前的
 * 统一占位——lazy 引用约定(调用返回 Promise<ComponentType>)成立、
 * 组件可解析,画布/骨架页接入时逐词替换为真实组件模块
 * (table→TanStack Table 等,见 registry.ts 头注)。
 */
import type { ComponentType } from 'react';

/** 产出词条占位组件(不持模块级组件引用;目录可序列化)。
 *  返回 null(合法 React 组件;Phase A 无渲染场景,Phase B 逐词替换)。 */
export function lazyPlaceholder(
  name: string,
): () => Promise<ComponentType<Record<string, unknown>>> {
  return async () => {
    const Placeholder: ComponentType<Record<string, unknown>> = () => null;
    Placeholder.displayName = `RenderWordPlaceholder(${name})`;
    return Placeholder;
  };
}
