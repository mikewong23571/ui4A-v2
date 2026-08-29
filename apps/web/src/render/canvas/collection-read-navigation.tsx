'use client';
/**
 * 宿主注入的集合读面导航(T38 Phase C 修复 2):PresentationSurfaceHost 挂载
 * 链注入「就地合并读面参数」的导航——保留当前画布 URL 的 subject 状态(组合
 * 面 = ?scope=<app> 无 focus;注视面 = 其 focus),只替换 offset/filter.*,
 * 组合面语境翻页/过滤不再 focus 落点替换单主体面。纯词条用法(宿主未注入)
 * 回退 focus 落点(collection-query 既有行为,既有测试不破)。
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { CollectionFilterPair } from './collection-query';

/** 读面导航面:只合并读面参数(offset 为 null → 清除,读回首页起点)。 */
export interface CollectionReadNavigation {
  (read: { offset?: string | null; filter?: ReadonlyArray<CollectionFilterPair> }): void;
}

const CollectionReadNavigationContext = createContext<CollectionReadNavigation | null>(null);

export function CollectionReadNavigationProvider({
  navigate,
  children,
}: {
  navigate: CollectionReadNavigation;
  children: ReactNode;
}) {
  return (
    <CollectionReadNavigationContext.Provider value={navigate}>
      {children}
    </CollectionReadNavigationContext.Provider>
  );
}

/** 宿主注入的读面导航;宿主未注入 → undefined(词条回退 focus 落点)。 */
export function useHostCollectionReadNavigation(): CollectionReadNavigation | undefined {
  return useContext(CollectionReadNavigationContext) ?? undefined;
}
