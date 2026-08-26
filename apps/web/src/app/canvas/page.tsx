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

export default function CanvasPage() {
  return (
    // Suspense:CanvasBody 经 useSearchParams 读结构化 Presentation 参数，并在
    // 同一客户端边界创建 scope-aware 页面缓存(App Router 静态预渲染要求)。
    <Suspense>
      <CanvasBody />
    </Suspense>
  );
}
