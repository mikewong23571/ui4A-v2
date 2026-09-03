import { beforeEach, describe, expect, it } from 'vitest';

import type { DraftCommand } from '@ui4a/engine';
import type { DraftAggregate, DraftValidation } from '@ui4a/shared';

import {
  acceptDraftWithCoreEvent,
  appendDraftCommand,
  ensureDraftTables,
  getDraft,
  listDrafts,
  payloadSha256,
  rebuildDraftProjection,
} from './drafts';
import { ensureEventsTable } from '../events';
import { getPool } from '../pool';

// T48 Phase 1 / T1.1:证明 Draft 持久层对 draftKind='application-bundle' 全生命周期可用。
// 持久层本身 kind 无关(kind 以 TEXT 存储并透传纯引擎判定);本套件固定该 kind 与
// schemaRef 走 create → revise → validate → submit → accept/reject,断言投影重建、
// payload SHA 完整性与重放幂等。真实 bundle 校验属于 apps/web 侧(下一任务)。
const pool = getPool(process.env.DATABASE_URL!);

const OWNER = 'user:mike';
const SCOPE = 'default';
const SCHEMA_REF = 'ui4a://application-bundle/v1';
const INVALID: DraftValidation = {
  valid: false,
  issues: [{ code: 'schema', path: '/flows', message: 'bundle flows are missing declarations' }],
};
const VALID: DraftValidation = { valid: true, issues: [], validatedAgainst: SCHEMA_REF };

interface ProjectionRow {
  draft_id: string;
  kind: string;
  target: string | null;
  status: string;
  active_version: number;
  max_version: number;
  payload_hash: string;
  aggregate: DraftAggregate;
}

function provenance(commandId: string) {
  return { actor: 'agent' as const, principal: OWNER, commandId, sources: ['bundle:seed-1'] };
}

function createBundleCommand(draftId: string, payload: unknown, validation: DraftValidation) {
  return {
    kind: 'create' as const,
    eventId: `event:create:${draftId}`,
    commandId: `create:${draftId}`,
    draftId,
    owner: OWNER,
    policyScope: SCOPE,
    draftKind: 'application-bundle' as const,
    target: 'demo-bundle',
    payloadHash: payloadSha256(payload),
    schemaRef: SCHEMA_REF,
    provenance: provenance(`create:${draftId}`),
    validation,
  } satisfies DraftCommand;
}

function reviseCommand(draftId: string, baseVersion: number, payload: unknown) {
  return {
    kind: 'revise' as const,
    eventId: `event:revise:${draftId}`,
    commandId: `revise:${draftId}`,
    draftId,
    baseVersion,
    payloadHash: payloadSha256(payload),
    schemaRef: SCHEMA_REF,
    provenance: provenance(`revise:${draftId}`),
    validation: INVALID,
  } satisfies DraftCommand;
}

function validateCommand(draftId: string, activeVersion: number, validation: DraftValidation) {
  return {
    kind: 'validate' as const,
    eventId: `event:validate:${draftId}`,
    commandId: `validate:${draftId}`,
    draftId,
    activeVersion,
    validation,
  } satisfies DraftCommand;
}

function submitCommand(draftId: string, activeVersion: number) {
  return {
    kind: 'submit' as const,
    eventId: `event:submit:${draftId}`,
    commandId: `submit:${draftId}`,
    draftId,
    activeVersion,
    activation: `meta/activation:draft-${draftId}`,
  } satisfies DraftCommand;
}

function acceptCommand(draftId: string, activeVersion: number) {
  return {
    kind: 'accept' as const,
    eventId: `event:accept:${draftId}`,
    commandId: `accept:${draftId}`,
    draftId,
    activeVersion,
  } satisfies DraftCommand;
}

function rejectCommand(draftId: string, activeVersion: number, reason: string) {
  return {
    kind: 'reject' as const,
    eventId: `event:reject:${draftId}`,
    commandId: `reject:${draftId}`,
    draftId,
    activeVersion,
    reason,
  } satisfies DraftCommand;
}

async function projectionRow(draftId: string): Promise<ProjectionRow> {
  const result = await pool.query<ProjectionRow>(
    `SELECT draft_id,kind,target,status,active_version,max_version,payload_hash,aggregate
     FROM draft_projection WHERE draft_id=$1`,
    [draftId],
  );
  return result.rows[0]!;
}

async function storedPayload(hash: string): Promise<unknown> {
  const result = await pool.query<{ payload: unknown }>(
    'SELECT payload FROM draft_payloads WHERE payload_hash=$1',
    [hash],
  );
  return result.rows[0]?.payload;
}

/** 激活即播种:accept 回调产出的最小 application-seeded 核心事件计划(统一数组合同)。 */
function seedCorePlan(aggregate: DraftAggregate, payload: unknown) {
  return {
    events: [
      {
        domain: 'core' as const,
        kind: 'application-seeded' as const,
        rel: `meta/application:${aggregate.target}`,
        actor: 'human' as const,
        principal: OWNER,
        channel: 'meta',
        detail: { name: aggregate.target, definition: payload },
      },
    ],
  };
}

async function driveAcceptedDraft(draftId: string): Promise<void> {
  const v1 = { name: 'demo-bundle', title: 'Demo', flows: [] };
  const v2 = { name: 'demo-bundle', title: 'Demo', flows: [], resources: [] };
  await appendDraftCommand(pool, createBundleCommand(draftId, v1, INVALID), v1);
  await appendDraftCommand(pool, reviseCommand(draftId, 1, v2), v2);
  await appendDraftCommand(pool, validateCommand(draftId, 2, VALID));
  await appendDraftCommand(pool, submitCommand(draftId, 2));
  await acceptDraftWithCoreEvent(pool, acceptCommand(draftId, 2), async ({ aggregate, payload }) =>
    seedCorePlan(aggregate, payload),
  );
}

async function driveRejectedDraft(draftId: string): Promise<void> {
  const payload = { name: 'demo-bundle', title: 'Demo', flows: [], resources: ['draft'] };
  await appendDraftCommand(pool, createBundleCommand(draftId, payload, VALID), payload);
  await appendDraftCommand(pool, submitCommand(draftId, 1));
  await appendDraftCommand(
    pool,
    rejectCommand(draftId, 1, 'bundle missing capability declarations'),
  );
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
});

describe('Draft persistence (application-bundle)', () => {
  it('supports create → revise → validate → submit → accept with projection and payload SHA integrity', async () => {
    const v1 = { name: 'demo-bundle', title: 'Demo', flows: [] };
    const v2 = { name: 'demo-bundle', title: 'Demo', flows: [], resources: [] };

    const created = await appendDraftCommand(
      pool,
      createBundleCommand('bundle-accept', v1, INVALID),
      v1,
    );
    expect(created.aggregate.kind).toBe('application-bundle');
    expect(created.aggregate.status).toBe('invalid');
    expect(created.aggregate.versions[1]?.schemaRef).toBe(SCHEMA_REF);
    await expect(projectionRow('bundle-accept')).resolves.toMatchObject({
      kind: 'application-bundle',
      target: 'demo-bundle',
      status: 'invalid',
      active_version: 1,
      max_version: 1,
      payload_hash: payloadSha256(v1),
    });
    expect(payloadSha256(await storedPayload(payloadSha256(v1)))).toBe(payloadSha256(v1));
    expect(await storedPayload(payloadSha256(v1))).toEqual(v1);

    const revised = await appendDraftCommand(pool, reviseCommand('bundle-accept', 1, v2), v2);
    expect(revised.aggregate.activeVersion).toBe(2);
    expect(revised.aggregate.maxVersion).toBe(2);
    expect(revised.aggregate.status).toBe('invalid');
    expect(revised.aggregate.versions[2]?.basedOnVersion).toBe(1);

    const validated = await appendDraftCommand(pool, validateCommand('bundle-accept', 2, VALID));
    expect(validated.aggregate.status).toBe('ready');
    expect(validated.aggregate.versions[2]?.validation.valid).toBe(true);
    expect(validated.aggregate.versions[2]?.validation.validatedAgainst).toBe(SCHEMA_REF);

    const submitted = await appendDraftCommand(pool, submitCommand('bundle-accept', 2));
    expect(submitted.aggregate.status).toBe('pending-approval');
    expect(submitted.aggregate.activation).toBe('meta/activation:draft-bundle-accept');

    const accepted = await acceptDraftWithCoreEvent(
      pool,
      acceptCommand('bundle-accept', 2),
      async ({ aggregate, payload }) => seedCorePlan(aggregate, payload),
    );
    expect(accepted.aggregate.status).toBe('accepted');
    expect(accepted.coreSeq).toBeDefined();
    expect(accepted.draftSeq).toBeGreaterThan(accepted.coreSeq!);
    await expect(projectionRow('bundle-accept')).resolves.toMatchObject({
      kind: 'application-bundle',
      target: 'demo-bundle',
      status: 'accepted',
      active_version: 2,
      max_version: 2,
      payload_hash: payloadSha256(v2),
    });

    const kinds = await pool.query<{ kind: string }>(
      `SELECT kind FROM events WHERE domain='draft' ORDER BY seq ASC`,
    );
    expect(kinds.rows.map((row) => row.kind)).toEqual([
      'draft-created',
      'draft-revised',
      'draft-validated',
      'draft-submitted',
      'draft-accepted',
    ]);
    const core = await pool.query<{ kind: string; rel: string }>(
      `SELECT kind, rel FROM events WHERE domain='core' AND kind='application-seeded'`,
    );
    expect(core.rows).toEqual([
      { kind: 'application-seeded', rel: 'meta/application:demo-bundle' },
    ]);
  });

  it('rejects a submitted application-bundle draft terminally with a reason', async () => {
    await driveRejectedDraft('bundle-reject');
    const rejected = await getDraft(pool, 'bundle-reject', OWNER, SCOPE);
    expect(rejected?.aggregate).toMatchObject({
      kind: 'application-bundle',
      status: 'rejected',
      terminalReason: 'bundle missing capability declarations',
      activeVersion: 1,
    });
    await expect(projectionRow('bundle-reject')).resolves.toMatchObject({
      kind: 'application-bundle',
      status: 'rejected',
      active_version: 1,
    });
    await expect(
      appendDraftCommand(pool, {
        kind: 'abandon',
        eventId: 'event:abandon:bundle-reject',
        commandId: 'abandon:bundle-reject',
        draftId: 'bundle-reject',
        activeVersion: 1,
      }),
    ).rejects.toThrow('terminal');
  });

  it('rebuilds the projection from draft events idempotently without touching payloads', async () => {
    await driveAcceptedDraft('bundle-a');
    await driveRejectedDraft('bundle-b');
    const byId = (a: DraftAggregate, b: DraftAggregate) => a.id.localeCompare(b.id);
    const before = (await listDrafts(pool, { owner: OWNER, policyScope: SCOPE })).sort(byId);
    expect(before.map((draft) => [draft.id, draft.kind, draft.status])).toEqual([
      ['bundle-a', 'application-bundle', 'accepted'],
      ['bundle-b', 'application-bundle', 'rejected'],
    ]);

    await pool.query('TRUNCATE draft_projection');
    expect(await listDrafts(pool, { owner: OWNER, policyScope: SCOPE })).toEqual([]);

    await rebuildDraftProjection(pool);
    const once = (await listDrafts(pool, { owner: OWNER, policyScope: SCOPE })).sort(byId);
    expect(once).toEqual(before);

    await rebuildDraftProjection(pool);
    const twice = (await listDrafts(pool, { owner: OWNER, policyScope: SCOPE })).sort(byId);
    expect(twice).toEqual(before);

    expect(
      await pool.query<{ count: string }>('SELECT count(*) AS count FROM draft_projection'),
    ).toMatchObject({ rows: [{ count: '2' }] });
    for (const draft of twice) {
      const found = await getDraft(pool, draft.id, OWNER, SCOPE);
      expect(found).toBeDefined();
      expect(payloadSha256(found!.payload)).toBe(draft.versions[draft.activeVersion]?.payloadHash);
    }
  });
});
