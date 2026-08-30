import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ApplicationEntryRole } from '@ui4a/shared';

import { deriveAppWorkspaceComposition, type AppWorkspaceSitemapView } from './composition';

type SurfaceTrait = 'output-catalog' | 'review-queue';

function futureApplication(
  name: string,
  entryRole: ApplicationEntryRole,
  surfaceTrait: SurfaceTrait,
): AppWorkspaceSitemapView {
  const entryIsCollection = entryRole === 'primary-collection';
  const entryTarget = entryIsCollection ? `${name}-records` : `flow:${name}-entry`;
  return {
    surfaces: [
      {
        rel: `${name}-records`,
        title: 'Records',
        collection: true,
        pageable: true,
        app: name,
        presentation: { version: 1, traits: [surfaceTrait] },
      },
      {
        rel: `flow:${name}-entry`,
        title: 'Entry',
        app: name,
        presentation: { version: 1, traits: ['work-queue'] },
      },
    ],
    applications: [
      {
        rel: `application:${name}`,
        name,
        title: 'Future application',
        intent: 'Exercise one semantic policy',
        entry: { target: entryTarget, role: entryRole },
      },
    ],
  } as AppWorkspaceSitemapView;
}

function intentForSource(sitemap: AppWorkspaceSitemapView, scope: string, source: string): string {
  const region = deriveAppWorkspaceComposition(scope, sitemap)!.regions.find(
    (candidate) => candidate.source === source,
  );
  if (region === undefined) throw new Error(`missing region for ${source}`);
  return region.intent;
}

describe('T39 G9 Red: one semantic role policy selects exact Presentation intents', () => {
  it.each([
    ['output-catalog', 'overview'],
    ['review-queue', 'review'],
  ] as const)('maps %s identically for any future Application', (trait, expectedIntent) => {
    const first = futureApplication('future-one', 'primary-task', trait);
    const second = futureApplication('future-two', 'primary-task', trait);

    expect(intentForSource(first, 'future-one', 'future-one-records')).toBe(expectedIntent);
    expect(intentForSource(second, 'future-two', 'future-two-records')).toBe(expectedIntent);
  });

  it.each([
    ['primary-create', 'compose'],
    ['primary-task', 'review'],
    ['primary-collection', 'overview'],
    ['resume', 'continue-current-task'],
  ] as const)(
    'maps entry role %s without embedding an Application name',
    (role, expectedIntent) => {
      const scope = `future-${role}`;
      const sitemap = futureApplication(scope, role, 'output-catalog');
      const entryTarget = sitemap.applications![0]!.entry!.target;
      const intent = intentForSource(sitemap, scope, entryTarget);

      expect(intent).toBe(expectedIntent);
      expect(intent).not.toContain(scope);
    },
  );
});

describe('T39 G9 Red: Application intent policy source governance', () => {
  it('keeps runtime adapters free of installed Application comparisons and inline intent maps', () => {
    const compositionSource = readFileSync(new URL('./composition.ts', import.meta.url), 'utf8');
    const policySource = readFileSync(
      new URL('../generic-intent-policy.ts', import.meta.url),
      'utf8',
    );
    const installedName =
      '(?:publishing|community|development|editorial|governance|todo|brainstorm)';
    expect(compositionSource).not.toMatch(
      new RegExp(`(?:scope|application\\.name)\\s*={2,3}\\s*['"]${installedName}['"]`, 'u'),
    );
    expect(policySource).not.toMatch(
      new RegExp(`(?:case\\s+['"]${installedName}['"]|['"]?${installedName}['"]?\\s*:)`, 'u'),
    );
    expect(compositionSource).not.toMatch(/intent\s*:\s*['"](?:review|overview)['"]/u);
  });
});
