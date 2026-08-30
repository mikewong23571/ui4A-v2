// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const submit = action('submit', 'Submit for Approval', { commandId: clientField('string') }, [
  'commandId',
]);

const validate = action('validate', 'Validate Draft', { commandId: clientField('string') }, [
  'commandId',
]);

const abandon = action(
  'abandon',
  'Abandon Draft',
  {
    commandId: clientField('string'),
    reason: { type: 'string' },
  },
  ['commandId'],
);

const approve = action('approve', 'Approve', { commandId: clientField('string') }, ['commandId']);

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

function reviewDraft(input: {
  status: 'ready' | 'invalid' | 'stale';
  actions: SirenAction[];
  properties?: Record<string, unknown>;
  links?: SirenEntity['links'];
}): SirenEntity {
  const base = exactDraft();
  return {
    ...base,
    class: ['meta', 'draft', 'agent-definition', input.status],
    properties: {
      ...base.properties,
      status: input.status,
      ...input.properties,
    },
    actions: input.actions,
    links: input.links ?? base.links,
  };
}

function activationEntity(actions: SirenAction[]): SirenEntity {
  return {
    class: ['meta', 'activation', 'pending-approval'],
    properties: {
      rel: 'meta/activation:d1',
      id: 'd1',
      status: 'pending-approval',
      checks: [],
      diff: {},
    },
    actions,
    links: [],
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Draft Meta review responsibility', () => {
  it('puts existing review evidence ahead of authoring and keeps revise action-backed', () => {
    render(
      <MetaEntityRenderer
        rel="draft:d1"
        navigation={{ scope: 'governance' }}
        entity={exactDraft()}
      />,
    );

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
    render(
      <MetaEntityRenderer
        rel="meta/drafts"
        navigation={{ scope: 'governance' }}
        entity={draftCollection()}
      />,
    );

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

  it('summarizes a valid candidate as ready for the next declared responsibility', () => {
    const entity = reviewDraft({
      status: 'ready',
      actions: [submit, abandon],
      properties: {
        validation: { valid: true, issues: [] },
        checks: [{ name: 'schema', pass: true }],
      },
    });

    render(
      <MetaEntityRenderer rel="draft:d1" navigation={{ scope: 'governance' }} entity={entity} />,
    );

    const responsibility = screen.getByRole('region', { name: '审查责任点' });
    expect(responsibility.textContent).toContain('候选已通过校验');
    expect(responsibility.textContent).toContain('下一步');
    expect(responsibility.textContent).toContain('Submit for Approval');
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abandon Draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revise Draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('keeps invalid evidence in place and points repair back to the contract source or Assistant', () => {
    const entity = reviewDraft({
      status: 'invalid',
      actions: [revise, abandon],
      properties: {
        payload: { name: 'writer-candidate-v2', evaluationPolicy: {} },
      },
      links: [
        {
          rel: ['source', 'author'],
          title: '返回候选作者修复',
          href: '/api/entity?rel=agent-run%3Ar1',
        },
      ],
    });

    render(
      <MetaEntityRenderer rel="draft:d1" navigation={{ scope: 'governance' }} entity={entity} />,
    );

    const responsibility = screen.getByRole('region', { name: '审查责任点' });
    expect(responsibility.textContent).toContain('候选需要修复');
    expect(responsibility.textContent).toContain('Assistant');
    expect(screen.getByText('/evaluationPolicy')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mechanical diff' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回候选作者修复' }).getAttribute('href')).toBe(
      '/entity?rel=agent-run%3Ar1&scope=governance',
    );
    expect(screen.getByRole('button', { name: 'Revise Draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit for Approval' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /修复 Draft/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /立即修复/i })).toBeNull();

    fireEvent.click(screen.getByText('原始合同'));
    expect(screen.getByText(/writer-candidate-v2/)).toBeTruthy();
  });

  it('makes stale base/current conflict explicit while preserving the old candidate and provenance', () => {
    const entity = reviewDraft({
      status: 'stale',
      actions: [revise, validate],
      properties: {
        baseVersion: '4',
        terminalReason: 'base 4, current 7',
        payload: { name: 'writer-candidate-on-base-4' },
        provenance: {
          actor: 'agent',
          principal: 'local-user',
          sources: ['agent-run:stale-source'],
        },
      },
      links: [
        {
          rel: ['source', 'author'],
          title: '返回候选作者修复',
          href: '/api/entity?rel=agent-run%3Astale-source',
        },
      ],
    });

    render(
      <MetaEntityRenderer rel="draft:d1" navigation={{ scope: 'governance' }} entity={entity} />,
    );

    const responsibility = screen.getByRole('region', { name: '审查责任点' });
    expect(responsibility.textContent).toContain('候选基线已过期');
    expect(responsibility.textContent).toMatch(/base\s*4/i);
    expect(responsibility.textContent).toMatch(/current\s*7/i);
    expect(screen.getByRole('link', { name: '返回候选作者修复' }).getAttribute('href')).toBe(
      '/entity?rel=agent-run%3Astale-source&scope=governance',
    );
    expect(screen.getByRole('button', { name: 'Revise Draft' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Validate Draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit for Approval' })).toBeNull();

    fireEvent.click(screen.getByText('原始合同'));
    expect(screen.getByText(/writer-candidate-on-base-4/)).toBeTruthy();
    expect(screen.getByText(/agent-run:stale-source/)).toBeTruthy();
  });

  it('fresh-reads a human-only decision and does not POST when the current action disappeared', async () => {
    const currentActivation = activationEntity([approve]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(currentActivation), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(activationEntity([])), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const entity = reviewDraft({
      status: 'ready',
      actions: [submit],
      properties: {
        activation: 'meta/activation:d1',
        validation: { valid: true, issues: [] },
      },
    });

    render(
      <MetaEntityRenderer rel="draft:d1" navigation={{ scope: 'governance' }} entity={entity} />,
    );

    expect(await screen.findByText(/Human-only decision/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(screen.getByText(/\[stale-action\]/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/_meta/api/entity?rel=meta%2Factivation%3Ad1&scope=governance',
      '/_meta/api/entity?rel=meta%2Factivation%3Ad1&scope=governance',
    ]);
  });
});
