import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '../../contract/siren/index';
import {
  SEMANTIC_REGION_ROLES,
  hashSurfaceTree,
  normalizeSurfaceTree,
  planGenericSurface,
  restoreSurfaceTree,
  serializeSurfaceTree,
  validateSurfaceCatalog,
  validateSurfaceTree,
  type SurfaceCatalog,
  type SurfaceNode,
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
      intent: 'read',
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
    expect(serialized).not.toContain('properties.title');
    expect(serialized).toContain('"role":"actions"');
    expect(serialized).toContain('"role":"relation"');
    expect(surface.root).toMatchObject({
      kind: 'layout',
      id: 'root',
      children: [
        {
          kind: 'slot',
          id: 'region-slot:subject',
          name: 'subject',
          child: { kind: 'layout', id: 'region-node:subject:root' },
        },
      ],
    });
    if (
      surface.root.kind !== 'layout' ||
      surface.root.children[0]?.kind !== 'slot' ||
      surface.root.children[0].child.kind !== 'layout'
    ) {
      throw new Error('generic surface must use the subject region');
    }
    expect(surface.root.children[0].child.children.map(({ role }) => role)).toEqual([
      'identity',
      'status',
      'primary-content',
      'actions',
      'relation',
    ]);
  });

  it('preserves the generic binding, dependency and provenance semantics inside the subject region', () => {
    const surface = planGenericSurface('record:alpha', entity, catalog, {
      entityVersion: 'entity-v3',
      intent: 'read',
      semanticHints: {
        'properties.fields.displayName': 'identity',
        'properties.fields.summary': 'primary-content',
      },
      provenanceRef: 'generic:record:alpha',
    });
    const bindings = new Set<string>();
    const dependencies = new Set<string>();
    const provenanceRefs = new Set<string>();

    const visit = (node: SurfaceTree['root']): void => {
      for (const dependency of node.dependencies) {
        dependencies.add(
          `${dependency.kind}:${dependency.subject}:${dependency.version}:${(dependency.paths ?? []).join(',')}`,
        );
      }
      for (const entry of node.provenance) provenanceRefs.add(`${entry.kind}:${entry.ref}`);
      if (node.kind === 'word') {
        for (const binding of Object.values(node.bindings)) {
          bindings.add(
            binding.kind === 'item'
              ? `item:${binding.path}`
              : `${binding.kind}:${binding.subject}:${binding.kind === 'property' ? binding.path : ''}`,
          );
        }
      }
      if (node.kind === 'layout') node.children.forEach(visit);
      if (node.kind === 'slot') visit(node.child);
      if (node.kind === 'repeat') visit(node.item);
    };
    visit(surface.root);

    expect(bindings).toEqual(
      new Set([
        'property:record:alpha:properties.fields.displayName',
        'property:record:alpha:properties.node',
        'property:record:alpha:properties.fields.summary',
        'actions:record:alpha:',
        'links:record:alpha:',
      ]),
    );
    expect(dependencies).toEqual(
      new Set([
        'catalog:catalog:baseline:7:',
        'entity:record:alpha:entity-v3:properties.fields.displayName',
        'entity:record:alpha:entity-v3:properties.node',
        'entity:record:alpha:entity-v3:properties.fields.summary',
        'entity:record:alpha:entity-v3:$actions',
        'entity:record:alpha:entity-v3:$links',
      ]),
    );
    expect(provenanceRefs).toEqual(new Set(['generic-fallback:generic:record:alpha']));
  });

  it('normalizes, serializes and hashes the subject region independently of hint insertion order', () => {
    const first = planGenericSurface('record:alpha', entity, catalog, {
      entityVersion: 'entity-v3',
      intent: 'read',
      semanticHints: {
        'properties.fields.displayName': 'identity',
        'properties.fields.summary': 'primary-content',
      },
    });
    const second = planGenericSurface('record:alpha', entity, catalog, {
      entityVersion: 'entity-v3',
      intent: 'read',
      semanticHints: {
        'properties.fields.summary': 'primary-content',
        'properties.fields.displayName': 'identity',
      },
    });

    expect(validateSurfaceTree(first, catalog)).toMatchObject({ valid: true, issues: [] });
    expect(normalizeSurfaceTree(second)).toEqual(normalizeSurfaceTree(first));
    expect(serializeSurfaceTree(second)).toBe(serializeSurfaceTree(first));
    expect(hashSurfaceTree(second)).toBe(hashSurfaceTree(first));
  });

  it.each([
    ['', catalog, 'generic-input-invalid'],
    [
      'record:alpha',
      {
        ...catalog,
        words: { prose: { roles: ['not-a-semantic-role'], bindings: {} } },
      } as unknown as SurfaceCatalog,
      'catalog-invalid',
    ],
  ])('keeps an honest %s diagnostic inside the subject region', (subject, inputCatalog, code) => {
    const surface = planGenericSurface(subject, entity, inputCatalog, {
      entityVersion: 'entity-v3',
      intent: 'read',
    });

    expect(surface.root).toMatchObject({
      kind: 'layout',
      id: 'root',
      children: [
        {
          kind: 'slot',
          id: 'region-slot:subject',
          name: 'subject',
          child: {
            kind: 'diagnostic',
            id: 'region-node:subject:diagnostic:root',
            code,
          },
        },
      ],
    });
    if (validateSurfaceCatalog(inputCatalog).valid) {
      expect(validateSurfaceTree(surface, inputCatalog)).toMatchObject({ valid: true, issues: [] });
    }
  });

  it('plans member decision cards when members declare actions, member links otherwise (T33 D50)', () => {
    const memberCatalog: SurfaceCatalog = {
      id: 'catalog:members',
      version: '1',
      words: {
        'member-card': {
          roles: ['identity'],
          pattern: 'member-card',
          bindings: {
            label: { sources: ['item'], required: true },
            rel: { sources: ['item'], required: true },
            status: { sources: ['item'] },
            detail: { sources: ['item'] },
            actions: { sources: ['item'] },
            guardResults: { sources: ['item'] },
            fields: { sources: ['item'] },
          },
        },
        'member-link': {
          roles: ['identity'],
          pattern: 'member-link',
          bindings: {
            label: { sources: ['item'], required: true },
            rel: { sources: ['item'], required: true },
            status: { sources: ['item'] },
            detail: { sources: ['item'] },
          },
        },
      },
    };
    const deciding: SirenEntity = {
      class: ['collection', 'deciding'],
      properties: { rel: 'col:deciding', count: 1 },
      actions: [],
      links: [],
      entities: [
        {
          class: ['confirmation', 'pending'],
          properties: { rel: 'confirmation:c1', identity: '归档 · 由 agent 提议' },
          actions: [{ name: 'approve', title: '批准', method: 'POST', href: '/exec', fields: {} }],
          links: [],
          'guard-results': [],
        },
      ],
    };
    const plain: SirenEntity = {
      class: ['collection', 'plain'],
      properties: { rel: 'col:plain', count: 1 },
      actions: [],
      links: [],
      entities: [
        {
          class: ['delegation', 'running'],
          properties: { rel: 'delegation:d1', identity: '情报收集' },
          actions: [],
          links: [],
          'guard-results': [],
        },
      ],
    };

    const findRepeatItem = (surface: SurfaceTree): SurfaceNode => {
      let found: SurfaceNode | undefined;
      const visit = (node: SurfaceNode): void => {
        if (node.kind === 'repeat') {
          found = node.item;
          return;
        }
        if (node.kind === 'layout') node.children.forEach(visit);
        if (node.kind === 'slot') visit(node.child);
      };
      visit(surface.root);
      if (found === undefined) throw new Error('surface must contain a repeat');
      return found;
    };

    const card = findRepeatItem(
      planGenericSurface('col:deciding', deciding, memberCatalog, {
        entityVersion: 'entity-v1',
        intent: 'read',
      }),
    );
    expect(card).toMatchObject({
      kind: 'word',
      word: 'member-card',
      role: 'identity',
      bindings: {
        label: { kind: 'item', path: 'properties.identity' },
        rel: { kind: 'item', path: 'properties.rel' },
        status: { kind: 'item', path: 'properties.status' },
        detail: { kind: 'item', path: 'properties.resume' },
        actions: { kind: 'item', path: 'actions' },
        guardResults: { kind: 'item', path: 'guard-results' },
        fields: { kind: 'item', path: 'properties.fields' },
      },
    });
    expect(
      validateSurfaceTree(
        planGenericSurface('col:deciding', deciding, memberCatalog, {
          entityVersion: 'entity-v1',
          intent: 'read',
        }),
        memberCatalog,
      ).valid,
    ).toBe(true);

    const link = findRepeatItem(
      planGenericSurface('col:plain', plain, memberCatalog, {
        entityVersion: 'entity-v1',
        intent: 'read',
      }),
    );
    expect(link).toMatchObject({
      kind: 'word',
      word: 'member-link',
      bindings: {
        label: { kind: 'item', path: 'properties.identity' },
        rel: { kind: 'item', path: 'properties.rel' },
        status: { kind: 'item', path: 'properties.status' },
        detail: { kind: 'item', path: 'properties.resume' },
      },
    });
  });

  it('never consults entity class/type to choose a page or component', () => {
    const guarded = new Proxy(entity, {
      get(target, property, receiver) {
        if (property === 'class') throw new Error('class-based routing is forbidden');
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(() =>
      planGenericSurface('record:alpha', guarded, catalog, {
        entityVersion: 'entity-v3',
        intent: 'read',
      }),
    ).not.toThrow();

    const source = readFileSync(fileURLToPath(new URL('./generic.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/entity\.class|\.class\.includes|type\s*(?:===|=>)\s*component/i);
    expect(source).not.toMatch(/ArticlePage|DetailPage|FlowPage|post:first-post/);
  });

  it('selects different canonical field subsets for exact intents and uses read for unknown', () => {
    const input: SirenEntity = {
      ...entity,
      properties: {
        ...entity.properties,
        fields: {
          displayName: 'Alpha',
          summary: 'Primary',
          alpha: 'A',
          zeta: 'Z',
        },
      },
    };
    const hints = {
      'properties.fields.displayName': 'identity' as const,
      'properties.fields.summary': 'primary-content' as const,
      'properties.fields.alpha': 'metadata' as const,
      'properties.fields.zeta': 'metadata' as const,
    };
    const paths = (intent: string): string[] => {
      const surface = planGenericSurface('record:alpha', input, catalog, {
        entityVersion: 'entity-v3',
        intent,
        semanticHints: hints,
      });
      const result: string[] = [];
      const visit = (node: SurfaceTree['root']): void => {
        if (node.kind === 'word') {
          for (const binding of Object.values(node.bindings)) {
            if (binding.kind === 'property') result.push(binding.path);
          }
        }
        if (node.kind === 'layout') node.children.forEach(visit);
        if (node.kind === 'slot') visit(node.child);
        if (node.kind === 'repeat') visit(node.item);
      };
      visit(surface.root);
      return result;
    };

    expect(paths('read')).toEqual([
      'properties.fields.displayName',
      'properties.node',
      'properties.fields.summary',
    ]);
    expect(paths('overview')).toEqual([
      'properties.fields.displayName',
      'properties.node',
      'properties.fields.alpha',
      'properties.fields.zeta',
    ]);
    expect(paths('free-form unknown')).toEqual(paths('read'));

    const invalid = planGenericSurface('record:alpha', input, catalog, {
      entityVersion: 'entity-v3',
      intent: '   ',
      semanticHints: hints,
    });
    expect(invalid.root).toMatchObject({
      kind: 'layout',
      children: [{ kind: 'slot', child: { kind: 'diagnostic', code: 'generic-input-invalid' } }],
    });
  });
});
