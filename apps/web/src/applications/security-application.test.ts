import { describe, expect, it } from 'vitest';

import { deriveSitemap, validateDefinition } from '@ui4a/engine';
import { seedGuardRegistry } from '@ui4a/shared';

import { installedApplicationBundles, securityApplicationBundle } from './bundles';

describe('Security Application boundary slice', () => {
  it('installs one contract-driven Security application, CVE flow, and extract capability', () => {
    expect(securityApplicationBundle.applications).toEqual([
      expect.objectContaining({
        name: 'security',
        title: '安全响应',
        entry: { target: 'cves', role: 'primary-collection' },
      }),
    ]);
    expect(securityApplicationBundle.capabilities).toEqual([
      expect.objectContaining({
        name: 'cve.enrich',
        kind: 'extract',
        executor: { class: 'native-function', profile: 'security-enrichment-default' },
      }),
    ]);
    expect(installedApplicationBundles).toContain(securityApplicationBundle);
  });

  it('declares identified → enriching → enriched/failed through one spawn and internal callbacks', () => {
    const flow = securityApplicationBundle.flows.find(
      (candidate) => candidate.name === 'cve-enrichment',
    )!;
    const identified = flow.nodes.find((node) => node.name === 'identified')!;
    const action = identified.actions.find((candidate) => candidate.name === 'enrich-impact')!;
    expect(JSON.stringify(action.effect)).toContain('cve.enrich');
    expect(JSON.stringify(action.effect)).toContain('enrichment-succeeded');
    const enriching = flow.nodes.find((node) => node.name === 'enriching')!;
    expect(enriching.actions.map((candidate) => [candidate.name, candidate.internal])).toEqual([
      ['enrichment-succeeded', 'capability-callback'],
      ['enrichment-failed', 'capability-callback'],
    ]);
    expect(flow.nodes.map((node) => node.name)).toEqual([
      'identified',
      'enriching',
      'enriched',
      'enrichment-failed',
    ]);
  });

  it('activates only with the declared Function profile and handler availability', () => {
    const flow = securityApplicationBundle.flows[0]!;
    const capability = securityApplicationBundle.capabilities[0]!;
    const checks = validateDefinition(flow, {
      guards: seedGuardRegistry,
      applications: new Set(['security']),
      capabilities: new Set([capability.name]),
      capabilityDefinitions: { [capability.name]: capability },
      executorProfiles: new Map([['security-enrichment-default', 'native-function']]),
      nativeFunctionProfiles: new Map([
        [
          'security-enrichment-default',
          {
            executorClass: 'native-function',
            handlerRef: 'security/cve-enrich@1',
            available: true,
          },
        ],
      ]),
    });
    expect(
      checks.every((check) => check.pass),
      JSON.stringify(checks),
    ).toBe(true);
  });

  it('discovers the collection and flow from the generic sitemap without deployment leakage', () => {
    const sitemap = deriveSitemap(securityApplicationBundle.flows, {
      applications: Object.fromEntries(
        securityApplicationBundle.applications.map((application) => [
          application.name,
          application,
        ]),
      ),
      capabilities: Object.fromEntries(
        securityApplicationBundle.capabilities.map((capability) => [capability.name, capability]),
      ),
    });
    expect(sitemap.applications?.[0]).toMatchObject({ name: 'security', title: '安全响应' });
    expect(sitemap.surfaces.some((surface) => surface.rel === 'cves')).toBe(true);
    const serialized = JSON.stringify({ bundle: securityApplicationBundle, sitemap });
    expect(serialized).not.toContain('handlerRef');
    expect(serialized).not.toContain('Temporal');
    expect(serialized).not.toContain('credential');
  });

  it('seeds one reference CVE without pretending to provide live vulnerability intelligence', () => {
    expect(securityApplicationBundle.seed.detail.instances['cve:CVE-2026-0001']).toMatchObject({
      flow: 'cve-enrichment',
      node: 'identified',
    });
    expect(securityApplicationBundle.seed.detail.collections?.cves).toEqual(['cve:CVE-2026-0001']);
  });
});
