// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DefinitionDiff, FlowDefinition, SirenAction, SirenEntity } from '@ui4a/engine';

import { stubBrowserApis } from '@/test/browser-stubs';

import { MetaEntityRenderer } from './meta-entity-renderer';

stubBrowserApis();

const emptyFields: SirenAction['fields'] = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

function action(name: string, title: string): SirenAction {
  return {
    name,
    title,
    method: 'POST',
    href: '/_meta/api/exec',
    fields: emptyFields,
  };
}

const flowDefinition: FlowDefinition = {
  name: 'article-drafting',
  title: '文章发布向导',
  initial: 'draft',
  nodes: [
    {
      name: 'draft',
      title: '草稿',
      actions: [
        {
          name: 'submit',
          title: '提交审核',
          to: 'review',
          fields: [{ name: 'note', type: 'text', required: true, semantics: 'intent' }],
        },
      ],
    },
    { name: 'review', title: '审核', actions: [] },
  ],
};

function flowEntity(name = 'article-drafting'): SirenEntity {
  return {
    class: ['meta', 'flow-definition'],
    properties: {
      name,
      title: name === 'definition-lifecycle' ? '定义生命周期' : '文章发布向导',
      status: 'active',
      version: 2,
      initial: 'draft',
    },
    actions: [action('revise', '修订')],
    links: [
      {
        rel: ['application'],
        title: '内容发布',
        href: '/_meta/api/entity?rel=meta/application:publishing',
      },
    ],
    'guard-results': [],
    entities: [
      {
        class: ['meta', 'node-definition'],
        rel: ['node'],
        properties: { name: 'draft', title: '草稿' },
        actions: [],
        links: [],
        entities: [
          {
            class: ['meta', 'action-definition'],
            rel: ['action'],
            properties: {
              name: 'submit',
              title: '提交审核',
              to: 'review',
              guards: [],
              effect: [{ type: 'transition', to: 'review' }],
              fields: [{ name: 'note', type: 'text', required: true, semantics: 'intent' }],
            },
            actions: [],
            links: [],
          },
        ],
      },
      {
        class: ['meta', 'node-definition'],
        rel: ['node'],
        properties: { name: 'review', title: '审核' },
        actions: [],
        links: [],
        entities: [],
      },
      {
        class: ['meta', 'definition-version'],
        rel: ['version'],
        properties: {
          version: 1,
          status: 'superseded',
          source: 'definition-seeded',
          definition: flowDefinition,
        },
        actions: [],
        links: [],
      },
      {
        class: ['meta', 'definition-version'],
        rel: ['version'],
        properties: {
          version: 2,
          status: 'active',
          source: 'definition-activated',
          activation: 'activation-2',
          definition: { ...flowDefinition, title: '文章发布向导 v2' },
        },
        actions: [],
        links: [],
      },
    ],
  };
}

const activationDiff: DefinitionDiff = {
  algorithm: 'deep-object-diff',
  before: { ...flowDefinition, title: '文章发布向导 v1' },
  after: { ...flowDefinition, title: '文章发布向导 v2' },
  changed: {
    added: {},
    deleted: {},
    updated: { title: '文章发布向导 v2' },
  },
};

function activationEntity(status = 'pending-approval'): SirenEntity {
  return {
    class: ['meta', 'activation', status],
    properties: {
      id: 'activation-2',
      flow: 'article-drafting',
      status,
      version: 2,
      checks: [
        { name: 'edge-targets-exist', pass: true },
        {
          name: 'guards-registered',
          pass: false,
          detail: ['submit 缺少 responsibility guard'],
        },
      ],
      diff: activationDiff,
    },
    actions:
      status === 'pending-approval' ? [action('approve', '批准'), action('reject', '驳回')] : [],
    links: [
      {
        rel: ['target'],
        title: '文章发布向导',
        href: '/_meta/api/entity?rel=meta/flow:article-drafting',
      },
    ],
    'guard-results': [],
  };
}

function capabilityEntity(): SirenEntity {
  return {
    class: ['meta', 'capability-definition'],
    properties: {
      name: 'coding',
      title: '编码实现',
      intent: '在受控工作区内完成代码变更。',
      input: 'CodingTask',
      output: 'CodingResult',
      scope: 'application',
      executor: { class: 'agent', profile: 'coding' },
    },
    actions: [],
    links: [
      {
        rel: ['application'],
        title: '开发',
        href: '/_meta/api/entity?rel=meta/application:development',
      },
    ],
    'guard-results': [],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  stubBrowserApis();
});

describe('canonical Meta specializations', () => {
  it('uses the existing Flow specialization for a canonical meta/flow entity', () => {
    const { container } = render(
      <MetaEntityRenderer
        rel="meta/flow:article-drafting"
        navigation={{ scope: 'publishing' }}
        entity={flowEntity()}
      />,
    );

    expect(screen.getByRole('heading', { name: '文章发布向导' })).toBeTruthy();
    expect(container.querySelector('section[aria-label="拓扑"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="节点"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="动作"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="字段"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="版本历史"]')).not.toBeNull();
    expect(screen.getAllByText('active')).toHaveLength(2);
    expect(screen.getByText('intent')).toBeTruthy();
    expect(screen.queryByText(/通用合同视图/)).toBeNull();
  });

  it('uses the same Flow specialization for canonical meta/self without a rel branch', () => {
    const { container } = render(
      <MetaEntityRenderer
        rel="meta/self"
        navigation={{ scope: 'governance' }}
        entity={flowEntity('definition-lifecycle')}
      />,
    );

    expect(screen.getByRole('heading', { name: '定义生命周期' })).toBeTruthy();
    expect(container.querySelector('section[aria-label="拓扑"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="节点"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="动作"]')).not.toBeNull();
    expect(screen.queryByText(/通用合同视图/)).toBeNull();
  });

  it('uses the Activation specialization for every status and exposes the decision facts', () => {
    const { container, rerender } = render(
      <MetaEntityRenderer
        rel="meta/activation:activation-2"
        navigation={{ scope: 'governance' }}
        entity={activationEntity()}
      />,
    );

    expect(screen.getByText(/article-drafting.*pending-approval/)).toBeTruthy();
    expect(container.querySelector('section[aria-label="不变式检查"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="机械 diff"]')).not.toBeNull();
    expect(screen.getByText('guards-registered')).toBeTruthy();
    expect(screen.getByRole('button', { name: '批准' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '驳回' })).toBeTruthy();
    expect(screen.queryByText(/通用合同视图/)).toBeNull();

    rerender(
      <MetaEntityRenderer
        rel="meta/activation:another-id"
        navigation={{ scope: 'governance' }}
        entity={activationEntity('approved')}
      />,
    );
    expect(container.querySelector('section[aria-label="不变式检查"]')).not.toBeNull();
    expect(screen.queryByText(/通用合同视图/)).toBeNull();
  });

  it('uses the Capability specialization for intent and execution boundaries', () => {
    const { container } = render(
      <MetaEntityRenderer
        rel="meta/capability:coding"
        navigation={{ scope: 'development' }}
        entity={capabilityEntity()}
      />,
    );

    expect(screen.getByRole('heading', { name: '编码实现' })).toBeTruthy();
    expect(container.querySelector('section[aria-label="属性"]')).not.toBeNull();
    for (const value of [
      '在受控工作区内完成代码变更。',
      'CodingTask',
      'CodingResult',
      'application',
      '{"class":"agent","profile":"coding"}',
    ]) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(screen.queryByText(/通用合同视图/)).toBeNull();
  });

  it.each([
    {
      name: 'Flow',
      rel: 'meta/flow:article-drafting',
      scope: 'publishing',
      entity: flowEntity(),
      relationship: 'application',
      href: '/meta/entity?rel=meta%2Fapplication%3Apublishing&scope=publishing',
    },
    {
      name: 'Activation',
      rel: 'meta/activation:activation-2',
      scope: 'governance',
      entity: activationEntity(),
      relationship: 'target',
      href: '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting&scope=governance',
    },
    {
      name: 'Capability',
      rel: 'meta/capability:coding',
      scope: 'development',
      entity: capabilityEntity(),
      relationship: 'application',
      href: '/meta/entity?rel=meta%2Fapplication%3Adevelopment&scope=development',
    },
  ])('keeps canonical relationships and RawContract around the $name specialization', (fixture) => {
    render(
      <MetaEntityRenderer
        rel={fixture.rel}
        navigation={{ scope: fixture.scope }}
        entity={fixture.entity}
      />,
    );

    expect(screen.getByRole('link', { name: fixture.relationship }).getAttribute('href')).toBe(
      fixture.href,
    );
    expect(screen.getByText('原始合同')).toBeTruthy();
  });

  it.each([
    {
      name: 'Flow',
      rel: 'meta/flow:article-drafting',
      scope: 'publishing',
      entity: flowEntity(),
      action: '修订',
    },
    {
      name: 'Activation',
      rel: 'meta/activation:activation-2',
      scope: 'governance',
      entity: activationEntity(),
      action: '批准',
    },
  ])(
    'fresh-reads and submits the current $name action with the canonical scope',
    async (fixture) => {
      const onChanged = vi.fn();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture.entity))
        .mockResolvedValueOnce(jsonResponse({ entity: fixture.entity }));
      vi.stubGlobal('fetch', fetchMock);
      render(
        <MetaEntityRenderer
          rel={fixture.rel}
          navigation={{ scope: fixture.scope }}
          entity={fixture.entity}
          onChanged={onChanged}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: fixture.action }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `/_meta/api/entity?rel=${encodeURIComponent(fixture.rel)}&scope=${fixture.scope}`,
      );
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`/_meta/api/exec?scope=${fixture.scope}`);
      expect(onChanged).toHaveBeenCalledWith(fixture.rel);
    },
  );
});
