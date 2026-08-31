import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GENERIC_INTENT_POLICY,
  genericIntentForRole,
  genericMemberDensity,
  selectGenericFieldCandidates,
  type GenericFieldCandidate,
} from './intent';

const candidates: GenericFieldCandidate[] = [
  { path: 'properties.fields.zeta', role: 'metadata' },
  { path: 'properties.fields.title', role: 'identity' },
  { path: 'properties.fields.body', role: 'primary-content' },
  { path: 'properties.fields.state', role: 'status' },
  { path: 'properties.fields.alpha', role: 'metadata' },
  { path: 'properties.fields.source', role: 'relation' },
  { path: 'properties.fields.appendix', role: 'primary-content' },
];

function selected(intent: string, input = candidates): string[] {
  return selectGenericFieldCandidates(intent, input, GENERIC_INTENT_POLICY).map(
    ({ role, path }) => `${role}:${path}`,
  );
}

describe('generic exact-intent field selector', () => {
  it('maps semantic roles and shape-only fallbacks without domain identity', () => {
    expect(genericIntentForRole('entity', 'primary-create')).toBe('compose');
    expect(genericIntentForRole('entity', 'primary-task')).toBe('review');
    expect(genericIntentForRole('collection', 'primary-collection')).toBe('overview');
    expect(genericIntentForRole('entity', 'resume')).toBe('continue-current-task');
    expect(genericIntentForRole('collection', 'review-queue')).toBe('review');
    expect(genericIntentForRole('collection', 'output-catalog')).toBe('overview');
    expect(genericIntentForRole('collection', 'work-queue')).toBe('review');
    expect(genericIntentForRole('entity')).toBe('read');
    expect(genericIntentForRole('collection')).toBe('overview');
  });

  it('uses cognition only for an undeclared member posture', () => {
    expect(genericMemberDensity(undefined, ['output-catalog'])).toBe('table');
    expect(genericMemberDensity(undefined, ['review-queue'])).toBe('card');
    expect(genericMemberDensity(undefined, ['task-history'])).toBeUndefined();
    expect(genericMemberDensity('card', ['output-catalog'])).toBe('card');
    expect(genericMemberDensity('table', ['review-queue'])).toBe('table');
    expect(genericMemberDensity(undefined, ['output-catalog', 'review-queue'])).toBe('card');
    expect(genericMemberDensity(undefined, ['review-queue', 'output-catalog'])).toBe('card');
  });

  it('uses exact role budgets and a fixed read fallback for unknown non-empty intents', () => {
    // T40 F-03:read 放量——全部声明的 primary-content + metadata ≥1 进入。
    expect(selected('read')).toEqual([
      'identity:properties.fields.title',
      'status:properties.fields.state',
      'primary-content:properties.fields.appendix',
      'primary-content:properties.fields.body',
      'metadata:properties.fields.alpha',
    ]);
    expect(selected('overview')).toEqual([
      'identity:properties.fields.title',
      'status:properties.fields.state',
      'metadata:properties.fields.alpha',
      'metadata:properties.fields.zeta',
    ]);
    expect(selected('not-a-declared-intent')).toEqual(selected('read'));
    expect(selected(' read ')).toEqual(selected('read'));
    expect(selected('Review work waiting for me')).toEqual(selected('review'));
    expect(selected('Track work currently in motion')).toEqual(selected('track'));
    expect(selected('Follow active work lines')).toEqual([
      'identity:properties.fields.title',
      'status:properties.fields.state',
      'metadata:properties.fields.alpha',
      'relation:properties.fields.source',
    ]);
  });

  it('deduplicates canonical paths before deterministic role/path ordering', () => {
    const duplicated = [
      ...candidates,
      { path: 'properties.fields.title', role: 'metadata' as const },
      { path: 'properties.fields.alpha', role: 'metadata' as const },
    ];
    expect(selected('overview', duplicated)).toEqual(selected('overview'));
    fc.assert(
      fc.property(
        fc.shuffledSubarray(candidates, {
          minLength: candidates.length,
          maxLength: candidates.length,
        }),
        (permutation) => {
          expect(selected('review', permutation)).toEqual(selected('review'));
        },
      ),
    );
  });

  it('rejects blank intent and never returns a candidate outside the input or role budget', () => {
    expect(() => selected('   ')).toThrow(/intent/i);
    fc.assert(
      fc.property(fc.constantFrom('read', 'overview', 'review', 'track', 'unknown'), (intent) => {
        const output = selectGenericFieldCandidates(intent, candidates, GENERIC_INTENT_POLICY);
        expect(
          output.every(({ path }) => candidates.some((candidate) => candidate.path === path)),
        ).toBe(true);
        expect(new Set(output.map(({ path }) => path)).size).toBe(output.length);
      }),
    );
  });
});
