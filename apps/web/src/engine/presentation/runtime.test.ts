import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion } from '@ui4a/engine';
import { completePresentationRequest } from '@ui4a/shared';

import {
  appendSidecarCommand,
  ensurePresentationTables,
  findActiveSidecar,
} from '../../db/presentation';
import { listEvents } from '../../db/events';
import { getDb, getEngine, resetEngineForTests } from '../service';
import { getPresentationBroker, resetPresentationBrokerForTests } from './runtime';

beforeEach(async () => {
  await ensurePresentationTables(getDb());
  await getDb().query('TRUNCATE events, presentation_user_sidecars');
  resetEngineForTests();
  resetPresentationBrokerForTests();
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
});
