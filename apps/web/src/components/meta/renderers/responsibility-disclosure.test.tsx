// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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

afterEach(cleanup);

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
