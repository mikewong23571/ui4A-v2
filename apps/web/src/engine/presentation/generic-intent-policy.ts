import { GENERIC_INTENT_POLICY_VERSION, type SidecarDependency } from '@ui4a/engine';

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
