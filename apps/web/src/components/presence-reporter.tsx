'use client';

import { useEffect, useRef } from 'react';

import { usePathname, useSearchParams } from 'next/navigation';

import {
  createPresenceReporter,
  postPresence,
  presenceObservationForLocation,
} from '@/presence/client';

function clientInstanceId(): string {
  try {
    const existing = globalThis.sessionStorage?.getItem('ui4a.presence.client');
    if (existing !== null && existing !== '') return existing;
    const next = crypto.randomUUID();
    globalThis.sessionStorage?.setItem('ui4a.presence.client', next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

export function PresenceReporter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const instanceRef = useRef<string | undefined>(undefined);
  const reporterRef = useRef<ReturnType<typeof createPresenceReporter> | undefined>(undefined);
  instanceRef.current ??= clientInstanceId();
  reporterRef.current ??= createPresenceReporter({ transport: postPresence });

  useEffect(() => () => reporterRef.current?.dispose(), []);

  useEffect(() => {
    const route = searchParams.toString() === '' ? pathname : `${pathname}?${searchParams}`;
    try {
      reporterRef.current?.observe(
        presenceObservationForLocation(route),
        instanceRef.current ?? clientInstanceId(),
      );
    } catch {
      // A malformed client route cannot disable browsing or Chat.
    }
  }, [pathname, searchParams]);

  return null;
}
