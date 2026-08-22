import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion } from '@ui4a/engine';
import { completePresentationRequest } from '@ui4a/shared';

import {
  appendSidecarCommand,
  ensurePresentationTables,
  findActiveSidecar,
} from '../../db/presentation';
import { appendEvent, listEvents } from '../../db/events';
import { getDb, getEngine, resetEngineForTests } from '../service';
import { getPresentationBroker, resetPresentationBrokerForTests } from './runtime';
import { resetRecipeCoordinatorForTests } from './recipes-runtime';
import { PRESENTATION_SURFACE_CATALOG } from './catalog';

beforeEach(async () => {
  await ensurePresentationTables(getDb());
  await getDb().query('TRUNCATE events, presentation_user_sidecars');
  resetEngineForTests();
  resetPresentationBrokerForTests();
  resetRecipeCoordinatorForTests();
});

describe('durable user Sidecar fastpath', () => {
  it('returns the same Sidecar across independent Chat requests and leaves Business hash unchanged', async () => {
    const engine = await getEngine(getDb());
    const beforeHash = contentVersion(engine.getSnapshot());
    const intent = { subject: 'post:first-post', intent: 'read', delivery: 'canvas' } as const;
    const started = performance.now();
    const first = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'chat-a:1',
        principal: 'user:local',
        sourceMessageIds: ['message:a'],
      }),
    );
    const firstUsableMs = performance.now() - started;
    const second = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'chat-b:1',
        principal: 'user:local',
        sourceMessageIds: ['message:b'],
      }),
    );

    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    expect(second.sidecar).toEqual(first.sidecar);
    expect(firstUsableMs).toBeLessThan(500);
    expect(second.surfaceUrl).toContain(`sidecar=${encodeURIComponent(first.sidecar!.id)}`);
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'user:local',
        policyScope: 'local-demo',
        subject: 'post:first-post',
        intent: 'read',
        deviceClass: 'any',
      }),
    ).resolves.toMatchObject({ id: first.sidecar!.id, activeVersion: first.sidecar!.version });
    expect(contentVersion((await getEngine(getDb())).getSnapshot())).toBe(beforeHash);
    const presentationKinds = (await listEvents(getDb()))
      .filter(({ domain }) => domain === 'presentation')
      .map(({ kind }) => kind);
    expect(presentationKinds).toEqual(
      expect.arrayContaining([
        'presentation-requested',
        'presentation-resolved',
        'user-sidecar-instantiated',
      ]),
    );
  });

  it('fails a corrupt Sidecar closed, records it stale, and repairs with generic binding-only output', async () => {
    const intent = { subject: 'post:first-post', intent: 'read', delivery: 'canvas' } as const;
    const first = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'corrupt:seed',
        principal: 'user:local',
        sourceMessageIds: [],
      }),
    );
    expect(first.status).toBe('ready');
    const active = await findActiveSidecar(getDb(), {
      principal: 'user:local',
      policyScope: 'local-demo',
      subject: 'post:first-post',
      intent: 'read',
      deviceClass: 'any',
    });
    await appendSidecarCommand(getDb(), {
      kind: 'revise',
      eventId: 'corrupt:event',
      commandId: 'corrupt:command',
      sidecarId: active!.id,
      baseVersion: active!.activeVersion,
      version: {
        surface: {
          schemaVersion: 1,
          root: {
            kind: 'word',
            id: 'bad',
            role: 'primary-content',
            word: 'missing-word',
            bindings: {},
            dependencies: [],
            provenance: [{ kind: 'human-patch', ref: 'corrupt-fixture' }],
          },
        },
        dependencies: active!.versions[active!.activeVersion]!.dependencies,
        provenance: { kind: 'human-patch', ref: 'corrupt-fixture' },
        changedPaths: ['/surface'],
      },
    });

    const repaired = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'corrupt:repair',
        principal: 'user:local',
        sourceMessageIds: [],
      }),
    );
    expect(repaired).toMatchObject({ status: 'ready', sidecar: { id: active!.id, version: 3 } });
    const kinds = (await listEvents(getDb()))
      .filter(({ domain }) => domain === 'presentation')
      .map(({ kind }) => kind);
    expect(kinds).toEqual(expect.arrayContaining(['user-sidecar-staled', 'user-sidecar-revised']));
  });

  it('replays a human-promoted Recipe after restart and instantiates it before generic planning', async () => {
    const candidate = {
      key: {
        application: 'runtime',
        applicationVersion: '1',
        scenario: 'human-promoted',
        subjectShape: 'entity',
        intent: 'review',
        catalogVersion: PRESENTATION_SURFACE_CATALOG.version,
      },
      slots: [{ name: 'subject', kind: 'entity' as const }],
      surfaceTemplate: {
        schemaVersion: 1 as const,
        root: {
          kind: 'word' as const,
          id: 'identity',
          role: 'identity' as const,
          word: 'heading',
          bindings: {
            value: {
              kind: 'property' as const,
              subject: '$slot:subject',
              path: 'properties.fields.title',
            },
          },
          dependencies: [
            {
              kind: 'entity' as const,
              subject: '$slot:subject',
              version: '$runtime',
              paths: ['properties.fields.title'],
            },
            {
              kind: 'catalog' as const,
              subject: PRESENTATION_SURFACE_CATALOG.id,
              version: PRESENTATION_SURFACE_CATALOG.version,
            },
          ],
          provenance: [{ kind: 'human-patch' as const, ref: 'sidecar:source' }],
        },
      },
      dependencies: [
        {
          kind: 'catalog' as const,
          subject: PRESENTATION_SURFACE_CATALOG.id,
          version: PRESENTATION_SURFACE_CATALOG.version,
        },
      ],
      provenance: { model: 'human-promotion', generatedAt: 'human-approved-candidate' },
    };
    await appendEvent(getDb(), {
      domain: 'presentation',
      kind: 'render-recipe-promoted',
      rel: 'recipe:durable',
      principal: 'user:local',
      channel: 'presentation',
      detail: {
        eventId: 'promotion:event',
        commandId: 'promotion:command',
        candidate,
      },
    });

    const receipt = await getPresentationBroker().present(
      completePresentationRequest(
        { subject: 'post:first-post', intent: 'review', delivery: 'canvas' },
        { requestId: 'recipe:request', principal: 'user:local', sourceMessageIds: [] },
      ),
    );
    expect(receipt).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'user:local',
        policyScope: 'local-demo',
        subject: 'post:first-post',
        intent: 'review',
        deviceClass: 'any',
      }),
    ).resolves.toMatchObject({
      versions: {
        1: {
          provenance: { kind: 'application-recipe' },
          surface: {
            root: { bindings: { value: { subject: 'post:first-post' } } },
          },
        },
      },
    });
  });
});
