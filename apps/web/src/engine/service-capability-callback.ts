import { executeWithGates, type AgentRun, type ExecuteDeps } from '@ui4a/engine';
import type { DbExecutor } from '@ui4a/db/events';

import { appendBatchWithSeq, type CoreEventLogState } from './service-event-log';
import { engineEventToAppend } from './service-event-append';

/** Apply the declared failure callback when an Agent executor cannot start its canonical Run. */
export async function persistFailedAgentDispatchCallback(
  db: DbExecutor,
  state: CoreEventLogState,
  run: AgentRun,
  deps: ExecuteDeps,
): Promise<void> {
  if (run.status !== 'failed') return;
  const action = run.source.onErrorAction;
  if (action === undefined)
    throw new Error('failed capability dispatch has no declared on-error action');
  const callback = executeWithGates(
    {
      rel: run.source.rel,
      action,
      actor: 'agent',
      principal: `system:capability:${run.runId}`,
      channel: 'capability-callback',
      trustedIngress: 'capability-callback',
      params: {
        runId: run.runId,
        reason: run.failure?.reason ?? 'capability dispatch failed',
      },
    },
    state.snapshot,
    deps,
  );
  if (callback.kind !== 'executed') {
    const reason = callback.kind === 'rejected' ? callback.reason : 'confirmation suspended';
    throw new Error(`failed capability dispatch callback rejected: ${reason}`);
  }
  await appendBatchWithSeq(
    db,
    state,
    callback.events.map((event) => engineEventToAppend(event)),
  );
  state.snapshot = callback.snapshot;
}
