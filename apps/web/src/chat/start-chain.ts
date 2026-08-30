import type { EngineSnapshot } from '@ui4a/shared';

import type { Situation } from '../engine/situation';

type Applications = NonNullable<EngineSnapshot['applications']>;

/** Resolve the first contract entity from assembled situation facts, without probing reachability. */
export function startRelFromSituation(situation: Situation, applications: Applications): string {
  if (typeof situation.focus === 'string') return situation.focus;

  const entry = situation.scope === undefined ? undefined : applications[situation.scope]?.entry;
  if (entry !== undefined && entry !== '') return entry;

  return situation.site === 'meta' ? 'meta/flows' : 'articles';
}
