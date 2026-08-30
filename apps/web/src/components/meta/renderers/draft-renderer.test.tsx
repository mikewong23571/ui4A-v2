// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { MetaEntityRenderer } from './meta-entity-renderer';

const clientField = (type: 'string' | 'integer'): Record<string, unknown> => ({
  type,
  'x-ui4a-input-owner': 'client',
});

function action(
  name: string,
  title: string,
  properties: Record<string, Record<string, unknown>>,
  required: string[],
): SirenAction {
  return {
    name,
    title,
    method: 'POST',
    href: '/_meta/api/exec',
    fields: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

const revise = action(
  'revise',
  'Revise Draft',
  {
    commandId: clientField('string'),
    baseVersion: clientField('integer'),
    targetBaseVersion: { type: 'string' },
    payload: {},
  },
  ['commandId', 'baseVersion', 'payload'],
);

const create = action(
  'create',
  'Create Draft',
  {
    kind: { type: 'string', enum: ['flow-definition', 'agent-definition'] },
    target: { type: 'string', minLength: 1 },
    commandId: clientField('string'),
    payload: {},
    sources: { type: 'array', items: { type: 'string' }, maxItems: 64 },
  },
  ['kind', 'target', 'commandId', 'payload'],
);

function exactDraft(): SirenEntity {
  return {
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
      validation: {
        valid: false,
        issues: [
          {
            code: 'missing-eval',
            path: '/evaluationPolicy',
            message: 'Eval evidence is required',
          },
        ],
      },
      checks: [
        { name: 'schema', pass: true },
        { name: 'eval', pass: false, detail: ['missing evidence'] },
      ],
      evaluation: { refs: ['eval:writer'], missing: ['eval:writer'], payloads: {} },
      provenance: {
        actor: 'agent',
        principal: 'local-user',
        sources: ['agent-run:r1'],
      },
      payload: { name: 'writer', version: 2 },
      diff: { authored: [{ op: 'add', path: '/evaluationPolicy' }] },
    },
    actions: [
      revise,
      action('validate', 'Validate Draft', { commandId: clientField('string') }, ['commandId']),
      action(
        'abandon',
        'Abandon Draft',
        {
          commandId: clientField('string'),
          reason: { type: 'string' },
        },
        ['commandId'],
      ),
    ],
    links: [{ rel: ['source'], href: '/api/entity?rel=agent-run%3Ar1' }],
    'guard-results': [],
  };
}

function draftCollection(): SirenEntity {
  return {
    class: ['collection', 'meta/drafts'],
    properties: {
      rel: 'meta/drafts',
      count: 1,
      limit: 20,
      presentation: { version: 1, traits: ['review-queue'] },
    },
    actions: [create],
    links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta%2Fdrafts' }],
    entities: [
      {
        class: ['meta', 'draft', 'agent-definition', 'invalid'],
        rel: ['item'],
        href: '/_meta/api/entity?rel=draft%3Ad1',
        properties: {
          rel: 'draft:d1',
          id: 'd1',
          kind: 'agent-definition',
          target: 'writer',
          status: 'invalid',
          version: 2,
          presentation: {
            version: 1,
            fields: [
              {
                path: 'properties.target',
                title: '目标',
                role: 'identity',
                overview: true,
              },
              {
                path: 'properties.kind',
                title: '类型',
                role: 'metadata',
                overview: true,
              },
              {
                path: 'properties.status',
                title: '状态',
                role: 'status',
                overview: true,
              },
              {
                path: 'properties.version',
                title: '版本',
                role: 'metadata',
                overview: true,
              },
            ],
          },
        },
        actions: [],
        links: [],
      },
    ],
    'guard-results': [],
  };
}

afterEach(cleanup);

describe('Draft Meta review responsibility', () => {
  it('puts existing review evidence ahead of authoring and keeps revise action-backed', () => {
    render(<MetaEntityRenderer rel="draft:d1" scope="governance" entity={exactDraft()} />);

    const diff = screen.getByRole('heading', { name: 'Mechanical diff' });
    const checks = screen.getByRole('heading', { name: 'Checks' });
    const provenance = screen.getByRole('heading', { name: 'Sources & provenance' });
    const actions = screen.getByRole('heading', { name: '可用动作' });

    expect(diff.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checks.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      provenance.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '修订 Candidate' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保存修订' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Revise Draft' }));
    expect(screen.getByLabelText(/targetBaseVersion/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^commandId/i)).toBeNull();
    expect(screen.queryByLabelText(/^baseVersion/i)).toBeNull();
    expect(screen.queryByLabelText(/^policyScope/i)).toBeNull();
    expect(screen.queryByLabelText(/^actor/i)).toBeNull();
    expect(screen.queryByLabelText(/^principal/i)).toBeNull();
    expect(screen.queryByLabelText(/^schemaRef/i)).toBeNull();
    expect(screen.queryByLabelText(/^provider/i)).toBeNull();
    expect(screen.queryByLabelText(/^profile/i)).toBeNull();
    expect(document.querySelector('button[type="submit"][data-action="revise"]')).toBeTruthy();
  });

  it('makes existing Drafts the collection path and keeps raw creation behind a secondary disclosure', () => {
    render(<MetaEntityRenderer rel="meta/drafts" scope="governance" entity={draftCollection()} />);

    expect(screen.getByRole('link', { name: /writer/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create Draft' })).toBeNull();

    fireEvent.click(screen.getByText('高级 / 原始输入'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    expect(screen.getByLabelText(/kind/i)).toBeTruthy();
    expect(screen.getByLabelText(/target/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^commandId/i)).toBeNull();
    expect(screen.queryByLabelText(/^policyScope/i)).toBeNull();
    expect(screen.queryByLabelText(/^actor/i)).toBeNull();
    expect(screen.queryByLabelText(/^principal/i)).toBeNull();
    expect(screen.queryByLabelText(/^schemaRef/i)).toBeNull();
    expect(screen.queryByLabelText(/^provider/i)).toBeNull();
    expect(screen.queryByLabelText(/^profile/i)).toBeNull();
    expect(document.querySelector('button[type="submit"][data-action="create"]')).toBeTruthy();
  });
});
