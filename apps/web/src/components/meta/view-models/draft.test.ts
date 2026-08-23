import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { draftViewModel } from './draft';

const draft: SirenEntity = {
  class: ['meta', 'draft', 'agent-definition', 'invalid'],
  properties: {
    rel: 'draft:d1',
    id: 'd1',
    owner: 'local-user',
    policyScope: 'governance',
    kind: 'agent-definition',
    target: 'writer',
    status: 'invalid',
    version: 2,
    maxVersion: 2,
    expiresAt: '2026-09-22T00:00:00.000Z',
    validation: {
      valid: false,
      issues: [{ code: 'missing-eval', path: '/evaluationPolicy', message: 'Eval required' }],
    },
    checks: [
      { name: 'schema', pass: true },
      { name: 'eval', pass: false, detail: ['missing evidence'] },
    ],
    evaluation: { refs: ['eval:writer'], missing: ['eval:writer'], payloads: {} },
    provenance: { actor: 'agent', principal: 'local-user', sources: ['agent-run:r1'] },
    payload: { name: 'writer' },
    diff: { authored: [{ op: 'add', path: '/intent' }] },
  },
  actions: [
    {
      name: 'revise',
      title: 'Revise',
      method: 'POST',
      href: '/_meta/api/exec',
      fields: { type: 'object', properties: {} },
    },
  ],
  links: [],
  'guard-results': [],
};

describe('Draft review view model', () => {
  it('puts blocking issues and failed checks first while preserving review evidence', () => {
    expect(draftViewModel(draft)).toMatchObject({
      id: 'd1',
      status: 'invalid',
      issues: [{ code: 'missing-eval', path: '/evaluationPolicy', message: 'Eval required' }],
      checks: [
        { name: 'eval', pass: false },
        { name: 'schema', pass: true },
      ],
      sources: ['agent-run:r1'],
      actions: ['revise'],
    });
  });
});
