import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { POST as exec } from './exec/route';

const mocks = vi.hoisted(() => ({ resolveIdentity: vi.fn() }));

vi.mock('../../../auth/request-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth/request-identity')>();
  return {
    ...actual,
    resolveTrustedRequestIdentity: mocks.resolveIdentity,
  };
});

const pool = getPool(process.env.DATABASE_URL!);

const GRANTED_APPLICATIONS = ['publishing'];

// 生产 credential 分支的行为口径(D51):lens 只认显式 ?scope=/?policyScope=
// 查询参数,且仅在授予集合内透传;授予外的声明静默视为未声明。
function credentialIdentity(request: Request) {
  const declared =
    new URL(request.url).searchParams.get('scope') ??
    new URL(request.url).searchParams.get('policyScope') ??
    undefined;
  const policyScope =
    declared !== undefined && GRANTED_APPLICATIONS.includes(declared) ? declared : undefined;
  return {
    authorizationMode: 'credential' as const,
    actor: 'agent' as const,
    principal: 'agent:ui4a-cli',
    scopes: ['ui4a:write', 'ui4a:policy:publishing'],
    grantedApplications: GRANTED_APPLICATIONS,
    ...(policyScope === undefined ? {} : { policyScope }),
    channel: 'oidc' as const,
    humanApprovalEligible: false,
  };
}

function createRequest(scope: string | undefined, commandId: string): Request {
  const query = scope === undefined ? '' : `?scope=${scope}`;
  return new Request(`http://localhost:3100/_meta/api/exec${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer fixture' },
    body: JSON.stringify({
      rel: 'meta/drafts',
      action: 'create',
      params: {
        kind: 'flow-definition',
        target: 'post-status',
        commandId,
        payload: { name: 'post-status' },
      },
    }),
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  mocks.resolveIdentity.mockImplementation((request: Request) =>
    Promise.resolve(credentialIdentity(request)),
  );
});

describe('Draft meta exec under production credential identity (D65 CLI lens seam)', () => {
  it('rejects a credential Draft write whose request declares no application lens', async () => {
    const response = await exec(createRequest(undefined, 'lens:credential:missing'));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      layer: 'schema-invalid',
      reason: expect.stringContaining('explicit authorized application lens'),
    });
  });

  it('accepts a credential Draft write declaring a granted lens and locks the draft to it', async () => {
    const response = await exec(createRequest('publishing', 'lens:credential:granted'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entity: { properties: { rel: string; provenance: { commandId: string } } };
    };
    expect(body.entity.properties.rel).toMatch(/^draft:/);
    expect(body.entity.properties.provenance.commandId).toBe('lens:credential:granted');
  });

  it('treats an out-of-grant lens declaration as undeclared, not as authorization', async () => {
    const response = await exec(createRequest('development', 'lens:credential:ungranted'));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      layer: 'schema-invalid',
      reason: expect.stringContaining('explicit authorized application lens'),
    });
  });
});
