/** Workstation home: the shared Presentation host renders the declared `my-work` workspace. */
import { Suspense } from 'react';

import { ApplicationEntryStrip } from '@/components/application-entry-strip';
import { PresentationSurfaceHost } from '@/components/canvas/presentation-surface-host';
import { EntityCacheProvider } from '@/components/entity-cache-provider';

export default function Home() {
  return (
    // Suspense:书架与 surface 宿主经 useLocationObservation 读 URL 注意力
    // (App Router 静态预渲染要求)。
    <Suspense>
      <EntityCacheProvider>
        {/* T35 F-23/F-26:书架层——应用目录条(书桌=工作线,书架=应用目录)。 */}
        <ApplicationEntryStrip />
        <PresentationSurfaceHost heading="我的事" parameters={{ focus: 'workspace:my-work' }} />
      </EntityCacheProvider>
    </Suspense>
  );
}
