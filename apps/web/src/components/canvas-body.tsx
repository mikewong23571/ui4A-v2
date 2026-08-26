'use client';

import { useSearchParams } from 'next/navigation';

import { PresentationSurfaceHost } from './canvas/presentation-surface-host';
import { EntityCacheProvider } from './entity-cache-provider';

/** URL adapter for the shared Presentation host mounted by `/canvas`. */
export function CanvasBody() {
  const searchParams = useSearchParams();
  const scope = searchParams.get('scope') ?? undefined;
  return (
    <EntityCacheProvider scope={scope}>
      <PresentationSurfaceHost
        heading="画布"
        parameters={{
          concern: searchParams.get('concern') ?? undefined,
          focus: searchParams.get('focus') ?? undefined,
          roots: searchParams.get('roots') ?? undefined,
          scope,
          sidecar: searchParams.get('sidecar') ?? undefined,
          refresh: searchParams.get('refresh') ?? undefined,
        }}
      />
    </EntityCacheProvider>
  );
}
