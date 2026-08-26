import {
  executeThreadCommand,
  project,
  type EngineEvent,
  type ExecRequest,
  type ProjectDeps,
} from '@ui4a/engine';

import type { DbExecutor, EventAppend } from '../db/events';
import { persistRejection } from './service-confirmation';
import { appendWithSeq, applyForeignGaps, type CoreEventLogState } from './service-event-log';
import type { ExecOutcome } from './service';

export interface ThreadExecDeps {
  toAppend: (event: EngineEvent) => EventAppend;
  projectDeps: () => ProjectDeps;
}

/** Execute a Work Thread resource action through the shared append-only core log. */
export async function execThreadAction(
  db: DbExecutor,
  state: CoreEventLogState,
  deps: ThreadExecDeps,
  request: ExecRequest,
): Promise<ExecOutcome> {
  const outcome = executeThreadCommand(request, state.snapshot);
  if (outcome.kind === 'rejected') {
    return persistRejection(db, state, deps.toAppend, request, outcome);
  }
  await appendWithSeq(db, state, deps.toAppend(outcome.event));
  state.snapshot = outcome.snapshot;
  applyForeignGaps(state);
  const entity = project(state.snapshot, outcome.entityRel, deps.projectDeps());
  if (entity === undefined) {
    throw new Error(`thread exec 后目标实体 "${outcome.entityRel}" 不可投影(内部不变式破坏)`);
  }
  return { kind: 'accepted', entity, appended: [] };
}
