import { beforeEach, describe, expect, it } from 'vitest';
import { completePresentationRequest } from '@ui4a/shared';

import {
  appendSidecarCommand,
  ensurePresentationTables,
  loadPresentationSnapshot,
} from '../../../../db/presentation';
import { getDb, resetEngineForTests } from '../../../../engine/service';
import {
  getPresentationBroker,
  resetPresentationBrokerForTests,
} from '../../../../engine/presentation/runtime';
import { resetRecipeCoordinatorForTests } from '../../../../engine/presentation/recipes-runtime';
import { getBuiltinComposition } from '../../../../engine/presentation/compositions';
import { GET, POST } from './route';

beforeEach(async () => {
  await ensurePresentationTables(getDb());
  await getDb().query('TRUNCATE events, presentation_user_sidecars');
  resetEngineForTests();
  resetPresentationBrokerForTests();
  resetRecipeCoordinatorForTests();
  await appendSidecarCommand(getDb(), {
    kind: 'instantiate',
    eventId: 'e1',
    commandId: 'c1',
    sidecarId: 'sidecar:1',
    key: {
      principal: 'user:local',
      policyScope: 'local-demo',
      subject: 'post:first-post',
      intent: 'read',
      deviceClass: 'any',
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
          provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
          children: [
            {
              kind: 'slot',
              id: 'subject-slot',
              role: 'primary-content',
              name: 'subject',
              dependencies: [],
              provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
              child: {
                kind: 'word',
                id: 'body',
                role: 'primary-content',
                word: 'prose',
                bindings: {
                  value: {
                    kind: 'property',
                    subject: 'post:first-post',
                    path: 'properties.fields.body',
                  },
                },
                dependencies: [
                  {
                    kind: 'entity',
                    subject: 'post:first-post',
                    version: 'entity-v1',
                    paths: ['properties.fields.body'],
                  },
                  {
                    kind: 'catalog',
                    subject: 'urn:ui4a:presentation:semantic',
                    version: 'semantic-v1',
                  },
                ],
                provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
              },
            },
          ],
        },
      },
      dependencies: [],
      provenance: { kind: 'generic-fallback', ref: 'fixture' },
      changedPaths: [],
    },
  });
});

describe('Sidecar human lifecycle route', () => {
  it('applies direct semantic patches, explains provenance, and gates Recipe promotion', async () => {
    const patched = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:1',
          action: 'patch',
          actor: 'human',
          interactionId: 'canvas:collapse:1',
          operations: [{ kind: 'collapse', nodeId: 'root', collapsed: true }],
        }),
      }),
    );
    expect(patched.status).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({
      sidecar: {
        version: 2,
        view: { collapsedNodeIds: ['root'] },
      },
    });

    const explanation = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar%3A1&explain=1'),
    );
    await expect(explanation.json()).resolves.toMatchObject({
      explanation: {
        version: 2,
        provenance: { kind: 'human-patch', ref: 'canvas:collapse:1' },
      },
    });

    const preview = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:1',
          action: 'promotion-preview',
          actor: 'human',
        }),
      }),
    );
    await expect(preview.json()).resolves.toMatchObject({
      diff: { fromSidecarVersion: 2, parameterized: true },
    });

    const promoted = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:1',
          action: 'promote',
          actor: 'human',
        }),
      }),
    );
    expect(promoted.status).toBe(200);
    await expect(promoted.json()).resolves.toMatchObject({
      recipe: { status: 'promoted' },
    });
  });

  it('returns binding-only active state, pins as human, rejects agent, and reverts by pointer', async () => {
    const read = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar%3A1'),
    );
    await expect(read.json()).resolves.toMatchObject({
      sidecar: { id: 'sidecar:1', version: 1, retention: 'cache' },
    });

    const rejected = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({ sidecarId: 'sidecar:1', action: 'pin', actor: 'agent' }),
      }),
    );
    expect(rejected.status).toBe(400);

    const pinned = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({ sidecarId: 'sidecar:1', action: 'pin', actor: 'human' }),
      }),
    );
    await expect(pinned.json()).resolves.toMatchObject({
      sidecar: { version: 2, retention: 'pinned' },
    });

    const reverted = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:1',
          action: 'revert',
          targetVersion: 1,
          actor: 'human',
        }),
      }),
    );
    await expect(reverted.json()).resolves.toMatchObject({
      sidecar: { version: 1, retention: 'cache' },
    });
  });

  it('fails partial workspace promotion closed', async () => {
    const receipt = await getPresentationBroker().present(
      completePresentationRequest(
        { subject: 'workspace:my-work', intent: 'organize', delivery: 'canvas' },
        { requestId: 'workspace:partial', principal: 'user:local', sourceMessageIds: [] },
      ),
      { policyScope: 'publishing' },
    );
    expect(receipt).toMatchObject({ status: 'ready', reasonCode: 'partial-authorization' });
    const partial = (await loadPresentationSnapshot(getDb())).sidecars[receipt.sidecar!.id]!;
    await appendSidecarCommand(getDb(), {
      kind: 'instantiate',
      eventId: 'workspace:partial:local:event',
      commandId: 'workspace:partial:local',
      sidecarId: 'sidecar:workspace-partial-local',
      key: { ...partial.key, policyScope: 'local-demo' },
      version: partial.versions[partial.activeVersion]!,
    });

    const explanationResponse = await GET(
      new Request(
        'http://localhost/api/presentation/sidecar?sidecarId=sidecar%3Aworkspace-partial-local&explain=1',
      ),
    );
    expect(explanationResponse.status).toBe(200);
    const explanation = (await explanationResponse.json()) as {
      explanation: {
        composition?: {
          regions: Array<{ region: string; availability: string; diagnosticCode?: string }>;
        };
      };
    };
    expect(explanation.explanation.composition?.regions.map(({ region }) => region)).toEqual([
      'waiting-for-me',
      'in-motion',
      'work-lines',
    ]);
    const unavailable = explanation.explanation.composition?.regions.find(
      ({ availability }) => availability === 'unavailable',
    );
    expect(unavailable).toMatchObject({ diagnosticCode: 'region-unavailable' });
    const declaration = getBuiltinComposition('my-work')!;
    const deniedSource = declaration.regions.find(
      ({ region }) => region === unavailable?.region,
    )?.source;
    expect(deniedSource).toBeDefined();
    expect(JSON.stringify(explanation)).not.toContain(deniedSource!);
    expect(JSON.stringify(explanation)).not.toContain('policyScope');
    expect(JSON.stringify(explanation)).not.toContain('fingerprint');

    const response = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:workspace-partial-local',
          action: 'promotion-preview',
          actor: 'human',
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/partial workspace/i),
    });
    const promoted = await getDb().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM events
        WHERE domain = 'presentation'
          AND kind = 'render-recipe-promoted'
          AND detail->>'sidecarId' = $1`,
      ['sidecar:workspace-partial-local'],
    );
    expect(promoted.rows[0]?.count).toBe('0');
  });

  it('promotes a full workspace and instantiates its aggregate Recipe for a new user', async () => {
    const receipt = await getPresentationBroker().present(
      completePresentationRequest(
        { subject: 'workspace:my-work', intent: 'organize', delivery: 'canvas' },
        { requestId: 'workspace:full', principal: 'user:local', sourceMessageIds: [] },
      ),
    );
    const response = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: receipt.sidecar!.id,
          action: 'promotion-preview',
          actor: 'human',
        }),
      }),
    );

    const explanation = await GET(
      new Request(
        `http://localhost/api/presentation/sidecar?sidecarId=${encodeURIComponent(receipt.sidecar!.id)}&explain=1`,
      ),
    );
    await expect(explanation.json()).resolves.toMatchObject({
      explanation: {
        composition: {
          id: 'my-work',
          version: '1',
          regions: [
            { region: 'waiting-for-me', availability: 'available' },
            { region: 'in-motion', availability: 'available' },
            { region: 'work-lines', availability: 'available' },
          ],
          declarationProvenance: {
            kind: 'composition-declaration',
            ref: 'composition:my-work@1',
          },
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      diff: {
        subjectSlots: ['waiting-for-me', 'in-motion', 'work-lines'],
        parameterized: true,
      },
    });
    const promoted = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: receipt.sidecar!.id,
          action: 'promote',
          actor: 'human',
        }),
      }),
    );
    expect(promoted.status).toBe(200);
    resetPresentationBrokerForTests();
    resetRecipeCoordinatorForTests();

    const instantiated = await getPresentationBroker().present(
      completePresentationRequest(
        { subject: 'workspace:my-work', intent: 'organize', delivery: 'canvas' },
        { requestId: 'workspace:recipe-user', principal: 'user:other', sourceMessageIds: [] },
      ),
    );
    expect(instantiated).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    const stored = (await loadPresentationSnapshot(getDb())).sidecars[instantiated.sidecar!.id]!;
    expect(stored.versions[stored.activeVersion]!.provenance).toMatchObject({
      kind: 'application-recipe',
    });
    expect(JSON.stringify(stored.versions[stored.activeVersion]!.surface)).not.toContain('$slot:');
  });
});
