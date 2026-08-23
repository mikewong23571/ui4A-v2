import type { SirenEntity } from '@ui4a/engine';

import { getAgentRunInternal, type ConnectableDb } from '../db/agent-runs';
import { getEngine } from './service';

export type AgentRunSourceCallbackResult =
  | { ok: true; entity: SirenEntity; deduplicated: boolean }
  | { ok: false; status: 404 | 409 | 422; reason: string; layer?: string };

/** Apply one birth-pinned Agent Run terminal callback through the declared Application action. */
export async function finalizeAgentRunSource(
  db: ConnectableDb,
  runId: string,
): Promise<AgentRunSourceCallbackResult> {
  const run = await getAgentRunInternal(db, runId);
  if (run === undefined) return { ok: false, status: 404, reason: 'agent run not found' };
  const engine = await getEngine(db);
  const existing = await engine.getEntity(run.source.rel);
  const fields = existing?.properties.fields as Record<string, unknown> | undefined;
  if (
    existing !== undefined &&
    fields?.runId === runId &&
    ['review-ready', 'implementation-failed', 'completed', 'failed'].includes(
      String(existing.properties.node),
    )
  ) {
    return { ok: true, entity: existing, deduplicated: true };
  }
  const succeeded = run.status === 'succeeded' && run.result !== undefined;
  const terminalFailure = ['failed', 'cancelled', 'stale'].includes(run.status);
  if (!succeeded && !terminalFailure) {
    return {
      ok: false,
      status: 409,
      reason: `agent run is not callback-terminal (${run.status})`,
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
    channel: 'agent-run-callback',
    params: succeeded
      ? { runId, resultId: run.result!.resultId }
      : {
          runId,
          reason: run.failure?.reason ?? run.terminalReason ?? `agent run ${run.status}`,
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
