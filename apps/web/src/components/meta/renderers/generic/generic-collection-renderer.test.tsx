// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { useMetaEntity } from '../meta-client';
import { GenericMetaRenderer } from './generic-renderer';
import { MetaEntityRenderer } from './meta-entity-renderer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function entity(
  classes: string[],
  properties: Record<string, unknown>,
  options: Partial<
    Pick<SirenEntity, 'href' | 'rel' | 'links' | 'entities' | 'actions' | 'guard-results'>
  > = {},
): SirenEntity {
  return {
    class: classes,
    properties,
    actions: options.actions ?? [],
    links: options.links ?? [],
    'guard-results': options['guard-results'] ?? [],
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
  it('renders declared collection actions directly for review-queue collections (D67.1)', () => {
    const futureReviewQueue = entity(
      ['collection', 'future-candidate-surface'],
      {
        rel: 'meta/future-candidates',
        count: 0,
        presentation: { version: 1, traits: ['review-queue'] },
      },
      { actions: [collectionAction] },
    );
    render(<GenericMetaRenderer entity={futureReviewQueue} />);

    // T48/D67.1:集合级 actions 是人类主路径的一等入口,不再藏进二级 disclosure。
    expect(screen.queryByText('高级 / 原始输入')).toBeNull();
    expect(screen.getByRole('heading', { name: '集合动作' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Candidate' })).toBeTruthy();

    cleanup();
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
    expect(screen.getByRole('heading', { name: '集合动作' })).toBeTruthy();
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
    expect(
      within(members)
        .getByRole('link', { name: /内容发布/ })
        .getAttribute('data-nav'),
    ).toBe('meta:collection-member');
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
    expect(screen.getByRole('link', { name: '继续查看' }).getAttribute('data-nav')).toBe(
      'meta:collection-page',
    );
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

  it('renders the declared create action on the meta/drafts collection with contract-mapped controls only', () => {
    const create: SirenAction = {
      name: 'create',
      title: 'Create Draft',
      method: 'POST',
      href: '/_meta/api/exec',
      fields: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['flow-definition', 'agent-definition', 'application-bundle'],
          },
          target: { type: 'string', minLength: 1 },
          payload: {},
        },
        required: ['kind', 'target', 'payload'],
        additionalProperties: false,
      },
    };
    const purge: SirenAction = {
      name: 'purge',
      title: 'Purge Drafts',
      method: 'POST',
      href: '/_meta/api/exec',
      fields: { type: 'object', properties: {}, required: [], additionalProperties: false },
    };
    render(
      <GenericMetaRenderer
        navigation={{ scope: 'governance-p5-a1' }}
        entity={entity(
          ['collection', 'meta/drafts'],
          { rel: 'meta/drafts', count: 1, presentation: { version: 1, traits: ['review-queue'] } },
          {
            actions: [create, purge],
            entities: [applicationMember('publishing', '内容发布', '起草并发布内容。', 3)],
            'guard-results': [
              {
                action: 'purge',
                blocked: true,
                reason: 'guard 不满足: quota-exceeded',
                guards: [{ name: 'quota', pass: false }],
              },
            ],
          },
        )}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Create Draft' });
    expect(trigger.getAttribute('data-presentation-action')).toBe('open-form');

    fireEvent.click(trigger);
    expect(document.querySelector('button[type="submit"][data-action="create"]')).toBeTruthy();
    const kind = screen.getByLabelText(/^kind/i) as HTMLSelectElement;
    expect([...kind.options].map((option) => option.textContent)).toContain('application-bundle');
    expect(screen.getByLabelText(/^target/i)).toBeTruthy();
    expect(screen.getByLabelText(/^payload/i)).toBeTruthy();
    // I3:页面上的每个可提交控件都映射当前合同声明的 action。
    const declared = new Set(['create', 'purge']);
    for (const button of document.querySelectorAll('button[data-action]')) {
      expect(declared.has(button.getAttribute('data-action')!)).toBe(true);
    }
    // guard 投影:被合同 guard 拦截的声明动作渲染为 disabled 并如实给出原因。
    const purgeButton = screen.getByRole('button', { name: 'Purge Drafts' }) as HTMLButtonElement;
    expect(purgeButton.disabled).toBe(true);
    expect(purgeButton.title).toContain('quota-exceeded');
  });

  it('omits the collection actions section entirely for read-only collections', () => {
    render(
      <GenericMetaRenderer
        navigation={{ scope: 'governance' }}
        entity={entity(
          ['collection', 'meta/flows'],
          { rel: 'meta/flows', count: 1 },
          { entities: [applicationMember('publishing', '内容发布', '起草并发布内容。', 3)] },
        )}
      />,
    );

    expect(screen.queryByRole('heading', { name: '集合动作' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('refreshes the collection and surfaces the created Draft after a successful create', async () => {
    const scope = 'governance-p5-loop';
    const draftsCreate: SirenAction = {
      name: 'create',
      title: 'Create Draft',
      method: 'POST',
      href: '/_meta/api/exec',
      fields: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['flow-definition', 'agent-definition', 'application-bundle'],
          },
          target: { type: 'string', minLength: 1 },
          commandId: { type: 'string', minLength: 1, 'x-ui4a-input-owner': 'client' },
          payload: {},
        },
        required: ['kind', 'target', 'commandId', 'payload'],
        additionalProperties: false,
      },
    };
    const draftMember = (target: string): SirenEntity => ({
      class: ['meta', 'draft', 'application-bundle', 'invalid'],
      rel: ['item'],
      href: `/_meta/api/entity?rel=${encodeURIComponent(`draft:${target}`)}`,
      properties: {
        rel: `draft:${target}`,
        target,
        kind: 'application-bundle',
        status: 'invalid',
        version: 1,
        presentation: {
          version: 1,
          fields: [
            { path: 'properties.target', title: '目标', role: 'identity', overview: true },
            { path: 'properties.kind', title: '类型', role: 'metadata', overview: true },
          ],
        },
      },
      actions: [],
      links: [],
      'guard-results': [],
    });
    const collectionOf = (targets: string[]): SirenEntity =>
      entity(
        ['collection', 'meta/drafts'],
        {
          rel: 'meta/drafts',
          count: targets.length,
          presentation: { version: 1, traits: ['review-queue'] },
        },
        {
          actions: [draftsCreate],
          links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta%2Fdrafts' }],
          entities: targets.map(draftMember),
        },
      );
    const createdDraft: SirenEntity = {
      class: ['meta', 'draft', 'application-bundle', 'invalid'],
      properties: {
        rel: 'draft:notes',
        id: 'notes',
        kind: 'application-bundle',
        target: 'notes',
        status: 'invalid',
        version: 1,
      },
      actions: [],
      links: [],
      'guard-results': [],
    };

    let created = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        created = true;
        return new Response(JSON.stringify({ entity: createdDraft }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify(collectionOf(created ? ['writer', 'notes'] : ['writer'])),
        {
          status: 200,
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    function DraftsCollectionPage() {
      const { entity: current, state } = useMetaEntity('meta/drafts', scope);
      if (state !== 'ready' || current === null) return <output>{state}</output>;
      return <MetaEntityRenderer rel="meta/drafts" navigation={{ scope }} entity={current} />;
    }
    render(<DraftsCollectionPage />);
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /成员/ })).toBeTruthy();
    });
    expect(screen.queryByRole('link', { name: /notes/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));
    const kindOption = [...(screen.getByLabelText(/^kind/i) as HTMLSelectElement).options].find(
      (option) => option.textContent === 'application-bundle',
    )!;
    fireEvent.change(screen.getByLabelText(/^kind/i), { target: { value: kindOption.value } });
    fireEvent.change(screen.getByLabelText(/^target/i), { target: { value: 'notes' } });
    fireEvent.change(screen.getByLabelText(/^payload/i), {
      target: {
        value: JSON.stringify({
          schema: 'https://ui4a.dev/application-bundle/v1',
          bundle: { name: 'notes', version: 1 },
          applications: [
            {
              name: 'notes',
              title: 'Notes',
              intent: 'Capture notes.',
              entry: { target: 'flow:notes-capture', role: 'primary-create' },
            },
          ],
          capabilities: [],
          flows: [],
          seed: { rel: 'seed:notes', detail: { instances: {} } },
        }),
      },
    });
    fireEvent.click(document.querySelector('button[type="submit"][data-action="create"]')!);

    await waitFor(() => {
      expect(screen.getByRole('status', { name: '执行结果' })).toBeTruthy();
    });
    // 创建→详情闭环:同一 scope 投影刷新后,新 Draft 作为集合成员出现(成员链接即详情入口)。
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /notes/ })).toBeTruthy();
    });
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0]![1]!.body)) as {
      rel: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      rel: 'meta/drafts',
      action: 'create',
      params: {
        kind: 'application-bundle',
        target: 'notes',
        payload: { bundle: { name: 'notes', version: 1 } },
      },
    });
    expect(typeof body.params.commandId).toBe('string');
  });
});
