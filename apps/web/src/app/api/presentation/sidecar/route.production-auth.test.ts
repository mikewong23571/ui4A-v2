import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendSidecarCommand, ensurePresentationTables } from '../../../../db/presentation';
import { getDb, resetEngineForTests } from '../../../../engine/service';

const mocks = vi.hoisted(() => ({
  policyScope: 'default',
  extraScopes: [] as string[],
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('../../../../auth/request-identity', () => ({
  requestIdentityProfile: () => 'production',
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
  authenticationErrorResponse: () => undefined,
}));

import { GET, POST } from './route';

async function seedSidecar(id: string, policyScope: string): Promise<void> {
  await appendSidecarCommand(getDb(), {
    kind: 'instantiate',
    eventId: `${id}:event`,
    commandId: `${id}:command`,
    sidecarId: id,
    key: {
      principal: 'human-alice',
      policyScope,
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
  mocks.policyScope = 'default';
  mocks.extraScopes = [];
  mocks.resolveTrustedRequestIdentity.mockReset().mockImplementation(async () => ({
    authorizationMode: 'credential',
    actor: 'human',
    principal: 'human-alice',
    scopes: ['ui4a:read', 'ui4a:write', `ui4a:policy:${mocks.policyScope}`, ...mocks.extraScopes],
    policyScope: mocks.policyScope,
    channel: 'http',
    humanApprovalEligible: true,
  }));
});

describe('Sidecar production scope and source reauthorization', () => {
  it('does not disclose a same-principal Sidecar whose stored scope is not granted', async () => {
    // 安全边界:stored key 的 scope 必须落在当前身份 granted 集合内,否则 404。
    await seedSidecar('sidecar:scope', 'default');
    mocks.policyScope = 'development';

    const response = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar%3Ascope'),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: 'Sidecar not found' });
    expect(JSON.stringify(body)).not.toMatch(/surface|dependencies|post:first-post/);
  });

  it('discloses a same-principal Sidecar whose stored scope is granted but differs from the frozen default', async () => {
    // 多 scope 用户(granted=[default, publishing])的 publishing-scope sidecar
    // 不再因身份解析冻结 policyScope='default' 而误 404;pin 等生命周期同步放行。
    await seedSidecar('sidecar:granted-cross-scope', 'publishing');
    mocks.policyScope = 'default';
    mocks.extraScopes = ['ui4a:policy:publishing'];

    const response = await GET(
      new Request(
        'http://localhost/api/presentation/sidecar?sidecarId=sidecar%3Agranted-cross-scope',
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sidecar: {
        id: 'sidecar:granted-cross-scope',
        version: 1,
        key: { policyScope: 'publishing' },
      },
    });

    const pinned = await POST(
      new Request('http://localhost/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({
          sidecarId: 'sidecar:granted-cross-scope',
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

  it('fails GET closed without leaking a stored source after source authorization is unavailable', async () => {
    await seedSidecar('sidecar:revoked', 'development');
    mocks.policyScope = 'development';

    const response = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar%3Arevoked'),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: 'Sidecar not found' });
    expect(JSON.stringify(body)).not.toMatch(/surface|dependencies|post:first-post/);
  });

  it('performs no lifecycle mutation when POST source reauthorization fails', async () => {
    await seedSidecar('sidecar:no-mutation', 'development');
    mocks.policyScope = 'development';
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

    expect(response.status).toBe(404);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
