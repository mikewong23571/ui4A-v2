import { beforeEach, describe, expect, it } from 'vitest';

import type { DraftCommand } from '@ui4a/engine';

import {
  acceptDraftWithCoreEvent,
  appendDraftCommand,
  ensureDraftTables,
  getDraft,
  payloadSha256,
  type AtomicCoreMutationPlan,
} from './drafts';
import { ensureEventsTable, type EventAppend } from '../events';
import { getPool } from '../pool';

// T48 Phase 2 / T2.1:acceptDraftWithCoreEvent 的统一多事件数组合同。
// 回调在 Draft 锁+事务内返回 AtomicCoreMutationPlan(events 数组,可选投影钩子):
// - 全部 core 事件与 draft-accepted 同事务落库,seq 按数组序连续且均先于 draftSeq;
// - 事件追加中途或投影钩子抛错 → 整体回滚,Draft 停留 pending-approval,可原命令重试;
// - 空事件数组是合同违例。
// 场景取材 application-bundle 激活(application/capability/definition-seeded + receipt)。
const pool = getPool(process.env.DATABASE_URL!);
const OWNER = 'user:mike';
const SCOPE = 'default';

function provenance(commandId: string) {
  return { actor: 'agent' as const, principal: OWNER, commandId, sources: [] };
}

function createCommand(draftId: string): DraftCommand {
  const payload = { name: 'demo', title: 'Demo' };
  return {
    kind: 'create',
    eventId: `event:create:${draftId}`,
    commandId: `create:${draftId}`,
    draftId,
    owner: OWNER,
    policyScope: SCOPE,
    draftKind: 'flow-definition',
    target: 'demo-flow',
    payloadHash: payloadSha256(payload),
    schemaRef: 'ui4a://flow-definition/v1',
    provenance: provenance(`create:${draftId}`),
    validation: { valid: false, issues: [] },
  };
}

async function driveToPendingApproval(draftId: string, payload: unknown): Promise<void> {
  await appendDraftCommand(pool, createCommand(draftId), payload);
  await appendDraftCommand(pool, {
    kind: 'validate',
    eventId: `event:validate:${draftId}`,
    commandId: `validate:${draftId}`,
    draftId,
    activeVersion: 1,
    validation: { valid: true, issues: [] },
  });
  await appendDraftCommand(pool, {
    kind: 'submit',
    eventId: `event:submit:${draftId}`,
    commandId: `submit:${draftId}`,
    draftId,
    activeVersion: 1,
    activation: `meta/activation:draft-${draftId}`,
  });
}

function acceptCommand(draftId: string) {
  return {
    kind: 'accept' as const,
    eventId: `event:accept:${draftId}`,
    commandId: `accept:${draftId}`,
    draftId,
    activeVersion: 1,
  };
}

function bootstrapEvent(kind: EventAppend['kind'], rel: string): EventAppend {
  return {
    domain: 'core',
    kind,
    rel,
    actor: 'agent',
    principal: 'system:meta-bootstrap',
    channel: 'meta',
    detail: { name: rel.split(':')[1], version: 1, status: 'active', definition: {} },
  };
}

/** 与 application-bundle 激活同形的最小安装计划:2 个 seed 事件 + receipt。 */
function bootstrapPlan(
  applyProjection?: AtomicCoreMutationPlan['applyProjection'],
): AtomicCoreMutationPlan {
  return {
    events: [
      bootstrapEvent('application-seeded', 'meta/application:demo'),
      bootstrapEvent('definition-seeded', 'meta/flow:demo-entry'),
      bootstrapEvent('meta-bootstrap-applied', 'meta/bootstrap:demo@1'),
    ],
    ...(applyProjection === undefined ? {} : { applyProjection }),
  };
}

async function statusOf(draftId: string): Promise<string | undefined> {
  return (await getDraft(pool, draftId, OWNER, SCOPE))?.aggregate.status;
}

async function coreSeedCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM events
     WHERE domain='core' AND kind IN ('application-seeded','definition-seeded','meta-bootstrap-applied')`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function draftAcceptedCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM events WHERE domain='draft' AND kind='draft-accepted'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
});

describe('acceptDraftWithCoreEvent multi-event plan contract', () => {
  it('appends every planned core event before draft-accepted in one transaction', async () => {
    await driveToPendingApproval('multi-ok', { name: 'demo', title: 'Demo' });
    const observedSeqs: number[][] = [];

    const accepted = await acceptDraftWithCoreEvent(pool, acceptCommand('multi-ok'), async () =>
      bootstrapPlan(async ({ seqs }) => {
        observedSeqs.push([...seqs]);
      }),
    );

    expect(accepted.aggregate.status).toBe('accepted');
    expect(accepted.coreSeqs).toHaveLength(3);
    expect(accepted.coreSeq).toBe(accepted.coreSeqs![0]);
    const coreSeqs = accepted.coreSeqs!;
    for (let index = 1; index < coreSeqs.length; index += 1) {
      expect(coreSeqs[index]).toBe(coreSeqs[index - 1]! + 1);
    }
    expect(accepted.draftSeq).toBeGreaterThan(Math.max(...coreSeqs));
    expect(observedSeqs).toEqual([coreSeqs]);

    const rows = await pool.query<{ domain: string; kind: string }>(
      `SELECT domain, kind FROM events ORDER BY seq ASC`,
    );
    expect(rows.rows.slice(-4).map((row) => [row.domain, row.kind])).toEqual([
      ['core', 'application-seeded'],
      ['core', 'definition-seeded'],
      ['core', 'meta-bootstrap-applied'],
      ['draft', 'draft-accepted'],
    ]);
  });

  it('rolls the whole acceptance back when an append fails mid-batch, then accepts on retry', async () => {
    await driveToPendingApproval('multi-fail-append', { name: 'demo', title: 'Demo' });
    const unserializable: EventAppend = {
      domain: 'core',
      kind: 'definition-seeded',
      rel: 'meta/flow:demo-entry',
      // BigInt 让第二条事件在 JSON 序列化(appendEvent 内)时失败:批次中途故障。
      detail: { bad: 1n },
    };

    await expect(
      acceptDraftWithCoreEvent(pool, acceptCommand('multi-fail-append'), async () => ({
        events: [bootstrapEvent('application-seeded', 'meta/application:demo'), unserializable],
      })),
    ).rejects.toThrow();

    expect(await coreSeedCount()).toBe(0);
    expect(await draftAcceptedCount()).toBe(0);
    expect(await statusOf('multi-fail-append')).toBe('pending-approval');

    const retried = await acceptDraftWithCoreEvent(
      pool,
      acceptCommand('multi-fail-append'),
      async () => bootstrapPlan(),
    );
    expect(retried.aggregate.status).toBe('accepted');
    expect(retried.coreSeqs).toHaveLength(3);
  });

  it('rolls back appended core events when the projection hook fails', async () => {
    await driveToPendingApproval('multi-fail-projection', { name: 'demo', title: 'Demo' });

    await expect(
      acceptDraftWithCoreEvent(pool, acceptCommand('multi-fail-projection'), async () => ({
        ...bootstrapPlan(),
        async applyProjection() {
          throw new Error('projection hook failed');
        },
      })),
    ).rejects.toThrow('projection hook failed');

    expect(await coreSeedCount()).toBe(0);
    expect(await draftAcceptedCount()).toBe(0);
    expect(await statusOf('multi-fail-projection')).toBe('pending-approval');
  });

  it('rejects an empty event plan as a contract violation', async () => {
    await driveToPendingApproval('multi-empty', { name: 'demo', title: 'Demo' });

    await expect(
      acceptDraftWithCoreEvent(pool, acceptCommand('multi-empty'), async () => ({ events: [] })),
    ).rejects.toThrow('draft acceptance requires a core event');

    expect(await coreSeedCount()).toBe(0);
    expect(await draftAcceptedCount()).toBe(0);
    expect(await statusOf('multi-empty')).toBe('pending-approval');
  });
});
