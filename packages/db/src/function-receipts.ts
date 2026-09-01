import type { NativeFunctionReceiptV1 } from '@ui4a/shared';
import { NATIVE_FUNCTION_OUTPUT_BYTES_MAX, parseNativeFunctionReceipt } from '@ui4a/shared';
import { canonicalAgentJson } from '@ui4a/engine';

import {
  appendEvent,
  withDatabaseTransaction,
  type ConnectableDb,
  type DbExecutor,
  type EventAppend,
} from './events';

async function readReceiptFrom(
  db: DbExecutor,
  executionId: string,
): Promise<NativeFunctionReceiptV1 | undefined> {
  const result = await db.query<{ detail: unknown }>(
    `SELECT detail FROM events
     WHERE domain='capability' AND kind='function-execution-finalized'
       AND detail->>'executionId'=$1`,
    [executionId],
  );
  const detail = result.rows[0]?.detail;
  return detail === undefined
    ? undefined
    : parseNativeFunctionReceipt(detail, NATIVE_FUNCTION_OUTPUT_BYTES_MAX);
}

export function readNativeFunctionReceipt(
  db: DbExecutor,
  executionId: string,
): Promise<NativeFunctionReceiptV1 | undefined> {
  return readReceiptFrom(db, executionId);
}

export async function commitNativeFunctionFinalization(
  db: ConnectableDb,
  input: {
    receipt: NativeFunctionReceiptV1;
    sourceRel: string;
    coreEvents: readonly EventAppend[];
  },
): Promise<{
  deduplicated: boolean;
  receipt: NativeFunctionReceiptV1;
  receiptSeq?: number;
  coreSeqs: number[];
}> {
  const receipt = parseNativeFunctionReceipt(input.receipt, NATIVE_FUNCTION_OUTPUT_BYTES_MAX);
  return withDatabaseTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      receipt.executionId,
    ]);
    const existing = await readReceiptFrom(client, receipt.executionId);
    if (existing !== undefined) {
      if (canonicalAgentJson(existing as never) !== canonicalAgentJson(receipt as never)) {
        throw new Error(`native function receipt collision: ${receipt.executionId}`);
      }
      return { deduplicated: true, receipt: existing, coreSeqs: [] };
    }
    const terminal = await appendEvent(client, {
      domain: 'capability',
      kind: 'function-execution-finalized',
      actor: 'agent',
      principal: `system:capability:${receipt.executionId}`,
      channel: 'native-function-callback',
      rel: input.sourceRel,
      action: receipt.callback.action,
      detail: receipt,
    });
    const coreSeqs: number[] = [];
    for (const event of input.coreEvents) {
      if (event.domain !== undefined && event.domain !== 'core') {
        throw new Error('Native Function callback batch accepts only core events');
      }
      coreSeqs.push((await appendEvent(client, { ...event, domain: 'core' })).seq);
    }
    return {
      deduplicated: false,
      receipt,
      receiptSeq: terminal.seq,
      coreSeqs,
    };
  });
}
