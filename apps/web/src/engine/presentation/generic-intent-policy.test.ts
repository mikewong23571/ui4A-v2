import { describe, expect, it } from 'vitest';

import { dependencyDecision, GENERIC_INTENT_POLICY_VERSION } from '@ui4a/engine';

import { cognitivePresentationRole, genericIntentPolicyDependency } from './generic-intent-policy';

describe('generic intent policy Sidecar dependency', () => {
  it('selects cognitive responsibility by policy priority, independent of declaration order', () => {
    const roleOf = (traits: string[]) => cognitivePresentationRole({ version: 1, traits });

    expect(roleOf(['output-catalog', 'work-queue', 'review-queue'])).toBe('review-queue');
    expect(roleOf(['review-queue', 'output-catalog', 'work-queue'])).toBe('review-queue');
    expect(roleOf(['output-catalog', 'work-queue'])).toBe('work-queue');
    expect(roleOf(['work-queue', 'output-catalog'])).toBe('work-queue');
  });

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
