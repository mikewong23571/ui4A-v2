'use client';

import { useEffect, type RefObject } from 'react';
import { useEntityCache } from '../entity-cache-provider';
import { THREAD_UPDATED_EVENT } from './desk/thread-desk-shared';

/** Rebuild bindings after a successful drawer or sibling Surface write. */
export function useContractRefresh(reloadRef: RefObject<() => void>): void {
  const cache = useEntityCache();
  useEffect(() => {
    const refresh = (event: Event): void => {
      const rel: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof rel !== 'string' || rel === '') return;
      cache.invalidateAfterExec(rel);
      reloadRef.current();
    };
    window.addEventListener(THREAD_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(THREAD_UPDATED_EVENT, refresh);
  }, [cache, reloadRef]);
}
