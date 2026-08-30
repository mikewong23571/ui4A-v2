import {
  GENERIC_INTENT_POLICY_VERSION,
  genericIntentForRole,
  parseCognitiveSemanticsProjection,
  type GenericPresentationRole,
  type SidecarDependency,
} from '@ui4a/engine';
import type { CompositionRegionShape } from '@ui4a/shared';

/** Read one bounded cognitive role from the exact public projection. */
export function cognitivePresentationRole(value: unknown): GenericPresentationRole | undefined {
  const presentation = parseCognitiveSemanticsProjection(value);
  const traits = presentation?.traits;
  if (traits?.includes('review-queue') === true) return 'review-queue';
  if (traits?.includes('work-queue') === true) return 'work-queue';
  if (traits?.includes('output-catalog') === true) return 'output-catalog';
  return undefined;
}

/** Application-agnostic region intent policy shared by every derived workspace. */
export function genericRegionIntent(
  shape: CompositionRegionShape,
  role?: GenericPresentationRole,
): string {
  return genericIntentForRole(shape, role);
}

/** Durable invalidation input for every generic-capable Sidecar planning path. */
export function genericIntentPolicyDependency(subtreeId = 'root'): SidecarDependency {
  return {
    id: 'definition:generic-intent-policy',
    subtreeId,
    kind: 'definition',
    ref: 'generic-intent-policy',
    pointers: ['$generic-intent-policy'],
    mode: 'invalidate',
    fingerprint: GENERIC_INTENT_POLICY_VERSION,
    optional: false,
  };
}
