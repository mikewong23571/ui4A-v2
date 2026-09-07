'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useEntityCache } from '../entity-cache-provider';
import { THREAD_UPDATED_EVENT } from './desk/thread-desk-shared';

/** Rebuild bindings after a successful drawer or sibling Surface write. */
export function useContractRefresh(reloadRef: RefObject<() => void>): () => () => void {
  const cache = useEntityCache();
  const holds = useRef(0);
  const dirty = useRef(false);
  const mounted = useRef(false);
  const hold = useCallback(() => {
    holds.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current -= 1;
      if (holds.current === 0 && dirty.current && mounted.current) {
        dirty.current = false;
        reloadRef.current();
      }
    };
  }, [reloadRef]);
  useEffect(() => {
    mounted.current = true;
    const refresh = (event: Event): void => {
      const rel: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof rel !== 'string' || rel === '') return;
      cache.invalidateAfterExec(rel);
      if (holds.current > 0) dirty.current = true;
      else reloadRef.current();
    };
    window.addEventListener(THREAD_UPDATED_EVENT, refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener(THREAD_UPDATED_EVENT, refresh);
    };
  }, [cache, reloadRef]);
  return hold;
}
