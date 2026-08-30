// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { useMetaEntity } from './meta-client';
import { MetaActions } from './renderers/common';

const scope = 'governance-feedback-f3';
const otherScope = 'publishing-feedback-f3';
const revision = 'feedback-f3-v1';
const exactRel = 'meta/activation:feedback-f3-a1';
const collectionRel = 'meta/activations';
const dashboardRel = 'meta/drafts';

const approve: SirenAction = {
  name: 'approve',
  title: '批准候选版本',
  method: 'POST',
  href: '/_meta/api/exec',
  'requires-confirmation': 'high',
  fields: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

function activation(status: 'pending-approval' | 'approved'): SirenEntity {
  return {
    class: ['meta', 'activation', status],
    properties: {
      rel: exactRel,
      id: 'feedback-f3-a1',
      flow: 'future-contract-flow',
      status,
      version: 4,
      ...(status === 'approved'
        ? { 'approved-by': { actor: 'human', principal: 'user:mike' } }
        : {}),
    },
    actions: status === 'pending-approval' ? [approve] : [],
    links: [{ rel: ['self'], href: `/_meta/api/entity?rel=${encodeURIComponent(exactRel)}` }],
    'guard-results':
      status === 'pending-approval'
        ? [
            {
              action: approve.name,
              blocked: true,
              reason: 'guard 不满足: actor-is-human=false',
              guards: [{ name: 'actor-is-human', pass: false }],
            },
          ]
        : [],
  };
}

function collection(rel: string, count: number): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, count },
    actions: [],
    links: [{ rel: ['self'], href: `/_meta/api/entity?rel=${encodeURIComponent(rel)}` }],
    entities: count === 0 ? [] : [activation('pending-approval')],
    'guard-results': [],
  };
}

function fact(entity: SirenEntity | null): string {
  if (entity === null) return 'missing';
  const status = entity.properties.status;
  if (typeof status === 'string') {
    const approvedBy = entity.properties['approved-by'];
    return `${status} ${approvedBy === undefined ? '' : JSON.stringify(approvedBy)}`;
  }
  return `count ${String(entity.properties.count)}`;
}

function Projection({
  label,
  rel,
  requestedScope,
  actions = false,
}: {
  label: string;
  rel: string;
  requestedScope: string;
  actions?: boolean;
}) {
  const { entity, state } = useMetaEntity(rel, requestedScope, revision);
  return (
    <section aria-label={label}>
      <output>{state === 'ready' ? fact(entity) : state}</output>
      {actions && entity !== null && state === 'ready' ? (
        <MetaActions entity={entity} rel={rel} scope={requestedScope} />
      ) : null}
    </section>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Meta action outcome and projection synchronization', () => {
  it('settles exact, responsibility collection, and dashboard count in one scope without reload', async () => {
    let decided = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), 'http://ui4a.local');
      const requestedScope = url.searchParams.get('scope');
      if (init?.method === 'POST') {
        decided = true;
        return new Response(JSON.stringify({ entity: activation('approved') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const rel = url.searchParams.get('rel');
      if (rel === exactRel) {
        return new Response(JSON.stringify(activation(decided ? 'approved' : 'pending-approval')));
      }
      if (requestedScope === otherScope) {
        return new Response(JSON.stringify(collection(rel ?? 'missing', 7)));
      }
      return new Response(JSON.stringify(collection(rel ?? 'missing', decided ? 0 : 1)));
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(
      null,
      '',
      `/meta/entity?rel=${encodeURIComponent(exactRel)}&scope=${scope}`,
    );
    const originalUrl = window.location.href;

    render(
      <>
        <Projection label="exact decision" rel={exactRel} requestedScope={scope} actions />
        <Projection label="responsibility collection" rel={collectionRel} requestedScope={scope} />
        <Projection label="dashboard responsibility" rel={dashboardRel} requestedScope={scope} />
        <Projection
          label="other scope collection"
          rel={collectionRel}
          requestedScope={otherScope}
        />
      </>,
    );

    await waitFor(() => {
      expect(within(screen.getByRole('region', { name: 'exact decision' })).getByText(/pending/));
      expect(
        within(screen.getByRole('region', { name: 'responsibility collection' })).getByText(
          'count 1',
        ),
      );
      expect(
        within(screen.getByRole('region', { name: 'dashboard responsibility' })).getByText(
          'count 1',
        ),
      );
    });
    const readsBeforeDecision = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '批准候选版本' }));
    expect(fetchMock).toHaveBeenCalledTimes(readsBeforeDecision);
    expect(screen.getByText(/已请求.*尚未执行/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认并执行批准候选版本' }));

    await waitFor(() => {
      const exact = screen.getByRole('region', { name: 'exact decision' });
      expect(within(exact).getByText(/approved/)).toBeTruthy();
      expect(within(exact).getByText(/user:mike/)).toBeTruthy();
      expect(
        within(screen.getByRole('region', { name: 'responsibility collection' })).getByText(
          'count 0',
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByRole('region', { name: 'dashboard responsibility' })).getByText(
          'count 0',
        ),
      ).toBeTruthy();
    });
    expect(
      within(screen.getByRole('region', { name: 'other scope collection' })).getByText('count 7'),
    ).toBeTruthy();
    expect(window.location.href).toBe(originalUrl);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
