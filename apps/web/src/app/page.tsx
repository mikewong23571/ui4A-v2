/** Home supplies stable navigation; all work content comes from the shared Presentation pipeline. */
import { Suspense } from 'react';
import { ApplicationEntryStrip } from '@/components/application-entry-strip';
import { PresentationSurfaceHost } from '@/components/canvas/presentation-surface-host';
import { EntityCacheProvider } from '@/components/entity-cache-provider';
import { HomeEntry } from '@/components/stage/home-entry';
import { PresentationHeadingLevel } from '@/render/canvas/heading-level';

export default function Home() {
  return (
    <Suspense>
      <EntityCacheProvider>
        <header className="mb-6 space-y-4">
          <h1 className="text-2xl font-semibold">我的事</h1>
          <HomeEntry />
        </header>
        <PresentationHeadingLevel level={2}>
          <PresentationSurfaceHost parameters={{ focus: 'workspace:my-work' }} />
        </PresentationHeadingLevel>
        <details className="mt-8 border-t pt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">应用与能力</summary>
          <div className="mt-4">
            <ApplicationEntryStrip />
          </div>
        </details>
      </EntityCacheProvider>
    </Suspense>
  );
}
