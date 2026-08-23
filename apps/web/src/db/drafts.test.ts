import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold, type DraftCommand } from '@ui4a/engine';

import {
  appendDraftCommand,
  ensureDraftTables,
  getDraft,
  listDrafts,
  payloadSha256,
  rebuildDraftProjection,
} from './drafts';
import { ensureEventsTable, readLog } from './events';
import { getPool } from './pool';

const pool = getPool(process.env.DATABASE_URL!);
const provenance = {
  actor: 'agent' as const,
  principal: 'user:mike',
  commandId: 'create:d1',
  sources: ['goal:1'],
};

function createCommand(payload: unknown): DraftCommand {
  return {
    kind: 'create',
    eventId: 'event:create:d1',
    commandId: 'create:d1',
    draftId: 'd1',
    owner: 'user:mike',
    policyScope: 'publishing',
    draftKind: 'flow-definition',
    target: 'post-status',
    baseVersion: '1',
    payloadHash: payloadSha256(payload),
    schemaRef: 'ui4a://flow-definition/v1',
    provenance,
    validation: { valid: false, issues: [{ code: 'parse-error', path: '/', message: 'bad' }] },
  };
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
});

describe('Draft persistence', () => {
  it('stores content-addressed payload and keeps Draft events out of Business fold', async () => {
    const payload = { name: 'post-status' };
    const before = contentVersion(fold(await readLog(pool), { flows: {} }));
    const created = await appendDraftCommand(pool, createCommand(payload), payload);
    expect(created.aggregate.status).toBe('invalid');
    expect(created.aggregate.versions[1]?.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(contentVersion(fold(await readLog(pool), { flows: {} }))).toBe(before);
    await expect(getDraft(pool, 'd1', 'user:mike', 'publishing')).resolves.toMatchObject({
      payload,
      aggregate: { id: 'd1' },
    });
  });

  it('is command-idempotent, CAS-safe and projection-rebuildable', async () => {
    const payload = { name: 'post-status' };
    const command = createCommand(payload);
    const first = await appendDraftCommand(pool, command, payload);
    const retry = await appendDraftCommand(pool, command, payload);
    expect(retry.aggregate).toEqual(first.aggregate);

    const nextPayload = { name: 'post-status', nodes: [] };
    const revise: DraftCommand = {
      kind: 'revise',
      eventId: 'event:revise:d1',
      commandId: 'revise:d1',
      draftId: 'd1',
      baseVersion: 1,
      payloadHash: payloadSha256(nextPayload),
      schemaRef: 'ui4a://flow-definition/v1',
      provenance: { ...provenance, commandId: 'revise:d1' },
      validation: { valid: false, issues: [] },
    };
    await appendDraftCommand(pool, revise, nextPayload);
    const stored = await pool.query<{ detail: { version: { validation: unknown } } }>(
      "SELECT detail FROM events WHERE domain='draft' AND kind='draft-revised'",
    );
    expect(stored.rows[0]?.detail.version.validation).not.toHaveProperty('value');
    expect(JSON.stringify(stored.rows[0]?.detail)).not.toContain('"nodes"');
    await expect(
      appendDraftCommand(
        pool,
        { ...revise, eventId: 'event:loser', commandId: 'loser' },
        nextPayload,
      ),
    ).rejects.toThrow('conflict');

    await pool.query('TRUNCATE draft_projection');
    expect(await listDrafts(pool, { owner: 'user:mike', policyScope: 'publishing' })).toEqual([]);
    await rebuildDraftProjection(pool);
    expect(await listDrafts(pool, { owner: 'user:mike', policyScope: 'publishing' })).toHaveLength(
      1,
    );
  });

  it('does not disclose another owner or policy scope', async () => {
    await appendDraftCommand(pool, createCommand({ secret: 'candidate' }), { secret: 'candidate' });
    await expect(getDraft(pool, 'd1', 'user:other', 'publishing')).resolves.toBeUndefined();
    await expect(getDraft(pool, 'd1', 'user:mike', 'community')).resolves.toBeUndefined();
    expect(await listDrafts(pool, { owner: 'user:other', policyScope: 'publishing' })).toEqual([]);
  });
});
