import { beforeEach, describe, expect, it, vi } from 'vitest';

import { completePresentationRequest } from '@ui4a/shared';

const authorization = vi.hoisted(() => ({
  visible: new Map<string, unknown>(),
  getEntity: vi.fn(async (rel: string) => authorization.visible.get(rel)),
}));

vi.mock('./authorized-entity', () => ({
  getAuthorizedPresentationEntity: authorization.getEntity,
}));

import { ensurePresentationTables, findActiveSidecar } from '../../db/presentation';
import { listEvents } from '../../db/events';
import { getDb, getEngine, resetEngineForTests } from '../service';
import { resetRecipeCoordinatorForTests } from './recipes-runtime';
import { getPresentationBroker, resetPresentationBrokerForTests } from './runtime';

const key = {
  principal: 'local-user',
  policyScope: 'trusted-scope',
  subject: 'workspace:my-work',
  intent: 'authorization migration',
  deviceClass: 'any' as const,
};

function request(requestId: string) {
  return completePresentationRequest(
    { subject: key.subject, intent: key.intent, delivery: 'canvas' },
    { requestId, principal: key.principal, sourceMessageIds: [] },
  );
}

async function setVisible(...rels: string[]): Promise<void> {
  const engine = await getEngine(getDb());
  authorization.visible.clear();
  for (const rel of rels) authorization.visible.set(rel, await engine.getEntity(rel));
}

function sidecarKinds(events: Awaited<ReturnType<typeof listEvents>>): string[] {
  return events
    .filter(({ domain, kind }) => domain === 'presentation' && kind.startsWith('user-sidecar-'))
    .map(({ kind }) => kind);
}

beforeEach(async () => {
  await ensurePresentationTables(getDb());
  await getDb().query('TRUNCATE events, presentation_user_sidecars');
  resetEngineForTests();
  resetPresentationBrokerForTests();
  resetRecipeCoordinatorForTests();
  authorization.visible.clear();
  authorization.getEntity.mockClear();
});

describe('durable composition authorization migration', () => {
  it('stales and revises the same Sidecar from partial to full visibility', async () => {
    await setVisible('threads');
    const first = await getPresentationBroker().present(request('migration:partial'), {
      policyScope: key.policyScope,
    });
    const partial = await findActiveSidecar(getDb(), key);
    expect(first).toMatchObject({ status: 'ready', reasonCode: 'partial-authorization' });
    expect(JSON.stringify(partial?.versions[1]?.surface)).not.toContain('inbox');
    expect(JSON.stringify(partial?.versions[1]?.surface)).not.toContain('delegations');

    await setVisible('inbox', 'delegations', 'threads');
    const second = await getPresentationBroker().present(request('migration:full'), {
      policyScope: key.policyScope,
    });
    const full = await findActiveSidecar(getDb(), key);

    expect(second).toMatchObject({
      status: 'ready',
      sidecar: { id: first.sidecar!.id, version: 2 },
    });
    expect(second).not.toHaveProperty('reasonCode');
    expect(full?.activeVersion).toBe(2);
    expect(
      full?.versions[2]?.dependencies.filter(({ kind }) => kind === 'entity-contract'),
    ).toHaveLength(3);
    expect(sidecarKinds(await listEvents(getDb()))).toEqual([
      'user-sidecar-instantiated',
      'user-sidecar-staled',
      'user-sidecar-revised',
    ]);
  });

  it('stales and revises the same Sidecar from full to partial visibility', async () => {
    await setVisible('inbox', 'delegations', 'threads');
    const first = await getPresentationBroker().present(request('migration:full-first'), {
      policyScope: key.policyScope,
    });
    expect(first).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    expect(first).not.toHaveProperty('reasonCode');

    await setVisible('threads');
    const second = await getPresentationBroker().present(request('migration:partial-second'), {
      policyScope: key.policyScope,
    });
    const partial = await findActiveSidecar(getDb(), key);

    expect(second).toMatchObject({
      status: 'ready',
      reasonCode: 'partial-authorization',
      sidecar: { id: first.sidecar!.id, version: 2 },
    });
    expect(
      partial?.versions[2]?.dependencies.filter(({ kind }) => kind === 'entity-contract'),
    ).toHaveLength(1);
    expect(JSON.stringify(partial?.versions[2]?.surface)).not.toContain('inbox');
    expect(JSON.stringify(partial?.versions[2]?.surface)).not.toContain('delegations');
    expect(sidecarKinds(await listEvents(getDb()))).toEqual([
      'user-sidecar-instantiated',
      'user-sidecar-staled',
      'user-sidecar-revised',
    ]);
  });

  it('fails all-denied authorization without creating Sidecar lifecycle events', async () => {
    const receipt = await getPresentationBroker().present(request('migration:all-denied'), {
      policyScope: key.policyScope,
    });

    expect(receipt).toMatchObject({ status: 'failed', reasonCode: 'authorization-failed' });
    await expect(findActiveSidecar(getDb(), key)).resolves.toBeUndefined();
    expect(sidecarKinds(await listEvents(getDb()))).toEqual([]);
  });
});
