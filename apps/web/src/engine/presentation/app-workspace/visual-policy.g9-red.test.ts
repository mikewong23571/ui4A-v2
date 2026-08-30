import { describe, expect, it } from 'vitest';

import type { SirenEntity, SurfaceNode } from '@ui4a/engine';

import { planWorkspaceComposition } from '../runtime-composition';
import { deriveAppWorkspaceComposition, type AppWorkspaceSitemapView } from './composition';

type SurfaceTrait = 'output-catalog' | 'review-queue';

function sitemapWith(trait: SurfaceTrait): AppWorkspaceSitemapView {
  return {
    surfaces: [
      {
        rel: 'future-records',
        title: 'Records',
        collection: true,
        pageable: true,
        app: 'future',
        presentation: { version: 1, traits: [trait] },
      },
    ],
    applications: [
      {
        rel: 'application:future',
        name: 'future',
        title: 'Future application',
        intent: 'Exercise generic visual policy',
      },
    ],
  } as AppWorkspaceSitemapView;
}

function applicationEntity(): SirenEntity {
  return {
    class: ['application'],
    properties: {
      rel: 'application:future',
      title: 'Future application',
      intent: 'Exercise generic visual policy',
    },
    actions: [],
    links: [],
  };
}

function collectionEntity(trait: SurfaceTrait): SirenEntity {
  return {
    class: ['collection'],
    properties: {
      rel: 'future-records',
      presentation: { version: 1, traits: [trait] },
    },
    actions: [],
    links: [],
    entities: [
      {
        class: ['record'],
        properties: { rel: 'record:one', identity: 'One record' },
        actions: [{ name: 'open', title: 'Open', method: 'POST', href: '/api/exec', fields: {} }],
        links: [],
        'guard-results': [],
      },
    ],
  };
}

function repeatedWord(root: SurfaceNode): string {
  let word: string | undefined;
  const visit = (node: SurfaceNode, repeated = false): void => {
    if (node.kind === 'repeat') visit(node.item, true);
    else if (node.kind === 'word' && repeated) word = node.word;
    else if (node.kind === 'layout') node.children.forEach((child) => visit(child, repeated));
    else if (node.kind === 'slot') visit(node.child, repeated);
  };
  visit(root);
  if (word === undefined) throw new Error('expected a repeated member word');
  return word;
}

function plannedMemberWord(trait: SurfaceTrait): string {
  const declaration = deriveAppWorkspaceComposition('future', sitemapWith(trait))!;
  const entities = [applicationEntity(), collectionEntity(trait)];
  const planned = planWorkspaceComposition({
    rels: declaration.regions.map(({ source }) => source),
    entities,
    declaration,
    regions: declaration.regions.map((region, index) => ({
      declaration: region,
      entity: entities[index],
    })),
    grantedApplications: ['future'],
  });
  return repeatedWord(planned.surface.root);
}

describe('T39 G9 Red: visual posture belongs to generic Presentation policy', () => {
  it('keeps density, vocabulary, sticky and device decisions out of the Application adapter', () => {
    const declaration = deriveAppWorkspaceComposition('future', sitemapWith('output-catalog'))!;
    const serialized = JSON.stringify(declaration.regions);

    expect(serialized).not.toMatch(/density|table|card|sticky|device|desktop|narrow/u);
  });

  it('selects collection member posture from entity shape and semantic role in the planner', () => {
    expect(plannedMemberWord('output-catalog')).toBe('member-table');
    expect(plannedMemberWord('review-queue')).toBe('member-card');
  });
});
