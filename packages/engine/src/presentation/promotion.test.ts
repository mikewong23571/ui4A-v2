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
      policyScope: 'scope:v1',
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
    expect(JSON.stringify(result.candidate.surfaceTemplate)).not.toMatch(/inbox|delegations-v2/);
    expect(JSON.stringify(result.candidate.surfaceTemplate)).toContain('$slot:waiting');
    expect(JSON.stringify(result.candidate.surfaceTemplate)).toContain('$slot:moving');
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
        semanticHints: { 'properties.fields.title': 'primary-content' },
        provenanceRef: `generic:${rel}`,
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
    expect(JSON.stringify(result.candidate.surfaceTemplate)).not.toContain('"subject":"inbox"');
    expect(JSON.stringify(result.candidate.surfaceTemplate)).not.toContain(
      '"subject":"delegations"',
    );
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
});
