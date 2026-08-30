import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';

import { parseFlowDefinition } from '../core/parse';
import { project } from './siren';
import { deriveSitemap } from './sitemap';

function flow(title: unknown = '研究线索') {
  return {
    name: 'research-item',
    title: '研究线索状态',
    app: 'research',
    initial: 'open',
    collections: [{ collection: 'research-items', title }],
    cognitive: { version: 1, traits: ['work-queue'], emptyMeaning: 'ready-to-start' },
    nodes: [{ name: 'open', title: '待验证', actions: [] }],
  };
}

describe('semantic collection title contract', () => {
  it('strictly parses the optional title and rejects empty/non-string values', () => {
    expect(parseFlowDefinition(flow()).collections).toEqual([
      { collection: 'research-items', title: '研究线索' },
    ]);
    expect(() => parseFlowDefinition(flow(''))).toThrow(/collections\[0\]\.title/);
    expect(() => parseFlowDefinition(flow(7))).toThrow(/collections\[0\]\.title/);
  });

  it('projects the same title into sitemap and exact Siren identity and versions it', () => {
    const declared = parseFlowDefinition(flow());
    const renamed = parseFlowDefinition(flow('待验证线索'));
    const sitemap = deriveSitemap([declared]);
    const renamedSitemap = deriveSitemap([renamed]);
    expect(sitemap.surfaces.find(({ rel }) => rel === 'research-items')).toMatchObject({
      title: '研究线索',
      app: 'research',
      presentation: { emptyMeaning: 'ready-to-start' },
    });
    expect(renamedSitemap.version).not.toBe(sitemap.version);

    const entity = project(
      { instances: {}, collections: { 'research-items': [] } },
      'research-items',
      { flows: { [declared.name]: declared }, guards: seedGuardRegistry },
    );
    expect(entity?.properties).toMatchObject({
      rel: 'research-items',
      title: '研究线索',
      identity: '研究线索',
      presentation: {
        emptyMeaning: 'ready-to-start',
        fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
      },
    });
  });
});
