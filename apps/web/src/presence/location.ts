'use client';

import { useMemo } from 'react';

import { usePathname, useSearchParams } from 'next/navigation';

import { presenceObservationForLocation, type PresenceObservation } from './client';

export interface LocationObservation {
  route: string;
  observation: PresenceObservation;
}

/** Join the two live App Router URL sources without interpreting either one. */
export function locationRoute(pathname: string, search: string): string {
  return search === '' ? pathname : `${pathname}?${search}`;
}

/** One browser-location observation shared by shell chrome and presence reporting. */
export function useLocationObservation(): LocationObservation {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = locationRoute(pathname, searchParams?.toString() ?? '');

  return useMemo(() => ({ route, observation: presenceObservationForLocation(route) }), [route]);
}
