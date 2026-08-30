// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { stubBrowserApis } from '@/test/browser-stubs';

import { MetaEntityRenderer } from './meta-entity-renderer';

stubBrowserApis();

const fields: SirenAction['fields'] = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

function futureEntity({ responsibility = true }: { responsibility?: boolean } = {}): SirenEntity {
  return {
    class: ['meta', 'future-governed-object'],
    properties: {
      rel: 'meta/future-gate:rollout-9',
      title: '未来发布门',
      intent: '决定是否允许未来部署进入生产。',
      status: '等待安全负责人判断',
      checks: [{ name: 'schema-contract', pass: true }],
      diff: { summary: 'change-set-9' },
      provenance: { source: 'source-run-8' },
      internalReceipt: 'future-internal-token',
      presentation: {
        version: 1,
        ...(responsibility ? { traits: ['human-responsibility'] } : {}),
        fields: [
          { path: 'properties.title', title: '名称', role: 'identity' },
          { path: 'properties.intent', title: '用途', role: 'primary-content' },
          { path: 'properties.status', title: '状态', role: 'status' },
          { path: 'properties.checks', title: '检查', role: 'metadata' },
          { path: 'properties.diff', title: '变更', role: 'metadata' },
          { path: 'properties.provenance', title: '来源', role: 'metadata' },
        ],
      },
    },
    actions: [
      {
        name: 'future-disposition-v9',
        title: '记录发布裁决',
        method: 'POST',
        href: '/_meta/api/exec',
        fields,
      },
    ],
    links: [
      {
        rel: ['self'],
        title: '精确合同',
        href: '/_meta/api/entity?rel=meta%2Ffuture-gate%3Arollout-9',
      },
      {
        rel: ['future-review-owner'],
        title: '未来安全负责人',
        href: '/api/entity?rel=agent-run%3Asecurity-9',
      },
      {
        rel: ['future-target'],
        href: '/_meta/api/entity?rel=meta%2Fflow%3Afuture-rollout',
      },
    ],
    'guard-results': [
      {
        action: 'future-disposition-v9',
        blocked: true,
        reason: '仍需独立安全复核',
        guards: [{ name: 'future-security-review-complete', pass: false }],
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('contract-driven Meta responsibility and disclosure', () => {
  it('promotes a future entity responsibility from traits, facts, guards and actions', () => {
    render(
      <MetaEntityRenderer
        rel="meta/future-gate:rollout-9"
        navigation={{ scope: 'governance' }}
        entity={futureEntity()}
      />,
    );

    const taskLayer = screen.getByRole('region', { name: '任务语义' });
    expect(within(taskLayer).getByRole('heading', { name: '未来发布门' })).toBeTruthy();
    expect(within(taskLayer).getByText('决定是否允许未来部署进入生产。')).toBeTruthy();
    expect(within(taskLayer).getByText('等待安全负责人判断')).toBeTruthy();

    const responsibility = within(taskLayer).getByRole('region', { name: '人类责任点' });
    const decision = within(responsibility).getByRole('heading', { name: '需要决定什么' });
    const current = within(responsibility).getByRole('heading', { name: '当前责任' });
    const next = within(responsibility).getByRole('heading', { name: '下一步' });
    expect(decision.parentElement?.textContent).toContain('决定是否允许未来部署进入生产。');
    expect(current.parentElement?.textContent).toContain('等待安全负责人判断');
    expect(next.parentElement?.textContent).toContain('记录发布裁决');
    expect(next.parentElement?.textContent).toContain('仍需独立安全复核');
    expect(within(responsibility).getByRole('button', { name: '记录发布裁决' })).toBeTruthy();
  });

  it('keeps an unknown blocked action in place with its contract reason and never submits it', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MetaEntityRenderer
        rel="meta/future-gate:rollout-9"
        navigation={{ scope: 'governance' }}
        entity={futureEntity()}
      />,
    );

    const blocked = screen.getByRole('button', { name: '记录发布裁决' });
    expect(blocked.hasAttribute('disabled')).toBe(true);
    expect(blocked.getAttribute('title')).toBe('仍需独立安全复核');
    expect(screen.getAllByText('仍需独立安全复核').length).toBeGreaterThan(0);
    fireEvent.click(blocked);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stages any future high-risk action and renders its returned outcome instead of naming it', async () => {
    const current = futureEntity();
    current.actions = [
      {
        ...current.actions[0]!,
        name: 'seal-nebula-window-v12',
        title: '封闭未来窗口',
        'requires-confirmation': 'high',
      },
    ];
    current['guard-results'] = [
      {
        action: 'seal-nebula-window-v12',
        blocked: false,
        guards: [],
      },
    ];
    const decided: SirenEntity = {
      ...current,
      properties: {
        ...current.properties,
        status: 'settled',
        decisionReceipt: {
          outcome: 'accepted',
          principal: 'user:mike',
          revision: 12,
          apiToken: 'never-render-this',
        },
        presentation: {
          ...(current.properties.presentation as Record<string, unknown>),
          fields: [
            ...((current.properties.presentation as { fields: Record<string, unknown>[] }).fields ??
              []),
            {
              path: 'properties.decisionReceipt',
              title: '裁决回执',
              role: 'metadata',
            },
          ],
        },
      },
      actions: [],
      'guard-results': [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(current), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entity: decided }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MetaEntityRenderer
        rel="meta/future-gate:rollout-9"
        navigation={{ scope: 'governance' }}
        entity={current}
      />,
    );

    const trigger = screen.getByRole('button', { name: '封闭未来窗口' });
    fireEvent.click(trigger);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/已请求.*尚未执行/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认并执行封闭未来窗口' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/settled/)).toBeTruthy();
    expect(screen.getByText(/accepted/)).toBeTruthy();
    expect(screen.getByText(/user:mike/)).toBeTruthy();
    expect(screen.queryByText(/never-render-this/)).toBeNull();
    expect(screen.getByText(/\[redacted\]/)).toBeTruthy();
  });

  it('keeps caller input and the current URL after a stale rejection', async () => {
    const current = futureEntity({ responsibility: false });
    current.actions = [
      {
        ...current.actions[0]!,
        name: 'future-revise-window-v12',
        title: '修订未来窗口',
        fields: {
          type: 'object',
          properties: { reason: { type: 'string', title: '修订理由' } },
          required: ['reason'],
          additionalProperties: false,
        },
      },
    ];
    current['guard-results'] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(current), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            layer: 'stale-version',
            reason: '已被另一个裁决更新',
            detail: { observed: 11, current: 12 },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(
      null,
      '',
      '/meta/entity?rel=meta%2Ffuture-gate%3Arollout-9&scope=governance&returnTo=%2Fmeta',
    );
    const originalUrl = window.location.href;
    render(
      <MetaEntityRenderer
        rel="meta/future-gate:rollout-9"
        navigation={{ scope: 'governance', returnTo: '/meta' }}
        entity={current}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '修订未来窗口' }));
    const reason = await screen.findByLabelText(/修订理由/);
    fireEvent.change(reason, { target: { value: '保留我的现场输入' } });
    const submit = document.querySelector('button[data-action="future-revise-window-v12"]');
    if (!(submit instanceof HTMLElement)) throw new Error('missing future submit button');
    fireEvent.click(submit);

    const rejection = await screen.findByRole('alert');
    expect(rejection.textContent).toContain('[stale-version]');
    expect(rejection.textContent).toContain('已被另一个裁决更新');
    expect((screen.getByLabelText(/修订理由/) as HTMLInputElement).value).toBe('保留我的现场输入');
    expect(window.location.href).toBe(originalUrl);
  });

  it('does not invent a responsibility region when the trait is absent', () => {
    render(
      <MetaEntityRenderer
        rel="meta/future-gate:rollout-9"
        navigation={{ scope: 'governance' }}
        entity={futureEntity({ responsibility: false })}
      />,
    );

    const taskLayer = screen.getByRole('region', { name: '任务语义' });
    expect(within(taskLayer).queryByRole('region', { name: '人类责任点' })).toBeNull();
    expect(within(taskLayer).getByRole('button', { name: '记录发布裁决' })).toBeTruthy();
  });

  it('orders task meaning, declared contract evidence and collapsed raw contract', () => {
    render(
      <MetaEntityRenderer
        rel="meta/future-gate:rollout-9"
        navigation={{ scope: 'governance' }}
        entity={futureEntity()}
      />,
    );

    const taskLayer = screen.getByRole('region', { name: '任务语义' });
    const evidenceLayer = screen.getByRole('region', { name: '合同证据' });
    const rawSummary = screen.getByText('原始合同');
    const rawLayer = rawSummary.parentElement as HTMLDetailsElement;

    expect(
      taskLayer.compareDocumentPosition(evidenceLayer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      evidenceLayer.compareDocumentPosition(rawLayer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(evidenceLayer).getByText(/schema-contract/)).toBeTruthy();
    expect(within(evidenceLayer).getByText(/change-set-9/)).toBeTruthy();
    expect(within(evidenceLayer).getByText(/source-run-8/)).toBeTruthy();

    expect(rawLayer.open).toBe(false);
    expect(screen.queryByText('future-internal-token')).toBeNull();
    expect(screen.queryByText('future-governed-object')).toBeNull();

    fireEvent.click(rawSummary);
    expect(rawLayer.open).toBe(true);
    expect(screen.getByText(/future-internal-token/)).toBeTruthy();
    expect(screen.getByText(/future-governed-object/)).toBeTruthy();
  });

  it('uses titled future relations as task language and keeps self in a secondary group', () => {
    render(
      <MetaEntityRenderer
        rel="meta/future-gate:rollout-9"
        navigation={{ scope: 'governance' }}
        entity={futureEntity()}
      />,
    );

    const evidenceLayer = screen.getByRole('region', { name: '合同证据' });
    const taskRelationships = within(evidenceLayer).getByRole('group', { name: '任务关系' });
    const secondaryRelationships = within(evidenceLayer).getByRole('group', {
      name: '机械关系',
    });

    const titled = within(taskRelationships).getByRole('link', { name: '未来安全负责人' });
    expect(titled.getAttribute('href')).toBe('/entity?rel=agent-run%3Asecurity-9&scope=governance');
    const descriptionId = titled.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe('future-review-owner');

    expect(within(taskRelationships).getByRole('link', { name: 'future-target' })).toBeTruthy();
    expect(within(taskRelationships).queryByRole('link', { name: '精确合同' })).toBeNull();
    const self = within(secondaryRelationships).getByRole('link', { name: '精确合同' });
    expect(self.getAttribute('href')).toBe(
      '/meta/entity?rel=meta%2Ffuture-gate%3Arollout-9&scope=governance',
    );
  });
});
