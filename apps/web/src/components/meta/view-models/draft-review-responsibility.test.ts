import { describe, expect, it } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { draftReviewResponsibility } from './draft-review-responsibility';

function action(name: string, title: string): SirenAction {
  return {
    name,
    title,
    method: 'POST',
    href: '/_meta/api/exec',
    fields: { type: 'object', properties: {} },
  };
}

function entity(input: Partial<SirenEntity> = {}): SirenEntity {
  return {
    class: ['meta', 'draft'],
    properties: { status: 'ready', validation: { valid: true } },
    actions: [],
    links: [],
    'guard-results': [],
    ...input,
  };
}

describe('Draft review responsibility projection', () => {
  it('describes only the actions declared by the current Draft contract', () => {
    const responsibility = draftReviewResponsibility(
      entity({ actions: [action('submit', 'Submit for Approval'), action('abandon', 'Abandon')] }),
    );

    expect(responsibility).toMatchObject({
      state: 'ready',
      title: '候选已通过校验',
      actions: ['Submit for Approval', 'Abandon'],
    });
    expect(responsibility.description).not.toContain('Revise');
  });

  it('projects an unknown future action from its contract title without renderer changes', () => {
    const responsibility = draftReviewResponsibility(
      entity({ actions: [action('request-independent-review', 'Request independent review')] }),
    );

    expect(responsibility.actions).toEqual(['Request independent review']);
    expect(responsibility.description).toContain('Request independent review');
  });

  it('keeps stale status authoritative over an earlier successful validation', () => {
    const responsibility = draftReviewResponsibility(
      entity({
        properties: {
          status: 'stale',
          validation: { valid: true },
          terminalReason: 'base 4, current 7',
        },
        actions: [action('revise', 'Revise Draft'), action('validate', 'Validate Draft')],
      }),
    );

    expect(responsibility).toMatchObject({ state: 'stale', title: '候选基线已过期' });
    expect(responsibility.description).toContain('base 4, current 7');
  });

  it('prefers a titled author/source relationship without inventing a destination', () => {
    const responsibility = draftReviewResponsibility(
      entity({
        properties: { status: 'invalid', validation: { valid: false } },
        links: [
          { rel: ['source'], href: '/api/entity?rel=event%3Ae1' },
          {
            rel: ['source', 'author'],
            title: '返回作者',
            href: '/api/entity?rel=agent-run%3Ar1',
          },
        ],
      }),
    );

    expect(responsibility.repairLink).toEqual({
      title: '返回作者',
      href: '/api/entity?rel=agent-run%3Ar1',
    });
  });
});
