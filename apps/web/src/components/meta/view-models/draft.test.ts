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

  it('maps application-bundle drafts through the same generic payload/diff/checks contract', () => {
    const bundleDraft: SirenEntity = {
      class: ['meta', 'draft', 'application-bundle', 'invalid'],
      properties: {
        rel: 'draft:d9',
        id: 'd9',
        owner: 'local-user',
        policyScope: 'governance',
        kind: 'application-bundle',
        target: 'ideas',
        status: 'invalid',
        version: 1,
        maxVersion: 1,
        validation: {
          valid: false,
          issues: [
            {
              code: 'target-name-mismatch',
              path: '/bundle/name',
              message: 'bundle name notes does not match target ideas',
            },
          ],
        },
        checks: [
          { name: 'bundle-parseable', pass: true },
          { name: 'target-name-match', pass: false },
        ],
        payload: {
          schema: 'https://ui4a.dev/application-bundle/v1',
          bundle: { name: 'notes', version: 1 },
        },
        diff: { algorithm: 'bundle-inventory', bundle: { name: 'notes', version: 1 } },
        provenance: { actor: 'human', principal: 'local-user', sources: [] },
      },
      actions: [
        {
          name: 'revise',
          title: 'Revise Draft',
          method: 'POST',
          href: '/_meta/api/exec',
          fields: { type: 'object', properties: {} },
        },
      ],
      links: [],
      'guard-results': [],
    };

    expect(draftViewModel(bundleDraft)).toMatchObject({
      kind: 'application-bundle',
      target: 'ideas',
      status: 'invalid',
      issues: [{ code: 'target-name-mismatch', path: '/bundle/name' }],
      checks: [
        { name: 'target-name-match', pass: false },
        { name: 'bundle-parseable', pass: true },
      ],
      payload: {
        schema: 'https://ui4a.dev/application-bundle/v1',
        bundle: { name: 'notes', version: 1 },
      },
      diff: { algorithm: 'bundle-inventory' },
      actions: ['revise'],
    });
  });
});
