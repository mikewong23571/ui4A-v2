/** Workstation home: the shared Presentation host renders the declared `my-work` workspace. */
import { EntityCacheProvider } from '@/components/entity-cache-provider';
import { PresentationSurfaceHost } from '@/components/canvas/presentation-surface-host';

export default function Home() {
  return (
    <EntityCacheProvider>
      <PresentationSurfaceHost heading="我的事" parameters={{ focus: 'workspace:my-work' }} />
    </EntityCacheProvider>
  );
}
