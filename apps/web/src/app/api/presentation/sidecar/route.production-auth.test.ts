import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendSidecarCommand, ensurePresentationTables } from '@ui4a/db/presentation';
import { getDb, resetEngineForTests } from '../../../../engine/service';

const mocks = vi.hoisted(() => ({
  grantedApplications: ['publishing'] as string[],
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('../../../../auth/request-identity', () => ({
  requestIdentityProfile: () => 'production',
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
  authenticationErrorResponse: () => undefined,
}));

import { GET, POST } from './route';

// D51:durable key 无 scope 维度(seed 只落 principal/subject/intent/device);
// 命中重审 = principal 相等 + 全部真实 sources 在当前授予集合下可达。
async function seedSidecar(id: string, principal = 'human-alice'): Promise<void> {
  await appendSidecarCommand(getDb(), {
    kind: 'instantiate',
    eventId: `${id}:event`,
    commandId: `${id}:command`,
    sidecarId: id,
    key: {
      principal,
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
          children: [],
        },
      },
      dependencies: [
        {
          id: 'entity:post:first-post',
          subtreeId: 'root',
          kind: 'entity-contract',
          ref: 'post:first-post',
          pointers: ['$contract'],
          mode: 'invalidate',
          fingerprint: 'fixture',
          optional: false,
        },
      ],
      provenance: { kind: 'generic-fallback', ref: 'fixture' },
      changedPaths: [],
    },
  });
}

beforeEach(async () => {
  await ensurePresentationTables(getDb());
  await getDb().query('TRUNCATE events, presentation_user_sidecars');
  resetEngineForTests();
  mocks.grantedApplications = ['publishing'];
  mocks.resolveTrustedRequestIdentity.mockReset().mockImplementation(async () => ({
    authorizationMode: 'credential',
    actor: 'human',
    principal: 'human-alice',
    scopes: [
      'ui4a:read',
      'ui4a:write',
      ...mocks.grantedApplications.map((application) => `ui4a:policy:${application}`),
    ],
    grantedApplications: [...mocks.grantedApplications],
    channel: 'http',
    humanApprovalEligible: true,
  }));
});

describe('Sidecar production grant-set source reauthorization (D51)', () => {
  it('discloses a same-principal Sidecar when its sources stay reachable within the grants', async () => {
    await seedSidecar('sidecar:mine');

    const response = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar%3Amine'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sidecar: {
        id: 'sidecar:mine',
        version: 1,
        key: { principal: 'human-alice', subject: 'post:first-post' },
      },
    });

    const pinned = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:mine',
          action: 'pin',
          actor: 'human',
        }),
      }),
    );
    expect(pinned.status).toBe(200);
    await expect(pinned.json()).resolves.toMatchObject({
      sidecar: { version: 2, retention: 'pinned' },
    });
  });

  it('answers a same-principal Sidecar whose sources left the grant envelope with structured 403 denied', async () => {
    // D51 §2.3:本人工件重审失败 = 结构化 denied(不再伪装成 Not Found)。
    await seedSidecar('sidecar:ungranted');
    mocks.grantedApplications = ['community'];

    const response = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar%3Aungranted'),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'sidecar-denied', detail: 'grants-shrunk' } });
    // body 只携带 reasonCode 归因:零 granted 集合内容、零 surface/依赖泄露。
    expect(JSON.stringify(body)).not.toMatch(/surface|dependencies|post:first-post/);
    expect(JSON.stringify(body)).not.toContain('community');
  });

  it('keeps 404 existence hiding for another principal stored Sidecar id (invariant #3)', async () => {
    await seedSidecar('sidecar:bobs', 'human-bob');

    const response = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar%3Abobs'),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sidecar not found' });
  });

  it('performs no lifecycle mutation when POST source reauthorization fails', async () => {
    await seedSidecar('sidecar:no-mutation');
    mocks.grantedApplications = ['community'];
    const before = await getDb().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM events WHERE domain='presentation'`,
    );

    const response = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:no-mutation',
          action: 'pin',
          actor: 'human',
        }),
      }),
    );
    const after = await getDb().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM events WHERE domain='presentation'`,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'sidecar-denied', detail: 'grants-shrunk' },
    });
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
