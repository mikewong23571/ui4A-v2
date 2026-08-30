// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { GenericMetaRenderer } from './generic-renderer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function entity(
  classes: string[],
  properties: Record<string, unknown>,
  options: Partial<Pick<SirenEntity, 'href' | 'rel' | 'links' | 'entities' | 'actions'>> = {},
): SirenEntity {
  return {
    class: classes,
    properties,
    actions: options.actions ?? [],
    links: options.links ?? [],
    'guard-results': [],
    ...(options.href === undefined ? {} : { href: options.href }),
    ...(options.rel === undefined ? {} : { rel: options.rel }),
    ...(options.entities === undefined ? {} : { entities: options.entities }),
  };
}

const declaredOverview = {
  version: 1,
  fields: [
    { path: 'properties.title', title: '名称', role: 'identity', overview: true },
    { path: 'properties.intent', title: '用途', role: 'primary-content', overview: true },
    { path: 'properties.version', title: '版本', role: 'metadata', overview: true },
    { path: 'properties.status', title: '内部状态', role: 'status' },
  ],
};

const collectionAction: SirenAction = {
  name: 'ingest',
  title: 'Add Candidate',
  method: 'POST',
  href: '/_meta/api/exec',
  fields: {
    type: 'object',
    properties: { source: { type: 'string' } },
    required: ['source'],
    additionalProperties: false,
  },
};

function applicationMember(
  name: string,
  title: string,
  intent: string,
  version: number,
): SirenEntity {
  return entity(
    ['meta', 'application-definition'],
    {
      rel: `meta/application:${name}`,
      name,
      title,
      intent,
      version,
      status: `internal-${name}`,
      presentation: declaredOverview,
    },
    {
      rel: ['item'],
      href: `/_meta/api/entity?rel=${encodeURIComponent(`meta/application:${name}`)}`,
    },
  );
}

describe('generic Meta collection contract', () => {
  it('uses the review-queue trait for secondary ingress without knowing the collection class', () => {
    const futureReviewQueue = entity(
      ['collection', 'future-candidate-surface'],
      {
        rel: 'meta/future-candidates',
        count: 0,
        presentation: { version: 1, traits: ['review-queue'] },
      },
      { actions: [collectionAction] },
    );
    const { unmount } = render(<GenericMetaRenderer entity={futureReviewQueue} />);

    expect(screen.queryByRole('button', { name: 'Add Candidate' })).toBeNull();
    fireEvent.click(screen.getByText('高级 / 原始输入'));
    expect(screen.getByRole('button', { name: 'Add Candidate' })).toBeTruthy();

    unmount();
    render(
      <GenericMetaRenderer
        entity={entity(
          ['collection', 'future-catalog'],
          { rel: 'meta/future-catalog', count: 0 },
          { actions: [collectionAction] },
        )}
      />,
    );
    expect(screen.queryByText('高级 / 原始输入')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Candidate' })).toBeTruthy();
  });

  it('renders member summaries from overview declarations only and performs no exact-member fetches', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <GenericMetaRenderer
        navigation={{ scope: 'governance' }}
        entity={entity(
          ['collection', 'meta/applications'],
          { rel: 'meta/applications', count: 2 },
          {
            entities: [
              applicationMember('publishing', '内容发布', '起草并发布内容。', 3),
              applicationMember('community', '社区治理', '审核并维护讨论。', 5),
            ],
          },
        )}
      />,
    );

    const members = screen.getByRole('region', { name: /成员/ });
    expect(within(members).getByRole('link', { name: /内容发布/ })).toBeTruthy();
    expect(within(members).getByText('起草并发布内容。')).toBeTruthy();
    expect(within(members).getByText('审核并维护讨论。')).toBeTruthy();
    expect(within(members).getAllByText('版本')).toHaveLength(2);
    expect(within(members).getByText('3')).toBeTruthy();
    expect(within(members).queryByText('internal-publishing')).toBeNull();
    expect(within(members).queryByText('internal-community')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes returned count from server-declared total and announces truncation honestly', () => {
    render(
      <GenericMetaRenderer
        navigation={{ scope: 'governance' }}
        entity={entity(
          ['collection', 'meta/applications'],
          {
            rel: 'meta/applications',
            count: 2,
            total: 37,
            truncation: { kind: 'bounded', returned: 2, total: 37 },
          },
          {
            entities: [
              applicationMember('publishing', '内容发布', '起草并发布内容。', 3),
              applicationMember('community', '社区治理', '审核并维护讨论。', 5),
            ],
            links: [
              {
                rel: ['next'],
                title: '继续查看',
                href: '/_meta/api/entity?rel=meta%2Fapplications&cursor=opaque-next',
              },
            ],
          },
        )}
      />,
    );

    const summary = screen.getByRole('status', { name: '集合结果摘要' });
    expect(summary.textContent).toMatch(/当前返回\s*2\s*项/);
    expect(summary.textContent).toMatch(/匹配总数\s*37\s*项/);
    expect(summary.textContent).toMatch(/截断|仅显示/);
    expect(screen.getByRole('link', { name: '继续查看' })).toBeTruthy();
  });

  it('renders facets only from presentation declarations and never guesses from status or class', () => {
    const declared = entity(
      ['collection', 'meta/activations'],
      {
        rel: 'meta/activations',
        count: 1,
        presentation: {
          filters: [
            {
              field: 'decisionState',
              title: '决策状态',
              values: [
                { value: 'waiting', title: '待决定' },
                { value: 'settled', title: '已决定' },
              ],
            },
          ],
        },
      },
      {
        entities: [
          entity(['meta', 'activation', 'pending-approval'], {
            rel: 'meta/activation:a1',
            title: 'Activation A1',
            status: 'pending-approval',
          }),
        ],
        links: [
          {
            rel: ['self'],
            href: '/_meta/api/entity?rel=meta%2Factivations&cursor=opaque-self',
          },
        ],
      },
    );
    const { unmount } = render(
      <GenericMetaRenderer navigation={{ scope: 'governance' }} entity={declared} />,
    );

    const facet = screen.getByRole('combobox', { name: '决策状态' }) as HTMLSelectElement;
    expect([...facet.options].map((option) => option.textContent)).toEqual([
      '全部',
      '待决定',
      '已决定',
    ]);

    unmount();
    render(
      <GenericMetaRenderer
        navigation={{ scope: 'governance' }}
        entity={entity(
          ['collection', 'meta/activations'],
          { rel: 'meta/activations', count: 1 },
          {
            entities: [
              entity(['meta', 'activation', 'pending-approval'], {
                rel: 'meta/activation:a2',
                title: 'Activation A2',
                status: 'pending-approval',
              }),
            ],
          },
        )}
      />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('follows opaque Siren next/prev href values while preserving canonical rel and scope', () => {
    render(
      <GenericMetaRenderer
        navigation={{ scope: 'governance' }}
        entity={entity(
          ['collection', 'meta/applications'],
          { rel: 'meta/applications', count: 1, total: 37 },
          {
            entities: [applicationMember('publishing', '内容发布', '起草并发布内容。', 3)],
            links: [
              {
                rel: ['prev'],
                title: '上一批',
                href: '/_meta/api/entity?rel=meta%2Fapplications&cursor=opaque-prev&filter.status=pending',
              },
              {
                rel: ['next'],
                title: '下一批',
                href: '/_meta/api/entity?rel=meta%2Fapplications&cursor=opaque-next&filter.status=pending',
              },
            ],
          },
        )}
      />,
    );

    const previous = new URL(
      screen.getByRole('link', { name: /prev|上一批/ }).getAttribute('href')!,
      'http://ui4a.local',
    );
    const next = new URL(
      screen.getByRole('link', { name: /next|下一批/ }).getAttribute('href')!,
      'http://ui4a.local',
    );
    for (const [url, cursor] of [
      [previous, 'opaque-prev'],
      [next, 'opaque-next'],
    ] as const) {
      expect(url.pathname).toBe('/meta/entity');
      expect(url.searchParams.get('rel')).toBe('meta/applications');
      expect(url.searchParams.get('scope')).toBe('governance');
      expect(url.searchParams.get('cursor')).toBe(cursor);
      expect(url.searchParams.get('filter.status')).toBe('pending');
    }
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});
