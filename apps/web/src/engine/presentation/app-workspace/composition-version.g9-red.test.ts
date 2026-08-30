import { describe, expect, it } from 'vitest';

import { deriveAppWorkspaceComposition, type AppWorkspaceSitemapView } from './composition';

function versionFixture(): AppWorkspaceSitemapView {
  return {
    surfaces: [
      {
        rel: 'flow:forge-start',
        title: 'Start a forge run',
        app: 'forge',
        presentation: {
          version: 1,
          traits: ['work-queue'],
          groupRole: 'definition',
          priority: 'high',
        },
      },
      {
        rel: 'forge-results',
        title: 'Forge results',
        collection: true,
        pageable: true,
        app: 'forge',
        presentation: {
          version: 1,
          traits: ['output-catalog'],
          groupRole: 'definition',
          priority: 'normal',
        },
      },
    ],
    applications: [
      {
        rel: 'application:forge',
        name: 'forge',
        title: 'Forge',
        intent: 'Create and inspect generated work',
        entry: { target: 'flow:forge-start', role: 'primary-create' },
        presentation: { version: 1, traits: ['output-catalog'] },
        flows: [
          {
            name: 'forge-start',
            title: 'Start a forge run',
            app: 'forge',
            initial: 'ready',
            nodes: [{ name: 'ready', title: 'Ready', actions: [] }],
            edges: [],
          },
        ],
      },
    ],
    capabilities: [
      {
        name: 'forge-output',
        title: 'Forge output',
        kind: 'transform',
        intent: 'Produce one governed output',
        scope: { applications: ['forge'], flows: ['forge-start'] },
      },
    ],
  } as unknown as AppWorkspaceSitemapView;
}

describe('T39 G9 Red: Application composition version is an exact semantic fingerprint', () => {
  it('changes for exact facts, entry role, surface cognition/content and owner membership', () => {
    const baseline = versionFixture();
    const versionOf = (sitemap: AppWorkspaceSitemapView): string =>
      deriveAppWorkspaceComposition('forge', sitemap)!.version;
    const baselineVersion = versionOf(baseline);
    const changed = (mutate: (sitemap: AppWorkspaceSitemapView) => void): string => {
      const sitemap = structuredClone(baseline);
      mutate(sitemap);
      return versionOf(sitemap);
    };

    expect(
      changed((sitemap) => {
        sitemap.applications![0]!.intent = 'Create, inspect and govern generated work';
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((sitemap) => {
        sitemap.applications![0]!.entry = {
          target: 'flow:forge-start',
          role: 'resume',
        };
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((sitemap) => {
        sitemap.surfaces![1]!.presentation = {
          version: 1,
          traits: ['review-queue'],
          groupRole: 'responsibility',
          priority: 'high',
        };
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((sitemap) => {
        sitemap.surfaces![1]!.title = 'Governed forge results';
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((sitemap) => {
        sitemap.surfaces![1]!.app = 'another-owner';
      }),
    ).not.toBe(baselineVersion);
  });

  it('is stable when equivalent membership inputs arrive in another order', () => {
    const baseline = versionFixture();
    const reordered = structuredClone(baseline);
    reordered.surfaces = [...reordered.surfaces!].reverse();
    reordered.applications = [...reordered.applications!].reverse();
    reordered.applications[0]!.flows = [...reordered.applications[0]!.flows!].reverse();
    reordered.capabilities = [...reordered.capabilities!].reverse();

    expect(deriveAppWorkspaceComposition('forge', reordered)!.version).toBe(
      deriveAppWorkspaceComposition('forge', baseline)!.version,
    );
  });
});
