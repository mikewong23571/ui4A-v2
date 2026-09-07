'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SirenEntity } from '@ui4a/engine';
import { useEntityCache } from '../../../components/entity-cache-provider';
import { THREAD_UPDATED_EVENT, relOf } from '../../../components/canvas/desk/thread-desk-shared';

/** An open local task follows authorized reads while its host defers a surface rebuild. */
export function useWorkRoot(bound: SirenEntity, members: SirenEntity[]) {
  const cache = useEntityCache();
  const rel = relOf(bound);
  const inputKey = JSON.stringify([bound, members]);
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{ inputKey: string; entity: SirenEntity | null }>();
  const [pendingKey, setPendingKey] = useState<string>();
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setPendingKey(inputKey);
    cache.invalidate(rel);
    const entity = await cache.get(rel).catch(() => null);
    if (generation.current !== current) return;
    setSnapshot({ inputKey, entity: entity?.properties.rel === rel ? entity : null });
    setPendingKey(undefined);
  }, [cache, inputKey, rel]);
  useEffect(() => {
    const updated = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail === rel) void refresh();
    };
    window.addEventListener(THREAD_UPDATED_EVENT, updated);
    return () => {
      generation.current += 1;
      window.removeEventListener(THREAD_UPDATED_EVENT, updated);
    };
  }, [refresh, rel]);
  const updated = snapshot?.inputKey === inputKey ? snapshot.entity : undefined;
  return {
    entity: updated === undefined ? bound : (updated ?? { ...bound, actions: [], links: [] }),
    members: updated === undefined ? members : (updated?.entities ?? []),
    refreshed: updated !== undefined,
    unavailable: updated === null,
    loading: pendingKey === inputKey,
    refresh,
  };
}
