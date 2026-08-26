import type { CompositionDeclaration } from '@ui4a/shared';
import { describe, expect, it } from 'vitest';

import { composeSurfaceRegions, type CompositionRegionSurfaceInput } from './compose';
import {
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
      roles: ['identity', 'primary-content'],
      bindings: { value: { sources: ['property'], required: true } },
    },
    members: {
      roles: ['relation'],
      bindings: { entities: { sources: ['entities'], required: true } },
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

function surface(subject: string, wordId = 'word-0'): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      dependencies: [],
      provenance: [{ kind: 'generic-fallback', ref: `generic:${subject}` }],
      children: [
        {
          kind: 'slot',
          id: 'region-0',
          role: 'identity',
          name: 'identity-0',
          dependencies: [],
          provenance: [{ kind: 'generic-fallback', ref: `generic:${subject}` }],
          child: {
            kind: 'word',
            id: wordId,
            role: 'identity',
            word: 'prose',
            bindings: {
              value: { kind: 'property', subject, path: 'properties.rel' },
            },
            dependencies: [
              {
                kind: 'entity',
                subject,
                version: `contract:${subject}`,
                paths: ['properties.rel'],
              },
              { kind: 'catalog', subject: catalog.id, version: catalog.version },
            ],
            provenance: [{ kind: 'generic-fallback', ref: `generic:${subject}` }],
          },
        },
      ],
    },
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
    surface: surface(source),
    entityFingerprint: `entity:${source}:v1`,
    ...(sourceKind === 'collection' ? { membershipFingerprint: `members:${source}:v1` } : {}),
  };
}

function walk(node: SurfaceNode, visit: (candidate: SurfaceNode) => void): void {
  visit(node);
  if (node.kind === 'layout') node.children.forEach((child) => walk(child, visit));
  if (node.kind === 'slot') walk(node.child, visit);
  if (node.kind === 'repeat') walk(node.item, visit);
}

describe('composition region planner', () => {
  it('assembles regions in declaration order and namespaces every subtree node id', () => {
    const result = composeSurfaceRegions(
      declaration,
      [input('moving', 'delegations', 'entity'), input('waiting', 'inbox', 'collection')],
      {
        declarationFingerprint: 'sha256:declaration-v3',
        catalog,
        catalogFingerprint: 'sha256:catalog-v9',
        policyRef: 'policy:author',
        policyFingerprint: 'sha256:policy-v4',
      },
    );

    expect(result.subjectShape).toBe('composition:my-work@3[waiting:collection,moving:entity]');
    expect(result.regions).toEqual([
      { region: 'waiting', sourceKind: 'collection', mode: 'rehydrate' },
      { region: 'moving', sourceKind: 'entity', mode: 'invalidate' },
    ]);
    expect(result.surface.root).toMatchObject({
      kind: 'layout',
      id: 'root',
      layout: 'stack',
      children: [
        {
          kind: 'slot',
          id: 'region:waiting',
          name: 'waiting',
          child: { id: 'waiting:root' },
        },
        {
          kind: 'slot',
          id: 'region:moving',
          name: 'moving',
          child: { id: 'moving:root' },
        },
      ],
    });

    const ids: string[] = [];
    const bindingSubjects: string[] = [];
    walk(result.surface.root, (node) => {
      ids.push(node.id);
      expect(node.provenance).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'composition-declaration' })]),
      );
      if (node.kind === 'word') {
        for (const binding of Object.values(node.bindings)) {
          if (binding.kind !== 'item') bindingSubjects.push(binding.subject);
        }
      }
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'waiting:root',
        'waiting:region-0',
        'waiting:word-0',
        'moving:root',
        'moving:region-0',
        'moving:word-0',
      ]),
    );
    expect(bindingSubjects).toEqual(['inbox', 'delegations']);
    expect(JSON.stringify(result.surface)).not.toContain('entity:inbox:v1');
    expect(validateSurfaceTree(result.surface, catalog)).toMatchObject({ valid: true, issues: [] });
  });

  it('emits a stable complete dependency union with D45 invalidation modes', () => {
    const options = {
      declarationFingerprint: 'sha256:declaration-v3',
      catalog,
      catalogFingerprint: 'sha256:catalog-v9',
      policyRef: 'policy:author',
      policyFingerprint: 'sha256:policy-v4',
    } as const;
    const regions = [
      input('waiting', 'inbox', 'collection'),
      input('moving', 'delegations', 'entity'),
    ];
    const first = composeSurfaceRegions(declaration, regions, options);
    const second = composeSurfaceRegions(declaration, [...regions].reverse(), options);

    expect(second.dependencies).toEqual(first.dependencies);
    expect(first.dependencies).toEqual([
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
    expect(new Set(first.dependencies.map(({ id }) => id)).size).toBe(first.dependencies.length);
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
    expect(() =>
      composeSurfaceRegions(declaration, regions, {
        declarationFingerprint: 'sha256:declaration-v3',
        catalog,
        catalogFingerprint: 'sha256:catalog-v9',
        policyRef: 'policy:author',
        policyFingerprint: 'sha256:policy-v4',
      }),
    ).toThrow(/region input/i);
  });

  it('rejects mismatched source context, missing collection fingerprints and invalid subtrees', () => {
    const options = {
      declarationFingerprint: 'sha256:declaration-v3',
      catalog,
      catalogFingerprint: 'sha256:catalog-v9',
      policyRef: 'policy:author',
      policyFingerprint: 'sha256:policy-v4',
    };
    const moving = input('moving', 'delegations', 'entity');

    expect(() =>
      composeSurfaceRegions(
        declaration,
        [{ ...input('waiting', 'inbox', 'collection'), source: 'threads' }, moving],
        options,
      ),
    ).toThrow(/source/i);
    expect(() =>
      composeSurfaceRegions(
        declaration,
        [{ ...input('waiting', 'inbox', 'collection'), membershipFingerprint: undefined }, moving],
        options,
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
        options,
      ),
    ).toThrow(/surface/i);
  });
});
