// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { MetaEntityRenderer } from './meta-entity-renderer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function siren(classes: string[], properties: Record<string, unknown>): SirenEntity {
  return { class: classes, properties, actions: [], links: [], 'guard-results': [] };
}

describe('Meta entity renderer', () => {
  it('uses the Application specialization and keeps raw bundle secondary', () => {
    render(
      <MetaEntityRenderer
        navigation={{ scope: 'publishing' }}
        entity={siren(['meta', 'application-definition'], {
          name: 'publishing',
          title: '内容发布',
          intent: '起草并发布文章。',
          bundle: {
            bundle: { version: 1 },
            flows: [{ name: 'post-status', title: '文章状态' }],
            capabilities: [],
            policies: [],
          },
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: '内容发布' })).toBeTruthy();
    expect(screen.getByText('起草并发布文章。')).toBeTruthy();
    expect(screen.getByText(/只读/)).toBeTruthy();
    expect(screen.getByText('原始合同')).toBeTruthy();
  });

  it('uses generic fallback for an unknown legal collection without a white screen', () => {
    render(
      <MetaEntityRenderer
        navigation={{ scope: 'publishing' }}
        entity={{
          ...siren(['collection', 'meta/widgets'], { rel: 'meta/widgets', count: 1 }),
          entities: [siren(['meta', 'widget'], { name: 'one', title: 'Widget One' })],
        }}
      />,
    );
    expect(screen.getByText(/通用合同视图/)).toBeTruthy();
    expect(screen.getByText('Widget One')).toBeTruthy();
  });

  it('fails closed with a safe error when specializations are ambiguous', () => {
    render(
      <MetaEntityRenderer
        entity={siren(['meta', 'activation', 'capability-definition'], { rel: 'meta/conflict' })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('合同类型冲突');
    expect(screen.queryByText('meta/conflict')).toBeNull();
  });

  it('redacts primitive secret-shaped properties in the generic fact table', () => {
    render(
      <MetaEntityRenderer
        rel="meta/widget:secret"
        navigation={{ scope: 'governance' }}
        entity={siren(['meta', 'widget'], { title: 'Secret widget', apiKey: 'do-not-display' })}
      />,
    );
    expect(screen.queryByText('do-not-display')).toBeNull();
    expect(screen.getByText('[redacted]')).toBeTruthy();
  });

  it('renders Agent authority/binding/runtime boundaries and redacts raw secrets', () => {
    render(
      <MetaEntityRenderer
        navigation={{ scope: 'governance' }}
        entity={siren(['meta', 'agent-definition', 'active'], {
          ref: 'author@1',
          name: 'author',
          status: 'active',
          intent: 'Draft definitions without approving them.',
          runtimeClass: 'authoring',
          requiredFeatures: ['structured-result'],
          prompt: {
            blocks: [
              {
                id: 'a',
                purpose: 'authority',
                role: 'system',
                sealed: true,
                literal: 'No approve.',
              },
              {
                id: 't',
                purpose: 'task-data',
                role: 'user',
                binding: { source: 'task', pointer: '/brief' },
              },
            ],
          },
          apiKey: 'must-not-render',
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: /author@1/ })).toBeTruthy();
    expect(screen.getByText('封闭权威')).toBeTruthy();
    expect(screen.getByText('数据绑定')).toBeTruthy();
    expect(screen.getByText('部署要求')).toBeTruthy();
    expect(screen.queryByText('must-not-render')).toBeNull();
  });

  it('submits a generic exact action against the requested rel when properties.rel is absent', async () => {
    const entity = siren(['meta', 'flow-definition'], { name: 'post-status' });
    entity.actions = [
      {
        name: 'revise',
        title: 'Revise',
        method: 'POST',
        href: '/_meta/api/exec',
        fields: { type: 'object', properties: {} },
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(entity), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entity }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MetaEntityRenderer
        rel="meta/flow:post-status"
        navigation={{ scope: 'publishing' }}
        entity={entity}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revise' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/_meta/api/entity?rel=meta%2Fflow%3Apost-status&scope=publishing',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      rel: 'meta/flow:post-status',
      action: 'revise',
    });
  });

  it('keeps human Draft decisions enabled when only actor-is-human fails closed', async () => {
    const activation = siren(['meta', 'activation', 'pending-approval'], {
      rel: 'meta/activation:draft:d1',
      version: 1,
    });
    activation.actions = [
      {
        name: 'approve',
        title: 'Approve',
        method: 'POST',
        href: '/_meta/api/exec',
        fields: {
          type: 'object',
          properties: { commandId: { type: 'string' } },
          required: ['commandId'],
        },
      },
    ];
    activation['guard-results'] = [
      {
        action: 'approve',
        blocked: true,
        reason: 'actor-is-human is evaluated from authenticated request context',
        guards: [{ name: 'actor-is-human', pass: false }],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(activation), { status: 200 })),
    );
    const draft = siren(['meta', 'draft', 'agent-definition', 'pending-approval'], {
      rel: 'draft:d1',
      id: 'd1',
      kind: 'agent-definition',
      target: 'writer',
      status: 'pending-approval',
      version: 1,
      maxVersion: 1,
      activation: 'meta/activation:draft:d1',
      validation: { valid: true, issues: [] },
    });
    render(
      <MetaEntityRenderer rel="draft:d1" navigation={{ scope: 'governance' }} entity={draft} />,
    );

    // D50:带参动作(commandId)默认收起为触发键;身份规则只解除 actor-is-human
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
  });

  it('preserves scope on Draft → source Run navigation', () => {
    const draft = siren(['meta', 'draft', 'agent-definition', 'invalid'], {
      rel: 'draft:d2',
      id: 'd2',
      kind: 'agent-definition',
      target: 'writer',
      status: 'invalid',
      version: 1,
      maxVersion: 1,
      validation: { valid: false, issues: [] },
      provenance: { sources: ['agent-run:r1'] },
    });
    draft.links = [{ rel: ['source'], href: '/api/entity?rel=agent-run%3Ar1' }];
    render(
      <MetaEntityRenderer rel="draft:d2" navigation={{ scope: 'governance' }} entity={draft} />,
    );
    expect(screen.getByRole('link', { name: 'agent-run:r1' }).getAttribute('href')).toBe(
      '/entity?rel=agent-run%3Ar1&scope=governance',
    );
  });
});
