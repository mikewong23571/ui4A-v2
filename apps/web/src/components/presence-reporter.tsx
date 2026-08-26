'use client';

import { useEffect, useRef } from 'react';

import { createPresenceReporter, postPresence } from '@/presence/client';
import { useLocationObservation } from '@/presence/location';

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
  const { observation } = useLocationObservation();
  const instanceRef = useRef<string | undefined>(undefined);
  const reporterRef = useRef<ReturnType<typeof createPresenceReporter> | undefined>(undefined);
  instanceRef.current ??= clientInstanceId();

  useEffect(() => {
    const reporter = createPresenceReporter({ transport: postPresence });
    reporterRef.current = reporter;
    return () => {
      reporter.dispose();
      if (reporterRef.current === reporter) reporterRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    try {
      reporterRef.current?.observe(observation, instanceRef.current ?? clientInstanceId());
    } catch {
      // A malformed client route cannot disable browsing or Chat.
    }
  }, [observation]);

  return null;
}
