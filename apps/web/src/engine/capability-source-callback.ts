import type { SirenEntity } from '@ui4a/engine';

import { getCapabilityRunInternal, type ConnectableDb } from '../db/capability-runs';
import { getEngine } from './service';

export type CapabilitySourceCallbackResult =
  | { ok: true; entity: SirenEntity; deduplicated: boolean }
  | { ok: false; status: 404 | 409 | 422; reason: string; layer?: string };

/** Apply one declared terminal callback; retries detect the source Flow terminal state. */
export async function finalizeCapabilitySource(
  db: ConnectableDb,
  runId: string,
): Promise<CapabilitySourceCallbackResult> {
  const run = await getCapabilityRunInternal(db, runId);
  if (run === undefined) return { ok: false, status: 404, reason: 'capability run not found' };
  const engine = await getEngine(db);
  const existing = await engine.getEntity(run.source.rel);
  const fields = existing?.properties.fields as Record<string, unknown> | undefined;
  if (
    existing !== undefined &&
    fields?.runId === runId &&
    ['review-ready', 'implementation-failed'].includes(String(existing.properties.node))
  ) {
    return { ok: true, entity: existing, deduplicated: true };
  }
  const succeeded = run.status === 'succeeded' && run.result !== undefined;
  const terminalFailure = ['failed', 'cancelled', 'stale'].includes(run.status);
  if (!succeeded && !terminalFailure) {
    return {
      ok: false,
      status: 409,
      reason: `capability run is not callback-terminal (${run.status})`,
    };
  }
  const action = succeeded ? run.source.onDoneAction : run.source.onErrorAction;
  if (action === undefined) {
    return { ok: false, status: 409, reason: 'declared callback action is missing' };
  }
  const outcome = await engine.exec({
    rel: run.source.rel,
    action,
    actor: 'agent',
    principal: `system:capability:${runId}`,
    channel: 'capability-callback',
    params: succeeded
      ? { runId, resultId: run.result!.resultId }
      : {
          runId,
          reason: run.failure?.reason ?? run.terminalReason ?? `capability run ${run.status}`,
        },
  });
  if (outcome.kind !== 'accepted') {
    return {
      ok: false,
      status: 422,
      layer: outcome.kind === 'rejected' ? outcome.layer : 'guard-failed',
      reason: outcome.kind === 'rejected' ? outcome.reason : 'callback suspended',
    };
  }
  return { ok: true, entity: outcome.entity, deduplicated: false };
}
