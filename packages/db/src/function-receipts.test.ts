import { beforeEach, describe, expect, it } from 'vitest';

import type { NativeFunctionReceiptV1 } from '@ui4a/shared';

import { ensureEventsTable, listEvents } from './events';
import { commitNativeFunctionFinalization, readNativeFunctionReceipt } from './function-receipts';
import { getPool } from './pool';

const pool = getPool(process.env.DATABASE_URL!);
const hash = `sha256:${'a'.repeat(64)}` as const;
const executionId = 'nf-16-aaaaaaaaaaaa';
const receipt: NativeFunctionReceiptV1 = {
  schemaVersion: 1,
  executionId,
  sourceEventId: 'core:42',
  invocationHash: hash,
  capability: { name: 'cve.enrich', hash },
  profile: {
    ref: 'security-enrichment-default',
    version: '1',
    handlerRef: 'security/cve-enrich@1',
    adapterVersion: 'native-function@1',
  },
  inputHash: hash,
  outcome: {
    schemaVersion: 1,
    status: 'succeeded',
    output: { severity: 'high' },
    outputHash: hash,
    outputByteLength: 19,
    evidenceRefs: [],
    attempt: 1,
  },
  callback: {
    commandId: `function-finalize:${executionId}`,
    action: 'enrichment-succeeded',
    outcome: 'accepted',
  },
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
});

describe('Native Function terminal receipt transaction', () => {
  it('atomically appends one capability receipt and its callback core events', async () => {
    const result = await commitNativeFunctionFinalization(pool, {
      receipt,
      coreEvents: [
        {
          kind: 'action-executed',
          rel: 'cve:CVE-2026-0001',
          action: 'enrichment-succeeded',
          actor: 'agent',
          principal: `system:capability:${executionId}`,
        },
      ],
    });
    expect(result.deduplicated).toBe(false);
    expect(await readNativeFunctionReceipt(pool, executionId)).toEqual(receipt);
    expect((await listEvents(pool, 0, { domain: 'core' })).map((event) => event.kind)).toEqual([
      'action-executed',
    ]);
  });

  it('deduplicates an identical execution and rejects a different invocation hash', async () => {
    await commitNativeFunctionFinalization(pool, { receipt, coreEvents: [] });
    await expect(
      commitNativeFunctionFinalization(pool, { receipt, coreEvents: [] }),
    ).resolves.toMatchObject({ deduplicated: true });
    await expect(
      commitNativeFunctionFinalization(pool, {
        receipt: { ...receipt, invocationHash: `sha256:${'b'.repeat(64)}` },
        coreEvents: [],
      }),
    ).rejects.toThrow(/collision/i);
    expect(await listEvents(pool, 0, { domain: 'capability' })).toHaveLength(1);
  });

  it('rolls back the receipt when a callback event cannot be serialized', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(
      commitNativeFunctionFinalization(pool, {
        receipt,
        coreEvents: [{ kind: 'action-executed', detail: cyclic }],
      }),
    ).rejects.toThrow();
    expect(await readNativeFunctionReceipt(pool, executionId)).toBeUndefined();
  });
});
