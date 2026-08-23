import { describe, expect, it } from 'vitest';

import { resolveSubmissionPolicy, validateSubmissionPolicy } from './policy';

describe('SubmissionPolicy', () => {
  it('defaults external writable input to draft and derived resources to none', () => {
    expect(resolveSubmissionPolicy({ actor: 'agent', writable: true }).policy.mode).toBe('draft');
    expect(resolveSubmissionPolicy({ actor: 'agent', writable: false }).policy.mode).toBe('none');
  });

  it('makes none absorbing and ignores request-side override', () => {
    const decision = resolveSubmissionPolicy({
      actor: 'agent',
      writable: true,
      resource: { mode: 'none' },
      action: { mode: 'direct', actors: ['agent'], scopes: ['publishing'] },
      requestMode: 'direct',
      scope: 'publishing',
    });
    expect(decision.policy.mode).toBe('none');
    expect(decision.allowed).toBe(false);
  });

  it('rejects direct policies without low-risk governed action evidence', () => {
    expect(
      validateSubmissionPolicy({ mode: 'direct' }, { declaredAction: false }).some((issue) =>
        issue.includes('declared action'),
      ),
    ).toBe(true);
    expect(
      validateSubmissionPolicy(
        { mode: 'direct' },
        { declaredAction: true, hasSchema: true, hasAuthorization: true, risk: 'low' },
      ),
    ).toEqual([]);
  });
});
