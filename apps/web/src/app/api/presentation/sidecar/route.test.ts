import { beforeEach, describe, expect, it } from 'vitest';

import {
  appendSidecarCommand,
  ensurePresentationTables,
  loadPresentationSnapshot,
} from '../../../../db/presentation';
import { getDb } from '../../../../engine/service';
import { GET, POST } from './route';

beforeEach(async () => {
  await ensurePresentationTables(getDb());
  await getDb().query('TRUNCATE events, presentation_user_sidecars');
  await appendSidecarCommand(getDb(), {
    kind: 'instantiate',
    eventId: 'e1',
    commandId: 'c1',
    sidecarId: 'sidecar:1',
    key: {
      principal: 'user:local',
      policyScope: 'local-demo',
      subject: 'post:first',
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

  it('fails workspace promotion closed until a complete ordered region slot map is available', async () => {
    const snapshot = await loadPresentationSnapshot(getDb());
    const source = snapshot.sidecars['sidecar:1']!;
    await appendSidecarCommand(getDb(), {
      kind: 'instantiate',
      eventId: 'workspace:e1',
      commandId: 'workspace:c1',
      sidecarId: 'sidecar:workspace',
      key: {
        ...source.key,
        subject: 'workspace:my-work',
        intent: 'organize',
      },
      version: source.versions[source.activeVersion]!,
    });

    const response = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:workspace',
          action: 'promotion-preview',
          actor: 'human',
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/complete ordered slot map/i),
    });
  });
});
