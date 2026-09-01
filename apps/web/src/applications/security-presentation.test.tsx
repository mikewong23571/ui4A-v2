// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';
import { project, projectWorkThread } from '@ui4a/engine';

import { EntityView } from '../components/entity-view';
import { securityApplicationBundle } from './bundles';

const flow = securityApplicationBundle.flows[0]!;

function snapshot(node: string, enrichment?: unknown): EngineSnapshot {
  return {
    instances: {
      'cve:CVE-2026-0001': {
        rel: 'cve:CVE-2026-0001',
        flow: flow.name,
        node,
        fields: {
          cveId: { value: 'CVE-2026-0001', origin: 'default' },
          title: { value: '受控参考漏洞（非实时情报）', origin: 'default' },
          ...(enrichment === undefined
            ? {}
            : { enrichment: { value: enrichment, origin: 'effect' as const } }),
        },
        bornVersion: 1,
      },
    },
    collections: { cves: ['cve:CVE-2026-0001'] },
    definitions: {
      [flow.name]: { name: flow.name, version: 1, status: 'active', definition: flow },
    },
    definitionVersions: { [flow.name]: { 1: flow } },
    applications: { security: securityApplicationBundle.applications[0]! },
    capabilities: { 'cve.enrich': securityApplicationBundle.capabilities[0]! },
    threads: {
      'security-response': {
        id: 'security-response',
        owner: 'user:mike',
        goal: { text: '确认参考漏洞的影响范围', source: 'cve:CVE-2026-0001' },
        status: 'open',
        references: {
          context: ['cve:CVE-2026-0001'],
          active: [],
          approval: [],
          event: [],
        },
        recentEventSeqs: [],
      },
    },
  };
}

const deps = { flows: { [flow.name]: flow }, guards: seedGuardRegistry };

afterEach(cleanup);

describe('Security slice generic presentation', () => {
  it('shows the declared human Action on the identified CVE without a specialized renderer', () => {
    const entity = project(snapshot('identified'), 'cve:CVE-2026-0001', deps)!;
    render(<EntityView rel="cve:CVE-2026-0001" scope="security" entity={entity} />);
    expect(screen.getByRole('heading', { name: 'CVE-2026-0001' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '补充影响分析' })).toBeTruthy();
  });

  it('shows business progress/result language while keeping Function mechanics out', () => {
    const enriching = project(snapshot('enriching'), 'cve:CVE-2026-0001', deps)!;
    expect(enriching.properties.title).toBe('正在补充影响信息');
    expect(enriching.actions).toHaveLength(0);
    const enriched = project(
      snapshot('enriched', {
        severity: 'high',
        affectedComponents: ['ui4a-web'],
        sources: ['reference-catalog:security-v1'],
      }),
      'cve:CVE-2026-0001',
      deps,
    )!;
    render(<EntityView rel="cve:CVE-2026-0001" scope="security" entity={enriched} />);
    expect(screen.getByText('影响信息')).toBeTruthy();
    const serialized = JSON.stringify({ enriching, enriched });
    expect(serialized).not.toContain('handlerRef');
    expect(serialized).not.toContain('security-enrichment-default');
    expect(serialized).not.toContain('Temporal');
  });

  it('shows the explicitly attached CVE in the existing Work Thread projection', () => {
    const current = snapshot('enriching');
    const thread = projectWorkThread(current.threads!['security-response']!, current, deps);
    expect(thread.entities).toEqual([
      expect.objectContaining({
        properties: expect.objectContaining({
          rel: 'cve:CVE-2026-0001',
          identity: '受控参考漏洞（非实时情报）',
          status: 'enriching',
        }),
      }),
    ]);
    expect(thread.links).toContainEqual({
      rel: ['context'],
      href: '/api/entity?rel=cve:CVE-2026-0001',
    });
  });

  it('does not auto-attach a CVE from presence, scope, or execution state', () => {
    const current = snapshot('enriching');
    current.threads!['security-response']!.references.context = [];
    const thread = projectWorkThread(current.threads!['security-response']!, current, deps);
    expect(thread.entities).toEqual([]);
    expect(thread.links.some((link) => link.href.includes('cve:'))).toBe(false);
  });
});
