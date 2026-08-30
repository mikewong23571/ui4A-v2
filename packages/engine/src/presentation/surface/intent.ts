import type {
  ApplicationEntryRole,
  CognitiveSemanticsTrait,
  CompositionRegionDensity,
  CompositionRegionShape,
  FieldPresentationRole,
} from '@ui4a/shared';

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

export type GenericPresentationRole = ApplicationEntryRole | CognitiveSemanticsTrait | 'identity';

const REGION_INTENT_BY_ROLE: Readonly<Partial<Record<GenericPresentationRole, string>>> =
  Object.freeze({
    identity: 'review',
    'primary-create': 'compose',
    'primary-task': 'review',
    'primary-collection': 'overview',
    resume: 'continue-current-task',
    'review-queue': 'review',
    'output-catalog': 'overview',
    'work-queue': 'review',
  });

/** Versioned, exact-match policy. Unlisted non-empty intents use the fixed read budget. */
export const GENERIC_INTENT_POLICY = Object.freeze({
  version: 'generic-intent-policy-v2',
  defaultBudget: READ_BUDGET,
  byIntent: Object.freeze({
    read: READ_BUDGET,
    overview: OVERVIEW_BUDGET,
    review: REVIEW_BUDGET,
    compose: REVIEW_BUDGET,
    'continue-current-task': REVIEW_BUDGET,
    track: TRACK_BUDGET,
    'Review work waiting for me': REVIEW_BUDGET,
    'Track work currently in motion': TRACK_BUDGET,
    'Follow active work lines': FOLLOW_BUDGET,
  }),
} satisfies GenericIntentPolicy);

export const GENERIC_INTENT_POLICY_VERSION = GENERIC_INTENT_POLICY.version;

/** Map semantic contract roles to planner intents, with shape-only safe defaults. */
export function genericIntentForRole(
  shape: CompositionRegionShape,
  role?: GenericPresentationRole,
): string {
  return (
    (role === undefined ? undefined : REGION_INTENT_BY_ROLE[role]) ??
    (shape === 'collection' ? 'overview' : 'read')
  );
}

/**
 * Pick the default member posture from cognition only. Explicit Composition density remains
 * authoritative for static compositions; an absent declaration lets output catalogs prefer a
 * table while review queues retain decision cards.
 */
export function genericMemberDensity(
  declared: CompositionRegionDensity | undefined,
  traits: readonly CognitiveSemanticsTrait[] | undefined,
): CompositionRegionDensity | undefined {
  if (declared !== undefined) return declared;
  if (traits?.includes('review-queue') === true) return 'card';
  if (traits?.includes('output-catalog') === true) return 'table';
  return undefined;
}

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
