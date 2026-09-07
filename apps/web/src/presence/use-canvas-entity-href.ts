'use client';

import { useSearchParams } from 'next/navigation';
import { citationCanvasHref } from './navigation';

/** Material links carry the same explicit declarations as relationship and citation links. */
export function useCanvasEntityHref(): (rel: string) => string {
  const params = useSearchParams();
  const route = `/canvas?${params?.toString() ?? ''}`;
  return (rel) => citationCanvasHref(route, rel);
}
