'use client';

import { useSearchParams } from 'next/navigation';

import { PresentationSurfaceHost } from './canvas/presentation-surface-host';

/** URL adapter for the shared Presentation host mounted by `/canvas`. */
export function CanvasBody() {
  const searchParams = useSearchParams();
  return (
    <PresentationSurfaceHost
      heading="画布"
      parameters={{
        concern: searchParams.get('concern') ?? undefined,
        focus: searchParams.get('focus') ?? undefined,
        roots: searchParams.get('roots') ?? undefined,
        sidecar: searchParams.get('sidecar') ?? undefined,
        refresh: searchParams.get('refresh') ?? undefined,
      }}
    />
  );
}
