'use client';
/**
 * 用户级渲染密度(compact/comfortable/spacious)贯通层:Sidecar view 的
 * densityByNodeId 偏好经宿主 Provider 注入,词条组件经 hook 消费。
 *
 * - 缺省 comfortable:未声明偏好或非 Sidecar 场景(单树渲染)零变化;
 * - 词条按需消费(成员卡片/表格收紧行距与留白),零 per-app;
 * - 容器留白(宿主 padding)与词条密度各司其职,同一偏好值统一驱动。
 */
import { createContext, useContext, type ReactNode } from 'react';

/** 渲染密度档位(与 Sidecar view 合同同值域)。 */
export type PresentationDensity = 'compact' | 'comfortable' | 'spacious';

const PresentationDensityContext = createContext<PresentationDensity>('comfortable');

/** 宿主注入当前面的密度偏好(无 Provider 时取缺省 comfortable)。 */
export function PresentationDensityProvider({
  density,
  children,
}: {
  density: PresentationDensity;
  children: ReactNode;
}) {
  return (
    <PresentationDensityContext.Provider value={density}>
      {children}
    </PresentationDensityContext.Provider>
  );
}

/** 词条读取当前面密度偏好(缺省 comfortable)。 */
export function usePresentationDensity(): PresentationDensity {
  return useContext(PresentationDensityContext);
}
