import type { FieldPresentationRole } from '@ui4a/shared';

import type { SemanticRegionRole } from './types';

export interface GenericFieldCandidate {
  path: string;
  role: FieldPresentationRole;
}

export type GenericRoleBudget = Readonly<Partial<Record<FieldPresentationRole, number>>>;

export interface GenericIntentPolicy {
  version: string;
  defaultBudget: GenericRoleBudget;
  byIntent: Readonly<Record<string, GenericRoleBudget>>;
}

const READ_BUDGET: GenericRoleBudget = Object.freeze({
  identity: 1,
  status: 1,
  'primary-content': 1,
});
const OVERVIEW_BUDGET: GenericRoleBudget = Object.freeze({
  identity: 1,
  status: 1,
  metadata: 2,
});
const REVIEW_BUDGET: GenericRoleBudget = Object.freeze({
  identity: 1,
  status: 1,
  'primary-content': 2,
  metadata: 2,
  relation: 1,
});
const TRACK_BUDGET: GenericRoleBudget = Object.freeze({
  identity: 1,
  status: 1,
  metadata: 2,
  relation: 1,
});
const FOLLOW_BUDGET: GenericRoleBudget = Object.freeze({
  identity: 1,
  status: 1,
  metadata: 1,
  relation: 1,
});

/** Versioned, exact-match policy. Unlisted non-empty intents use the fixed read budget. */
export const GENERIC_INTENT_POLICY = Object.freeze({
  version: 'generic-intent-policy-v1',
  defaultBudget: READ_BUDGET,
  byIntent: Object.freeze({
    read: READ_BUDGET,
    overview: OVERVIEW_BUDGET,
    review: REVIEW_BUDGET,
    track: TRACK_BUDGET,
    'Review work waiting for me': REVIEW_BUDGET,
    'Track work currently in motion': TRACK_BUDGET,
    'Follow active work lines': FOLLOW_BUDGET,
  }),
} satisfies GenericIntentPolicy);

export const GENERIC_INTENT_POLICY_VERSION = GENERIC_INTENT_POLICY.version;

export const GENERIC_ROLE_ORDER: Readonly<Record<SemanticRegionRole, number>> = {
  identity: 0,
  status: 1,
  'primary-content': 2,
  metadata: 3,
  actions: 4,
  relation: 5,
  diagnostic: 6,
};

/** Select only canonical field paths; this function has no entity, class, rel or value input. */
export function selectGenericFieldCandidates(
  intent: string,
  candidates: readonly GenericFieldCandidate[],
  policy: GenericIntentPolicy = GENERIC_INTENT_POLICY,
): GenericFieldCandidate[] {
  if (intent.trim() === '') throw new Error('generic intent must not be blank');
  const budget = policy.byIntent[intent] ?? policy.defaultBudget;
  const seenPaths = new Set<string>();
  const roleCounts = new Map<FieldPresentationRole, number>();
  const selected: GenericFieldCandidate[] = [];
  const canonical = [...candidates].sort((left, right) => {
    const roleOrder = GENERIC_ROLE_ORDER[left.role] - GENERIC_ROLE_ORDER[right.role];
    return roleOrder !== 0 ? roleOrder : left.path.localeCompare(right.path);
  });

  for (const candidate of canonical) {
    if (seenPaths.has(candidate.path)) continue;
    seenPaths.add(candidate.path);
    const limit = budget[candidate.role] ?? 0;
    const count = roleCounts.get(candidate.role) ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error(`generic intent role budget for ${candidate.role} is invalid`);
    }
    if (count >= limit) continue;
    selected.push({ ...candidate });
    roleCounts.set(candidate.role, count + 1);
  }
  return selected;
}
