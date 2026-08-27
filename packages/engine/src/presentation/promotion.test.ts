import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { CompositionDeclaration } from '@ui4a/shared';

import type { SirenEntity } from '../contract/siren/index';
import { composeSurfaceRegions } from './compose';
import { planGenericSurface, type SurfaceCatalog } from './surface/index';
import { applySidecarCommand, createPresentationSnapshot } from './sidecar';
import { explainSidecarPresentation, promoteUserSidecarCandidate } from './promotion';
import { createRecipeRegistry, promoteRecipe, registerRecipeCandidate } from './recipe/recipe';

const catalog: SurfaceCatalog = {
  id: 'catalog:test',
  version: 'v1',
  words: {
    prose: {
      roles: ['primary-content'],
      bindings: { value: { sources: ['property'], required: true } },
    },
  },
};

function snapshot() {
  return applySidecarCommand(createPresentationSnapshot(), {
    kind: 'instantiate',
    eventId: 'e1',
    commandId: 'c1',
    sidecarId: 'sidecar:1',
    key: {
      principal: 'user:mike',
      subject: 'post:first',
      intent: 'read',
      deviceClass: 'wide',
    },
    version: {
      surface: {
        schemaVersion: 1,
        root: {
          kind: 'layout',
          id: 'root',
          role: 'primary-content',
          layout: 'stack',
          dependencies: [],
          provenance: [{ kind: 'human-patch', ref: 'message:1' }],
          children: [
            {
              kind: 'slot',
              id: 'subject-slot',
              role: 'primary-content',
              name: 'subject',
              dependencies: [],
              provenance: [{ kind: 'human-patch', ref: 'message:1' }],
              child: {
                kind: 'word',
                id: 'body',
                role: 'primary-content',
                word: 'prose',
                bindings: {
                  value: {
                    kind: 'property',
                    subject: 'post:first',
                    path: 'properties.fields.body',
                  },
                },
                dependencies: [
                  {
                    kind: 'entity',
                    subject: 'post:first',
                    version: 'entity-v1',
                    paths: ['properties.fields.body'],
                  },
                  { kind: 'catalog', subject: catalog.id, version: catalog.version },
                ],
                provenance: [{ kind: 'human-patch', ref: 'message:1' }],
              },
            },
          ],
        },
      },
      dependencies: [
        {
          id: 'entity',
          subtreeId: 'body',
          kind: 'entity-contract',
          ref: 'post:first',
          pointers: ['properties.fields.body'],
          mode: 'invalidate',
          fingerprint: 'entity-v1',
          optional: false,
        },
      ],
      provenance: { kind: 'human-patch', ref: 'message:1' },
      changedPaths: ['/root'],
    },
  }).snapshot;
}

function compositionSnapshot() {
  const composed = snapshot();
  const sidecar = composed.sidecars['sidecar:1']!;
  const active = sidecar.versions[sidecar.activeVersion]!;
  active.surface = {
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      dependencies: [],
      provenance: [],
      children: [
        {
          kind: 'slot',
          id: 'waiting-slot',
          role: 'primary-content',
          name: 'waiting',
          dependencies: [],
          provenance: [],
          child: {
            kind: 'repeat',
            id: 'waiting-list',
            role: 'primary-content',
            source: { kind: 'entities', subject: 'inbox' },
            dependencies: [
              { kind: 'entity', subject: 'inbox', version: 'inbox-v1', paths: ['$entities'] },
            ],
            provenance: [],
            item: {
              kind: 'word',
              id: 'waiting-item',
              role: 'primary-content',
              word: 'prose',
              bindings: { value: { kind: 'item', path: 'properties.rel' } },
              dependencies: [],
              provenance: [],
            },
          },
        },
        {
          kind: 'slot',
          id: 'moving-slot',
          role: 'primary-content',
          name: 'moving',
          dependencies: [],
          provenance: [],
          child: {
            kind: 'word',
            id: 'moving-body',
            role: 'primary-content',
            word: 'prose',
            bindings: {
              value: {
                kind: 'property',
                subject: 'delegations',
                path: 'properties.fields.title',
              },
            },
            dependencies: [
              {
                kind: 'entity',
                subject: 'delegations',
                version: 'delegations-v2',
                paths: ['properties.fields.title'],
              },
            ],
            provenance: [],
          },
        },
      ],
    },
  };
  return composed;
}

describe('Sidecar promotion and explanation', () => {
  it('parameterizes user/entity identity, emits a mechanical diff, and still needs human promotion', () => {
    const result = promoteUserSidecarCandidate(snapshot().sidecars['sidecar:1']!, {
      application: 'publishing',
      applicationVersion: '1',
      scenario: 'inspect',
      subjectShape: 'post',
      intent: 'read',
      catalog,
      slots: [{ name: 'subject', kind: 'entity', subject: 'post:first' }],
      dependencies: [
        { kind: 'definition', subject: 'flow:post-status', version: '1' },
        { kind: 'catalog', subject: catalog.id, version: catalog.version },
      ],
    });
    expect(JSON.stringify(result.candidate)).not.toMatch(/user:mike|post:first/);
    expect(JSON.stringify(result.candidate)).toContain('$slot:subject');
    expect(result.diff).toMatchObject({ fromSidecarVersion: 1, parameterized: true });

    const registered = registerRecipeCandidate(
      createRecipeRegistry(),
      result.candidate,
      catalog,
      'promotion:1',
    );
    expect(() => promoteRecipe(registered.registry, registered.recipe.id, 'agent')).toThrow();
    expect(promoteRecipe(registered.registry, registered.recipe.id, 'human')).toMatchObject({
      activePromotedByKey: expect.any(Object),
    });
  });

  it('parameterizes every composition source into the complete ordered slot shape', () => {
    const result = promoteUserSidecarCandidate(compositionSnapshot().sidecars['sidecar:1']!, {
      application: 'default',
      applicationVersion: '1',
      scenario: 'my-work',
      subjectShape: 'composition:my-work@3[waiting:collection,moving:entity]',
      intent: 'organize',
      catalog,
      slots: [
        { name: 'waiting', kind: 'collection', subject: 'inbox' },
        { name: 'moving', kind: 'entity', subject: 'delegations' },
      ],
      dependencies: [{ kind: 'catalog', subject: catalog.id, version: catalog.version }],
    });

    expect(result.candidate.slots).toEqual([
      { name: 'waiting', kind: 'collection' },
      { name: 'moving', kind: 'entity' },
    ]);
    expect(result.diff.subjectSlots).toEqual(['waiting', 'moving']);
    const template = JSON.stringify(result.candidate.surfaceTemplate);
    expect(template).not.toMatch(/inbox|delegations-v2/);
    expect(template).toContain('$slot:waiting');
    expect(template).toContain('$slot:moving');
  });

  it('promotes real composed generic surfaces by direct region slots only', () => {
    const declaration: CompositionDeclaration = {
      id: 'my-work',
      version: '3',
      regions: [
        { region: 'waiting', source: 'inbox', intent: 'review', mode: 'rehydrate' },
        { region: 'moving', source: 'delegations', intent: 'track', mode: 'invalidate' },
      ],
    };
    const entity = (rel: string): SirenEntity => ({
      class: ['collection'],
      properties: { rel, fields: { title: `${rel} title` } },
      actions: [],
      links: [],
    });
    const generic = (rel: string) =>
      planGenericSurface(rel, entity(rel), catalog, {
        entityVersion: `entity:${rel}:v1`,
        intent: 'read',
        semanticHints: { 'properties.fields.title': 'primary-content' },
      });
    const plan = composeSurfaceRegions(
      declaration,
      [
        {
          region: 'waiting',
          source: 'inbox',
          sourceKind: 'collection',
          surface: generic('inbox'),
          entityFingerprint: 'entity:inbox:v1',
          membershipFingerprint: 'members:inbox:v1',
        },
        {
          region: 'moving',
          source: 'delegations',
          sourceKind: 'entity',
          surface: generic('delegations'),
          entityFingerprint: 'entity:delegations:v1',
        },
      ],
      {
        declarationFingerprint: 'declaration:v3',
        catalog,
        catalogFingerprint: catalog.version,
        policyRef: 'policy:test',
        policyFingerprint: 'policy:v1',
      },
    );
    const composed = snapshot();
    composed.sidecars['sidecar:1']!.versions[1]!.surface = plan.surface;

    const result = promoteUserSidecarCandidate(composed.sidecars['sidecar:1']!, {
      application: 'default',
      applicationVersion: '1',
      scenario: 'my-work',
      subjectShape: plan.subjectShape,
      intent: 'organize',
      catalog,
      slots: [
        { name: 'waiting', kind: 'collection', subject: 'inbox' },
        { name: 'moving', kind: 'entity', subject: 'delegations' },
      ],
      dependencies: [{ kind: 'catalog', subject: catalog.id, version: catalog.version }],
    });

    expect(result.diff.subjectSlots).toEqual(['waiting', 'moving']);
    const template = JSON.stringify(result.candidate.surfaceTemplate);
    expect(template).not.toContain('"subject":"inbox"');
    expect(template).not.toContain('"subject":"delegations"');
  });

  it.each([
    [
      'duplicate slot name',
      [
        { name: 'waiting', kind: 'collection' as const, subject: 'inbox' },
        { name: 'waiting', kind: 'entity' as const, subject: 'delegations' },
      ],
    ],
    [
      'placeholder instance subject',
      [
        { name: 'waiting', kind: 'collection' as const, subject: '$slot:waiting' },
        { name: 'moving', kind: 'entity' as const, subject: 'delegations' },
      ],
    ],
  ])('fails closed for %s', (_label, slots) => {
    expect(() =>
      promoteUserSidecarCandidate(compositionSnapshot().sidecars['sidecar:1']!, {
        application: 'default',
        applicationVersion: '1',
        scenario: 'my-work',
        subjectShape: 'composition:my-work@3[waiting:collection,moving:entity]',
        intent: 'organize',
        catalog,
        slots,
        dependencies: [{ kind: 'catalog', subject: catalog.id, version: catalog.version }],
      }),
    ).toThrow(/slot|subject/i);
  });

  it('rejects off-grammar uppercase slot names per the shared region id grammar (R13)', () => {
    const aggregate = compositionSnapshot().sidecars['sidecar:1']!;
    const root = aggregate.versions[1]!.surface.root;
    if (root.kind !== 'layout' || root.children[0]?.kind !== 'slot') throw new Error('fixture');
    root.children[0].name = 'Waiting';
    // 仅让名字语法越界:表面形状、subject 映射与其余闸全部合法。
    expect(() =>
      promoteUserSidecarCandidate(aggregate, {
        application: 'default',
        applicationVersion: '1',
        scenario: 'my-work',
        subjectShape: 'composition:my-work@3[Waiting:collection,moving:entity]',
        intent: 'organize',
        catalog,
        slots: [
          { name: 'Waiting', kind: 'collection', subject: 'inbox' },
          { name: 'moving', kind: 'entity', subject: 'delegations' },
        ],
        dependencies: [{ kind: 'catalog', subject: catalog.id, version: catalog.version }],
      }),
    ).toThrow(/slot name/u);
  });

  it('parameterizes the same real source independently in two intent regions', () => {
    const aggregate = compositionSnapshot().sidecars['sidecar:1']!;
    const root = aggregate.versions[1]!.surface.root;
    if (root.kind !== 'layout' || root.children[1]?.kind !== 'slot') throw new Error('fixture');
    const moving = root.children[1].child;
    if (moving.kind !== 'word') throw new Error('fixture');
    moving.bindings.value = {
      kind: 'property',
      subject: 'inbox',
      path: 'properties.fields.title',
    };
    moving.dependencies = [
      {
        kind: 'entity',
        subject: 'inbox',
        version: 'inbox-v1',
        paths: ['properties.fields.title'],
      },
    ];

    const result = promoteUserSidecarCandidate(aggregate, {
      application: 'default',
      applicationVersion: '1',
      scenario: 'same-source-two-intents',
      subjectShape: 'composition:same@1[waiting:collection,moving:entity]',
      intent: 'organize',
      catalog,
      slots: [
        { name: 'waiting', kind: 'collection', subject: 'inbox' },
        { name: 'moving', kind: 'entity', subject: 'inbox' },
      ],
      dependencies: [{ kind: 'catalog', subject: catalog.id, version: catalog.version }],
    });

    const serialized = JSON.stringify(result.candidate.surfaceTemplate);
    expect(serialized).toContain('$slot:waiting');
    expect(serialized).toContain('$slot:moving');
    expect(serialized).not.toContain('"subject":"inbox"');
  });

  it('fails closed when a surface source or named region is not mapped', () => {
    const aggregate = compositionSnapshot().sidecars['sidecar:1']!;
    const common = {
      application: 'default',
      applicationVersion: '1',
      scenario: 'my-work',
      subjectShape: 'composition:my-work@3[waiting:collection]',
      intent: 'organize',
      catalog,
      dependencies: [{ kind: 'catalog' as const, subject: catalog.id, version: catalog.version }],
    };
    expect(() =>
      promoteUserSidecarCandidate(aggregate, {
        ...common,
        slots: [{ name: 'waiting', kind: 'collection', subject: 'inbox' }],
      }),
    ).toThrow(/unmapped|slot/i);
    expect(() =>
      promoteUserSidecarCandidate(aggregate, {
        ...common,
        slots: [
          { name: 'other', kind: 'collection', subject: 'inbox' },
          { name: 'moving', kind: 'entity', subject: 'delegations' },
        ],
      }),
    ).toThrow(/slot/i);
  });

  it('derives explanation from goal, dependencies, provenance and retention without facts', () => {
    expect(explainSidecarPresentation(snapshot(), 'sidecar:1')).toEqual({
      sidecarId: 'sidecar:1',
      version: 1,
      subject: 'post:first',
      intent: 'read',
      retention: 'cache',
      provenance: { kind: 'human-patch', ref: 'message:1' },
      dependencyIds: ['entity'],
      staleReason: null,
    });
    expect(() => explainSidecarPresentation(createPresentationSnapshot(), 'missing')).toThrow(
      /provenance/i,
    );
  });

  it('explains full and partial workspace regions in declaration order without source or policy leakage', () => {
    const workspace = compositionSnapshot();
    const aggregate = workspace.sidecars['sidecar:1']!;
    aggregate.key.subject = 'workspace:my-work';
    const active = aggregate.versions[aggregate.activeVersion]!;
    if (active.surface.root.kind !== 'layout') throw new Error('fixture must be a layout');
    active.surface.root.provenance = [
      { kind: 'composition-declaration', ref: 'composition:my-work@3' },
    ];
    active.surface.root.children[0]!.provenance = [
      { kind: 'composition-declaration', ref: 'composition:my-work@3#waiting' },
    ];
    active.surface.root.children[1]!.provenance = [
      { kind: 'composition-declaration', ref: 'composition:my-work@3#moving' },
    ];
    active.dependencies = [
      {
        id: 'composition:my-work@3:waiting:entity-contract',
        subtreeId: 'waiting-slot',
        kind: 'entity-contract',
        ref: 'inbox-secret-source',
        pointers: ['$contract'],
        mode: 'invalidate',
        fingerprint: 'secret-entity-fingerprint',
        optional: false,
      },
      {
        id: 'composition:my-work@3:policy',
        subtreeId: 'root',
        kind: 'policy',
        ref: 'secret-policy-scope',
        pointers: ['$policy'],
        mode: 'invalidate',
        fingerprint: 'secret-policy-fingerprint',
        optional: false,
      },
    ];

    expect(explainSidecarPresentation(workspace, 'sidecar:1').composition).toEqual({
      id: 'my-work',
      version: '3',
      regions: [
        { region: 'waiting', availability: 'available' },
        { region: 'moving', availability: 'available' },
      ],
      declarationProvenance: {
        kind: 'composition-declaration',
        ref: 'composition:my-work@3',
      },
    });

    const moving = active.surface.root.children[1]!;
    if (moving.kind !== 'slot') throw new Error('fixture must contain region slots');
    moving.child = {
      kind: 'diagnostic',
      id: 'moving-unavailable',
      role: 'diagnostic',
      code: 'region-unavailable',
      dependencies: [],
      provenance: [{ kind: 'validator', ref: 'region-unavailable' }],
    };
    const partial = explainSidecarPresentation(workspace, 'sidecar:1');
    expect(partial.composition?.regions).toEqual([
      { region: 'waiting', availability: 'available' },
      {
        region: 'moving',
        availability: 'unavailable',
        diagnosticCode: 'region-unavailable',
      },
    ]);
    const serialized = JSON.stringify(partial);
    expect(serialized).not.toContain('inbox-secret-source');
    expect(serialized).not.toContain('secret-policy-scope');
    expect(serialized).not.toContain('secret-entity-fingerprint');
    expect(serialized).not.toContain('secret-policy-fingerprint');
  });

  it('explains composition solely from root declaration provenance with an opaque subject', () => {
    const composed = compositionSnapshot();
    const aggregate = composed.sidecars['sidecar:1']!;
    aggregate.key.subject = 'ordinary-subject-containing-workspace-text';
    const active = aggregate.versions[aggregate.activeVersion]!;
    if (active.surface.root.kind !== 'layout') throw new Error('fixture must be a layout');
    active.surface.root.provenance = [
      { kind: 'composition-declaration', ref: 'composition:my-work@2026.08@candidate' },
    ];

    expect(explainSidecarPresentation(composed, 'sidecar:1').composition).toMatchObject({
      id: 'my-work',
      version: '2026.08@candidate',
    });

    active.surface.root.provenance = [];
    aggregate.key.subject = 'workspace:my-work';
    expect(explainSidecarPresentation(composed, 'sidecar:1')).not.toHaveProperty('composition');
  });

  it('keeps workspace wire parsing out of the pure explanation module', () => {
    const source = readFileSync(new URL('./promotion.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('workspace:');
    expect(source).not.toMatch(/key\.subject.*(?:startsWith|slice|substring)/s);
  });
});
