import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendSidecarCommand, ensurePresentationTables } from '../../../../db/presentation';
import { getDb, resetEngineForTests } from '../../../../engine/service';

const mocks = vi.hoisted(() => ({
  policyScope: 'default',
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
  mocks.resolveTrustedRequestIdentity.mockReset().mockImplementation(async () => ({
    authorizationMode: 'credential',
    actor: 'human',
    principal: 'human-alice',
    scopes: ['ui4a:read', 'ui4a:write', `ui4a:policy:${mocks.policyScope}`],
    policyScope: mocks.policyScope,
    channel: 'http',
    humanApprovalEligible: true,
  }));
});

describe('Sidecar production scope and source reauthorization', () => {
  it('does not disclose a same-principal Sidecar from another trusted policy scope', async () => {
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
