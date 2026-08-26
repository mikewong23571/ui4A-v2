import type { CompositionDeclaration } from '@ui4a/shared';
import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '../contract/siren/index';
import {
  assembleSurfaceRegions,
  composeSurfaceRegions,
  type CompositionRegionSurfaceInput,
} from './compose';
import { dependencyDecision } from './sidecar';
import {
  hashSurfaceTree,
  normalizeSurfaceTree,
  planGenericSurface,
  serializeSurfaceTree,
  validateSurfaceTree,
  type SurfaceCatalog,
  type SurfaceNode,
  type SurfaceTree,
} from './surface/index';

const catalog: SurfaceCatalog = {
  id: 'catalog:semantic',
  version: '9',
  words: {
    prose: {
      roles: ['identity', 'primary-content', 'metadata'],
      bindings: { value: { sources: ['property', 'item'], required: true } },
    },
    state: {
      roles: ['status'],
      bindings: { value: { sources: ['property'], required: true } },
    },
    controls: {
      roles: ['actions'],
      bindings: { actions: { sources: ['actions'], required: true } },
    },
    references: {
      roles: ['relation'],
      bindings: { links: { sources: ['links'], required: true } },
    },
    collection: {
      roles: ['relation'],
      bindings: { entities: { sources: ['entities'], required: true } },
    },
    memberLink: {
      roles: ['identity'],
      bindings: {
        label: { sources: ['item'], required: true },
        rel: { sources: ['item'], required: true },
      },
      pattern: 'member-link',
    },
  },
};

const declaration: CompositionDeclaration = {
  id: 'my-work',
  version: '3',
  regions: [
    { region: 'waiting', source: 'inbox', intent: 'review', mode: 'rehydrate' },
    { region: 'moving', source: 'delegations', intent: 'track', mode: 'invalidate' },
  ],
};

const context = {
  declarationFingerprint: 'sha256:declaration-v3',
  catalog,
  catalogFingerprint: 'sha256:catalog-v9',
  policyRef: 'policy:author',
  policyFingerprint: 'sha256:policy-v4',
} as const;

function entity(subject: string, collection: boolean): SirenEntity {
  return {
    class: ['collection'],
    properties: {
      rel: subject,
      node: 'active',
      fields: { title: `${subject} title`, summary: `${subject} summary` },
    },
    actions: [{ name: 'inspect', title: 'Inspect', method: 'POST', href: '/api/exec', fields: {} }],
    links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(subject)}` }],
    ...(collection
      ? {
          entities: [
            {
              class: ['member'],
              properties: { rel: `${subject}:one`, identity: 'First member' },
              actions: [],
              links: [],
            },
          ],
        }
      : {}),
  };
}

function input(
  region: string,
  source: string,
  sourceKind: CompositionRegionSurfaceInput['sourceKind'],
): CompositionRegionSurfaceInput {
  return {
    region,
    source,
    sourceKind,
    surface: planGenericSurface(source, entity(source, sourceKind === 'collection'), catalog, {
      entityVersion: `contract:${source}`,
      semanticHints: { 'properties.fields.summary': 'primary-content' },
      provenanceRef: `generic:${source}`,
    }),
    entityFingerprint: `entity:${source}:v1`,
    ...(sourceKind === 'collection' ? { membershipFingerprint: `members:${source}:v1` } : {}),
  };
}

function diagnosticSurface(id: string, failedNodeId: string): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'diagnostic',
      id,
      role: 'diagnostic',
      code: 'adversarial-diagnostic',
      failedNodeId,
      dependencies: [],
      provenance: [{ kind: 'validator', ref: 'test:adversarial' }],
    },
  };
}

function walk(node: SurfaceNode, visit: (candidate: SurfaceNode) => void): void {
  visit(node);
  if (node.kind === 'layout') node.children.forEach((child) => walk(child, visit));
  if (node.kind === 'slot') walk(node.child, visit);
  if (node.kind === 'repeat') walk(node.item, visit);
}

function allNodes(surface: SurfaceTree): SurfaceNode[] {
  const nodes: SurfaceNode[] = [];
  walk(surface.root, (node) => nodes.push(node));
  return nodes;
}

describe('composition region planner', () => {
  it('assembles real generic surfaces under declared slots without changing their subjects', () => {
    const result = composeSurfaceRegions(
      declaration,
      [input('moving', 'delegations', 'entity'), input('waiting', 'inbox', 'collection')],
      context,
    );

    expect(result.subjectShape).toBe('composition:my-work@3[waiting:collection,moving:entity]');
    expect(result.regions).toEqual([
      { region: 'waiting', sourceKind: 'collection', mode: 'rehydrate' },
      { region: 'moving', sourceKind: 'entity', mode: 'invalidate' },
    ]);
    expect(result.surface.root).toMatchObject({ kind: 'layout', id: 'root', layout: 'stack' });
    if (result.surface.root.kind !== 'layout') throw new Error('composition root must be a layout');
    expect(
      result.surface.root.children.map((slot) => ({
        id: slot.id,
        name: slot.kind === 'slot' ? slot.name : '',
      })),
    ).toEqual([
      { id: 'region-slot:waiting', name: 'waiting' },
      { id: 'region-slot:moving', name: 'moving' },
    ]);

    const nodes = allNodes(result.surface);
    const ids = nodes.map(({ id }) => id);
    const bindingSubjects = new Set<string>();
    for (const node of nodes) {
      expect(node.provenance).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'composition-declaration' })]),
      );
      if (node.kind === 'word') {
        for (const binding of Object.values(node.bindings)) {
          if (binding.kind !== 'item') bindingSubjects.add(binding.subject);
        }
      }
    }

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('region-node:waiting:')).length).toBeGreaterThan(1);
    expect(ids.filter((id) => id.startsWith('region-node:moving:')).length).toBeGreaterThan(1);
    expect(bindingSubjects).toEqual(new Set(['inbox', 'delegations']));
    expect(JSON.stringify(result.surface)).not.toContain('entity:inbox:v1');
    expect(validateSurfaceTree(result.surface, catalog)).toMatchObject({ valid: true, issues: [] });
  });

  it('normalizes, serializes and hashes identically for either region input order', () => {
    const regions = [
      input('waiting', 'inbox', 'collection'),
      input('moving', 'delegations', 'entity'),
    ];
    const first = composeSurfaceRegions(declaration, regions, context);
    const second = composeSurfaceRegions(declaration, [...regions].reverse(), context);

    expect(normalizeSurfaceTree(second.surface)).toEqual(normalizeSurfaceTree(first.surface));
    expect(serializeSurfaceTree(second.surface)).toBe(serializeSurfaceTree(first.surface));
    expect(hashSurfaceTree(second.surface)).toBe(hashSurfaceTree(first.surface));
    expect(second.dependencies).toEqual(first.dependencies);
  });

  it('emits a stable complete dependency union with D45 invalidation modes', () => {
    const result = composeSurfaceRegions(
      declaration,
      [input('waiting', 'inbox', 'collection'), input('moving', 'delegations', 'entity')],
      context,
    );

    expect(result.dependencies).toEqual([
      expect.objectContaining({
        kind: 'entity-contract',
        ref: 'inbox',
        mode: 'invalidate',
        fingerprint: 'entity:inbox:v1',
      }),
      expect.objectContaining({
        kind: 'collection-membership',
        ref: 'inbox',
        mode: 'rehydrate',
        fingerprint: 'members:inbox:v1',
      }),
      expect.objectContaining({
        kind: 'entity-contract',
        ref: 'delegations',
        mode: 'invalidate',
        fingerprint: 'entity:delegations:v1',
      }),
      expect.objectContaining({
        kind: 'definition',
        ref: 'composition:my-work@3',
        mode: 'invalidate',
        fingerprint: 'sha256:declaration-v3',
      }),
      expect.objectContaining({
        kind: 'catalog',
        ref: catalog.id,
        mode: 'invalidate',
        fingerprint: 'sha256:catalog-v9',
      }),
      expect.objectContaining({
        kind: 'policy',
        ref: 'policy:author',
        mode: 'invalidate',
        fingerprint: 'sha256:policy-v4',
      }),
    ]);
    expect(new Set(result.dependencies.map(({ id }) => id)).size).toBe(result.dependencies.length);
  });

  it('applies each collection region mode to membership drift while contracts invalidate', () => {
    const collectionDeclaration: CompositionDeclaration = {
      id: 'collection-modes',
      version: '1',
      regions: [
        { region: 'live', source: 'inbox', intent: 'review', mode: 'rehydrate' },
        { region: 'structural', source: 'threads', intent: 'organize', mode: 'invalidate' },
      ],
    };
    const initial = composeSurfaceRegions(
      collectionDeclaration,
      [input('live', 'inbox', 'collection'), input('structural', 'threads', 'collection')],
      context,
    );
    const current = initial.dependencies.map((candidate) =>
      candidate.kind === 'collection-membership'
        ? { ...candidate, fingerprint: `${candidate.fingerprint}:changed` }
        : candidate,
    );

    expect(
      initial.dependencies
        .filter(({ kind }) => kind === 'collection-membership')
        .map(({ ref, mode }) => [ref, mode]),
    ).toEqual([
      ['inbox', 'rehydrate'],
      ['threads', 'invalidate'],
    ]);
    expect(
      initial.dependencies.filter(({ kind }) => kind === 'entity-contract').map(({ mode }) => mode),
    ).toEqual(['invalidate', 'invalidate']);
    expect(dependencyDecision(initial.dependencies, current)).toEqual({
      valid: false,
      reused: ['region-slot:live', 'root'],
      replanned: ['region-slot:structural'],
      rehydrated: ['region-slot:live'],
    });
  });

  it('keeps outer slots and adversarial subtree ids in disjoint namespaces', () => {
    const compositionProvenance = [{ kind: 'composition-declaration' as const, ref: 'test:a' }];
    const surface = assembleSurfaceRegions(
      [
        {
          region: 'a',
          surface: diagnosticSurface('root', 'root'),
          provenance: compositionProvenance,
        },
        {
          region: 'region',
          surface: diagnosticSurface('a', 'a'),
          provenance: compositionProvenance,
        },
      ],
      { provenance: compositionProvenance },
    );
    const nodes = allNodes(surface);
    const ids = nodes.map(({ id }) => id);

    expect(ids).toEqual([
      'root',
      'region-slot:a',
      'region-node:a:root',
      'region-slot:region',
      'region-node:region:a',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateSurfaceTree(surface, catalog)).toMatchObject({ valid: true, issues: [] });
  });

  it('maps diagnostic failedNodeId through the same namespace as its target node', () => {
    const compositionProvenance = [{ kind: 'composition-declaration' as const, ref: 'test:a' }];
    const surface = assembleSurfaceRegions(
      [
        {
          region: 'region',
          surface: diagnosticSurface('a', 'a'),
          provenance: compositionProvenance,
        },
      ],
      { provenance: compositionProvenance },
    );
    const diagnostic = allNodes(surface).find((node) => node.kind === 'diagnostic');

    expect(diagnostic).toMatchObject({
      id: 'region-node:region:a',
      failedNodeId: 'region-node:region:a',
    });
    expect(validateSurfaceTree(surface, catalog)).toMatchObject({ valid: true, issues: [] });
  });

  it.each([
    ['missing', [input('waiting', 'inbox', 'collection')]],
    [
      'duplicate',
      [
        input('waiting', 'inbox', 'collection'),
        input('waiting', 'inbox', 'collection'),
        input('moving', 'delegations', 'entity'),
      ],
    ],
    [
      'unknown',
      [
        input('waiting', 'inbox', 'collection'),
        input('moving', 'delegations', 'entity'),
        input('other', 'threads', 'collection'),
      ],
    ],
  ])('fails closed for %s region input', (_case, regions) => {
    expect(() => composeSurfaceRegions(declaration, regions, context)).toThrow(/region input/i);
  });

  it('rejects mismatched source context, missing collection fingerprints and invalid subtrees', () => {
    const moving = input('moving', 'delegations', 'entity');

    expect(() =>
      composeSurfaceRegions(
        declaration,
        [{ ...input('waiting', 'inbox', 'collection'), source: 'threads' }, moving],
        context,
      ),
    ).toThrow(/source/i);
    expect(() =>
      composeSurfaceRegions(
        declaration,
        [{ ...input('waiting', 'inbox', 'collection'), membershipFingerprint: undefined }, moving],
        context,
      ),
    ).toThrow(/membership/i);
    expect(() =>
      composeSurfaceRegions(
        declaration,
        [
          {
            ...input('waiting', 'inbox', 'collection'),
            surface: { schemaVersion: 1, root: { bad: true } } as unknown as SurfaceTree,
          },
          moving,
        ],
        context,
      ),
    ).toThrow(/surface/i);
  });
});
