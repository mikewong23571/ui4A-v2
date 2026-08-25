import { describe, expect, it } from 'vitest';

import type { SurfaceCatalog } from './surface/index';
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

describe('Sidecar promotion and explanation', () => {
  it('parameterizes user/entity identity, emits a mechanical diff, and still needs human promotion', () => {
    const result = promoteUserSidecarCandidate(snapshot().sidecars['sidecar:1']!, {
      application: 'publishing',
      applicationVersion: '1',
      scenario: 'inspect',
      subjectShape: 'post',
      intent: 'read',
      catalog,
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
