import { describe, expect, it } from 'vitest';

import { dependencyDecision, GENERIC_INTENT_POLICY_VERSION } from '@ui4a/engine';

import { genericIntentPolicyDependency } from './generic-intent-policy';

describe('generic intent policy Sidecar dependency', () => {
  it('is a required definition dependency whose version drift invalidates the root', () => {
    const current = genericIntentPolicyDependency();
    expect(current).toMatchObject({
      id: 'definition:generic-intent-policy',
      subtreeId: 'root',
      kind: 'definition',
      mode: 'invalidate',
      fingerprint: GENERIC_INTENT_POLICY_VERSION,
      optional: false,
    });
    expect(
      dependencyDecision([{ ...current, fingerprint: 'generic-intent-policy-v0' }], [current]),
    ).toMatchObject({ valid: false, replanned: ['root'] });
  });
});
