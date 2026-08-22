import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '../siren';
import {
  SEMANTIC_REGION_ROLES,
  hashSurfaceTree,
  planGenericSurface,
  restoreSurfaceTree,
  serializeSurfaceTree,
  validateSurfaceCatalog,
  validateSurfaceTree,
  type SurfaceCatalog,
  type SurfaceTree,
} from './index';

const catalog: SurfaceCatalog = {
  id: 'catalog:baseline',
  version: '7',
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
  },
};

const entityDependency = {
  kind: 'entity' as const,
  subject: 'record:alpha',
  version: 'entity-v3',
  paths: ['properties.fields.summary'],
};
const catalogDependency = {
  kind: 'catalog' as const,
  subject: catalog.id,
  version: catalog.version,
};
const provenance = [{ kind: 'presentation-agent' as const, ref: 'plan:1', model: 'model:1' }];

function validSurface(): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      dependencies: [],
      provenance,
      children: [
        {
          kind: 'slot',
          id: 'content-slot',
          role: 'primary-content',
          name: 'primary-content',
          dependencies: [],
          provenance,
          child: {
            kind: 'word',
            id: 'content-word',
            role: 'primary-content',
            word: 'prose',
            bindings: {
              value: {
                kind: 'property',
                subject: 'record:alpha',
                path: 'properties.fields.summary',
              },
            },
            dependencies: [catalogDependency, entityDependency],
            provenance,
          },
        },
        {
          kind: 'repeat',
          id: 'members',
          role: 'relation',
          source: { kind: 'entities', subject: 'record:alpha' },
          dependencies: [
            {
              kind: 'entity',
              subject: 'record:alpha',
              version: 'entity-v3',
              paths: ['$entities'],
            },
          ],
          provenance,
          item: {
            kind: 'word',
            id: 'member-identity',
            role: 'identity',
            word: 'prose',
            bindings: { value: { kind: 'item', path: 'properties.rel' } },
            dependencies: [catalogDependency],
            provenance,
          },
        },
      ],
    },
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
}

describe('normalized Surface Tree', () => {
  it('defines the complete application-semantic region vocabulary', () => {
    expect(SEMANTIC_REGION_ROLES).toEqual([
      'identity',
      'status',
      'primary-content',
      'metadata',
      'relation',
      'actions',
      'diagnostic',
    ]);
  });

  it('accepts layout, slot, repeat and catalog word nodes with binding-only values', () => {
    const result = validateSurfaceTree(validSurface(), catalog);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.surface.root.kind).toBe('layout');
    expect(JSON.stringify(result.surface)).not.toContain('A factual value');
  });

  it('normalizes, hashes and serializes independently of record/dependency insertion order', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (reverseKeys, reverseDependencies) => {
        const first = validSurface();
        const second = (
          reverseKeys ? reverseObjectKeys(validSurface()) : validSurface()
        ) as SurfaceTree;
        const word = ((second.root.kind === 'layout' && second.root.children[0]?.kind === 'slot'
          ? second.root.children[0].child
          : undefined) ?? {}) as Record<string, unknown>;
        const dependencies = word.dependencies as unknown[];
        if (reverseDependencies) word.dependencies = [...dependencies].reverse();

        const firstResult = validateSurfaceTree(first, catalog);
        const secondResult = validateSurfaceTree(second, catalog);
        expect(secondResult.valid).toBe(true);
        expect(serializeSurfaceTree(secondResult.surface)).toBe(
          serializeSurfaceTree(firstResult.surface),
        );
        expect(hashSurfaceTree(secondResult.surface)).toBe(hashSurfaceTree(firstResult.surface));
      }),
    );
  });

  it('restores the same normalized model and canonical hash', () => {
    const initial = validateSurfaceTree(validSurface(), catalog);
    const serialized = serializeSurfaceTree(initial.surface);
    const restored = restoreSurfaceTree(serialized, catalog);

    expect(restored).toEqual(initial);
    expect(hashSurfaceTree(restored.surface)).toBe(hashSurfaceTree(initial.surface));
  });

  it('isolates an unknown-word subtree while retaining verified siblings', () => {
    const input = validSurface();
    if (input.root.kind !== 'layout') throw new Error('fixture must be a layout');
    input.root.children.push({
      kind: 'word',
      id: 'bad-word',
      role: 'metadata',
      word: 'not-in-catalog',
      bindings: {},
      dependencies: [catalogDependency],
      provenance,
    });

    const result = validateSurfaceTree(input, catalog);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'bad-word', code: 'unknown-word' }),
      ]),
    );
    expect(result.surface.root).toMatchObject({
      kind: 'layout',
      children: [
        { kind: 'slot', id: 'content-slot' },
        { kind: 'repeat', id: 'members' },
        { kind: 'diagnostic', role: 'diagnostic', failedNodeId: 'bad-word' },
      ],
    });
  });

  it('rejects literal facts, unknown inputs and uncovered dependencies before interaction', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        (literal) => {
          const input = validSurface() as unknown as Record<string, unknown>;
          const root = input.root as { children: Array<{ child?: { bindings?: unknown } }> };
          root.children[0]!.child!.bindings = { value: literal };
          const result = validateSurfaceTree(input, catalog);
          expect(result.valid).toBe(false);
          expect(result.surface.root.kind).toBe('layout');
          if (result.surface.root.kind !== 'layout') return;
          expect(result.surface.root.children[0]).toMatchObject({
            kind: 'slot',
            child: { kind: 'diagnostic' },
          });
        },
      ),
    );

    const unknownInput = validSurface();
    if (unknownInput.root.kind !== 'layout' || unknownInput.root.children[0]?.kind !== 'slot') {
      throw new Error('fixture must contain the content slot');
    }
    const word = unknownInput.root.children[0].child;
    if (word.kind !== 'word') throw new Error('fixture must contain a word');
    word.bindings.extra = { kind: 'property', subject: 'record:alpha', path: 'properties.secret' };
    word.dependencies = [catalogDependency];

    const result = validateSurfaceTree(unknownInput, catalog);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unknown-binding', 'dependency-missing']),
    );
  });

  it('fails closed when the catalog version dependency is stale', () => {
    const input = validSurface();
    if (input.root.kind !== 'layout' || input.root.children[0]?.kind !== 'slot') {
      throw new Error('fixture must contain the content slot');
    }
    const word = input.root.children[0].child;
    if (word.kind !== 'word') throw new Error('fixture must contain a word');
    word.dependencies = word.dependencies.map((dependency) =>
      dependency.kind === 'catalog' ? { ...dependency, version: 'stale' } : dependency,
    );

    const result = validateSurfaceTree(input, catalog);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'content-word', code: 'catalog-dependency-invalid' }),
      ]),
    );
  });

  it('rejects a malformed catalog as one non-interactive root diagnostic', () => {
    const malformed = {
      ...catalog,
      words: { prose: { roles: ['not-a-semantic-role'], bindings: {} } },
    };

    expect(validateSurfaceCatalog(malformed)).toMatchObject({ valid: false });
    const result = validateSurfaceTree(validSurface(), malformed as unknown as SurfaceCatalog);
    expect(result).toMatchObject({
      valid: false,
      surface: { root: { kind: 'diagnostic', code: 'catalog-invalid' } },
      issues: [{ code: 'catalog-invalid', nodeId: 'root' }],
    });
  });
});

describe('generic semantic fallback planner', () => {
  const entity: SirenEntity = {
    class: ['opaque-kind', 'opaque-state'],
    properties: {
      rel: 'record:alpha',
      node: 'active',
      title: 'Node label must not become identity',
      fields: { displayName: 'Alpha', summary: 'A factual value' },
    },
    actions: [{ name: 'do-something', title: 'Do it', method: 'POST', href: '/exec', fields: {} }],
    links: [{ rel: ['self'], href: '/entity?rel=record%3Aalpha' }],
  };

  it('uses explicit semantic hints and Siren structure without copying facts', () => {
    const surface = planGenericSurface('record:alpha', entity, catalog, {
      entityVersion: 'entity-v3',
      semanticHints: {
        'properties.fields.displayName': 'identity',
        'properties.fields.summary': 'primary-content',
      },
    });
    const result = validateSurfaceTree(surface, catalog);
    const serialized = serializeSurfaceTree(result.surface);

    expect(result.valid).toBe(true);
    expect(serialized).toContain('properties.fields.displayName');
    expect(serialized).toContain('properties.fields.summary');
    expect(serialized).not.toContain('Node label must not become identity');
    expect(serialized).not.toContain('A factual value');
    expect(serialized).not.toContain('do-something');
    expect(serialized).toContain('"role":"actions"');
    expect(serialized).toContain('"role":"relation"');
  });

  it('never consults entity class/type to choose a page or component', () => {
    const guarded = new Proxy(entity, {
      get(target, property, receiver) {
        if (property === 'class') throw new Error('class-based routing is forbidden');
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(() =>
      planGenericSurface('record:alpha', guarded, catalog, { entityVersion: 'entity-v3' }),
    ).not.toThrow();

    const source = readFileSync(fileURLToPath(new URL('./surface.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/entity\.class|\.class\.includes|type\s*(?:===|=>)\s*component/i);
    expect(source).not.toMatch(/ArticlePage|DetailPage|FlowPage|post:first-post/);
  });
});
