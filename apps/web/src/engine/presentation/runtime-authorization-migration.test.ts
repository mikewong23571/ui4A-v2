import { beforeEach, describe, expect, it, vi } from 'vitest';

import { completePresentationRequest } from '@ui4a/shared';

const authorization = vi.hoisted(() => ({
  visible: new Map<string, unknown>(),
  getEntity: vi.fn(async (rel: string) => authorization.visible.get(rel)),
  // B1 分类器桩:可见性之外的归因统一记为授予外(map 装置无法区分不存在)。
  getAuthorizedPresentationResult: vi.fn(
    async (rel: string): Promise<{ kind: string; entity?: unknown }> =>
      authorization.visible.has(rel)
        ? { kind: 'authorized', entity: authorization.visible.get(rel) }
        : { kind: 'audience-unreachable' },
  ),
}));

vi.mock('./authorized-entity', () => ({
  getAuthorizedPresentationEntity: authorization.getEntity,
  getAuthorizedPresentationResult: authorization.getAuthorizedPresentationResult,
}));

import { ensurePresentationTables, findActiveSidecar } from '../../db/presentation';
import { listEvents } from '../../db/events';
import { getDb, getEngine, resetEngineForTests } from '../service';
import { resetRecipeCoordinatorForTests } from './recipes-runtime';
import { getPresentationBroker, resetPresentationBrokerForTests } from './runtime';

const key = {
  principal: 'user:local',
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
    const first = await getPresentationBroker().present(request('migration:partial'));
    const partial = await findActiveSidecar(getDb(), key);
    expect(first).toMatchObject({ status: 'ready', reasonCode: 'partial-authorization' });
    expect(JSON.stringify(partial?.versions[1]?.surface)).not.toContain('inbox');
    expect(JSON.stringify(partial?.versions[1]?.surface)).not.toContain('delegations');

    await setVisible('inbox', 'delegations', 'threads');
    const second = await getPresentationBroker().present(request('migration:full'));
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
    const first = await getPresentationBroker().present(request('migration:full-first'));
    expect(first).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    expect(first).not.toHaveProperty('reasonCode');

    await setVisible('threads');
    const second = await getPresentationBroker().present(request('migration:partial-second'));
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

  it('fails all-denied authorization with a structured denial and without Sidecar lifecycle events', async () => {
    const receipt = await getPresentationBroker().present(request('migration:all-denied'));

    // B1 taxonomy:全区域授予外 → audience-unreachable(不再压缩为 authorization-failed)。
    expect(receipt).toMatchObject({ status: 'failed', reasonCode: 'audience-unreachable' });
    await expect(findActiveSidecar(getDb(), key)).resolves.toBeUndefined();
    expect(sidecarKinds(await listEvents(getDb()))).toEqual([]);
  });
});
