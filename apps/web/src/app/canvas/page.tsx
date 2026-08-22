/**
 * 画布页壳(T7 Phase B):A2UI surface 宿主。
 *
 * 壳只挂页面级实体缓存承载(T12 Phase B Task 3:EntityCacheProvider,生命周期 =
 * 本页——同页多 surface 共享同一 PageEntityCache,同 rel 跨 surface 零重复
 * fetch;跨页面不共享);目录协商、surface 规划与动作接线在 CanvasBody
 * (组件级可测,见 components/canvas-body.tsx)。
 */
import { Suspense } from 'react';

import { CanvasBody } from '@/components/canvas-body';
import { EntityCacheProvider } from '@/components/entity-cache-provider';

export default function CanvasPage() {
  return (
    <EntityCacheProvider>
      {/* Suspense:CanvasBody 经 useSearchParams 读 ?concern=(App Router 静态
          预渲染的边界要求;渲染期读参数,不阻断数据流)。 */}
      <Suspense>
        <CanvasBody />
      </Suspense>
    </EntityCacheProvider>
  );
}
