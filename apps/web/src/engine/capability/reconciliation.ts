import { parseNativeFunctionInvocation, parseNativeFunctionProfiles } from '@ui4a/shared';
import type { EngineEvent } from '@ui4a/engine';
import type { DbExecutor } from '@ui4a/db/events';

import { reconcileNativeFunctionSpawns, type PreparedNativeFunctionDispatch } from './dispatch';
import { dispatchNativeFunction } from '../../temporal/native-function';

export interface NativeFunctionSpawnRow {
  seq: string | number;
  rel: string;
  action: string;
  actor: 'human' | 'agent';
  principal: string | null;
  channel: string | null;
  detail: unknown;
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function preparedNativeFunctionFromRow(
  row: NativeFunctionSpawnRow,
): PreparedNativeFunctionDispatch {
  const detail = object(row.detail, 'spawn detail');
  const native = object(detail.nativeFunction, 'spawn nativeFunction');
  const source = object(native.source, 'spawn nativeFunction source');
  const seq = Number(row.seq);
  const profile = parseNativeFunctionProfiles([native.profile])[0]!;
  const invocation = parseNativeFunctionInvocation({
    schemaVersion: 1,
    source: { eventId: `core:${seq}`, ...source },
    birth: native.birth,
    callback: native.callback,
    input: native.input,
  });
  const event: EngineEvent = {
    kind: 'spawn-requested',
    rel: row.rel,
    action: row.action,
    actor: row.actor,
    ...(row.principal === null ? {} : { principal: row.principal }),
    ...(row.channel === null ? {} : { channel: row.channel }),
    capability: typeof detail.capability === 'string' ? detail.capability : undefined,
    ...(detail.bind === undefined ? {} : { bind: object(detail.bind, 'spawn bind') }),
    ...(typeof detail['on-done'] === 'string' ? { 'on-done': detail['on-done'] } : {}),
    ...(typeof detail['on-error'] === 'string' ? { 'on-error': detail['on-error'] } : {}),
  };
  return {
    event,
    profile,
    source: {
      rel: invocation.source.rel,
      action: invocation.source.action,
      principal: invocation.source.principal,
      policyScope: invocation.source.policyScope,
    },
    birth: invocation.birth,
    callback: invocation.callback,
    input: invocation.input,
  };
}

export async function reconcilePersistedNativeFunctions(
  db: DbExecutor,
): Promise<{ started: string[] }> {
  const [spawnResult, receiptResult] = await Promise.all([
    db.query<NativeFunctionSpawnRow>(
      `SELECT seq, rel, action, actor, principal, channel, detail
       FROM events
       WHERE domain='core' AND kind='spawn-requested' AND detail ? 'nativeFunction'
       ORDER BY seq`,
    ),
    db.query<{ execution_id: string }>(
      `SELECT detail->>'executionId' AS execution_id
       FROM events
       WHERE domain='capability' AND kind='function-execution-finalized'`,
    ),
  ]);
  const spawns = spawnResult.rows.map((row) => ({
    seq: Number(row.seq),
    prepared: preparedNativeFunctionFromRow(row),
  }));
  return reconcileNativeFunctionSpawns({
    spawns,
    finalizedExecutionIds: new Set(receiptResult.rows.map((row) => row.execution_id)),
    start: dispatchNativeFunction,
  });
}

export async function readPersistedNativeFunctionSpawn(
  db: DbExecutor,
  sourceSeq: number,
): Promise<{ seq: number; prepared: PreparedNativeFunctionDispatch } | undefined> {
  const result = await db.query<NativeFunctionSpawnRow>(
    `SELECT seq, rel, action, actor, principal, channel, detail
     FROM events
     WHERE seq=$1 AND domain='core' AND kind='spawn-requested' AND detail ? 'nativeFunction'`,
    [sourceSeq],
  );
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : { seq: Number(row.seq), prepared: preparedNativeFunctionFromRow(row) };
}

let reconciliationTimer: ReturnType<typeof setInterval> | undefined;

/** Best-effort outbox delivery; persisted spawns remain recoverable while Temporal is unavailable. */
export function scheduleNativeFunctionReconciliation(db: DbExecutor): void {
  if (reconciliationTimer !== undefined) return;
  const run = () => void reconcilePersistedNativeFunctions(db).catch(() => undefined);
  run();
  reconciliationTimer = setInterval(run, 30_000);
  reconciliationTimer.unref?.();
}

export function resetNativeFunctionReconciliationForTests(): void {
  if (reconciliationTimer !== undefined) clearInterval(reconciliationTimer);
  reconciliationTimer = undefined;
}
