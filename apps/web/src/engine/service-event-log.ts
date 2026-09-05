/**
 * 核心事件日志的增量 fold 状态与追加边界(自 service.ts 拆出,行为不变)。
 * 多写者水位铁律:水位只能跨过已折叠或自身已应用的 seq;追加时把
 * (lastSeq, 自身 seq) 区间的外部事件收进 foreignGaps,覆写点后由
 * applyForeignGaps 统一补折(可交换性论证见原 service.ts 注释)。
 */
import { fold, type EngineEvent, type LogEvent } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import {
  appendEventBatch,
  readLog,
  type ConnectableDb,
  type DbExecutor,
  type EventAppend,
} from '@ui4a/db/events';

export interface CoreEventLogState {
  snapshot: EngineSnapshot;
  lastSeq: number;
  committedCoreCount: number;
  foreignGaps: LogEvent[];
}

export function createCoreEventLogState(events: readonly LogEvent[]): CoreEventLogState {
  return {
    snapshot: fold(events, { flows: {} }),
    lastSeq: events.length > 0 ? events[events.length - 1]!.seq : 0,
    committedCoreCount: events.length,
    foreignGaps: [],
  };
}

/** Atomically append one command batch and collect already-committed lower foreign sequences. */
export async function appendBatchWithSeq(
  db: DbExecutor,
  state: CoreEventLogState,
  batch: readonly EventAppend[],
): Promise<number[]> {
  if (batch.length === 0) return [];
  const appended = await appendEventBatch(db as ConnectableDb, batch);
  const seqs = appended.map(({ seq }) => seq);
  const own = new Set(seqs);
  const highest = Math.max(...seqs);
  state.committedCoreCount += seqs.length;
  if (highest > state.lastSeq) {
    const gap = (await readLog(db, state.lastSeq)).filter(
      (entry) => entry.seq < highest && !own.has(entry.seq),
    );
    state.foreignGaps.push(...gap);
    state.committedCoreCount += gap.length;
    state.lastSeq = highest;
  }
  return seqs;
}

/** Append one event through the same real-client transaction boundary used by command batches. */
export async function appendWithSeq(
  db: DbExecutor,
  state: CoreEventLogState,
  event: EventAppend,
): Promise<number> {
  return (await appendBatchWithSeq(db, state, [event]))[0]!;
}

/** 把落库窗口内挤进来的外部事件补折进当前快照(幂等清空;所有覆写点之后调用)。 */
export function applyForeignGaps(state: CoreEventLogState): void {
  if (state.foreignGaps.length === 0) return;
  const gaps = state.foreignGaps;
  state.foreignGaps = [];
  state.snapshot = fold(gaps, { flows: {} }, state.snapshot);
}

/**
 * T52 application-deprecated 的选择性补折(T55/D76 自 service.ts exec 闭包迁入)。
 * appendBatchWithSeq 推进水位使自身事件不进增量 fold(防双算);本 kind 是该
 * 纪律的例外——deprecatedApplications 审计表是 fold 侧专属物化(条目 seq 由
 * 日志层分配,纯裁决层在线不可知),不补折则同进程内烧毁名 create/validate
 * 守卫读不到审计集(US4/D71.5 三门须即时 fail-closed)。仅折该 kind:其
 * applier 与在线级联逐表幂等收敛(applications 删键 no-op、definitions 置废
 * 同值、审计首写补上真 seq),在线快照与全量重放零漂移;其余自身事件
 * (action-executed 等)不折——在线已由 outcome.snapshot 推进,重折会以旧
 * 输入重裁决而漂移。flows 依赖与 applyForeignGaps 同口径({flows:{}}:该
 * applier 不消费)。
 */
export function refoldApplicationDeprecations(
  state: CoreEventLogState,
  events: readonly EngineEvent[],
  seqs: readonly number[],
): void {
  const deprecatedEvents: LogEvent[] = [];
  for (const [index, event] of events.entries()) {
    if (event.kind !== 'application-deprecated') continue;
    deprecatedEvents.push({ ...event, seq: seqs[index]! });
  }
  if (deprecatedEvents.length > 0) {
    state.snapshot = fold(deprecatedEvents, { flows: {} }, state.snapshot);
  }
}

/** Incrementally fold committed suffixes; rebuild if commit order reveals a late lower seq. */
export async function refreshFromLog(
  db: DbExecutor,
  state: CoreEventLogState,
  onDefinitionCandidateApplied: (snapshot: EngineSnapshot) => void,
): Promise<void> {
  const result = await db.query<{
    max_seq: string | number | null;
    event_count: string | number;
  }>("SELECT max(seq) AS max_seq, count(*) AS event_count FROM events WHERE domain='core'");
  const maxSeq = Number(result.rows[0]?.max_seq ?? 0);
  const eventCount = Number(result.rows[0]?.event_count ?? 0);
  if (eventCount === state.committedCoreCount) {
    applyForeignGaps(state); // 上一队列操作若中途抛错可能残留未补折的外部事件
    return;
  }
  const fresh = maxSeq > state.lastSeq ? await readLog(db, state.lastSeq) : [];
  const expectedFresh = eventCount - state.committedCoreCount;
  if (expectedFresh < 0 || fresh.length !== expectedFresh) {
    // PostgreSQL sequences are allocation order, not commit order. A transaction may commit a
    // lower seq after this process has already observed and applied a higher one. Folding that
    // late event after the current snapshot would reorder history, so rebuild from sorted truth.
    const complete = await readLog(db);
    state.snapshot = fold(complete, { flows: {} });
    state.foreignGaps = [];
    state.committedCoreCount = complete.length;
    state.lastSeq = complete.at(-1)?.seq ?? 0;
    if (complete.some((event) => event.kind === 'definition-candidate-applied')) {
      onDefinitionCandidateApplied(state.snapshot);
    }
    return;
  }
  // 先折残留 foreignGaps 再折 fresh:gaps 构造上恒更旧(seq < 收集时的
  // lastSeq),先折保持时序;若先折 fresh,残留 gap 与 fresh 中相邻的
  // 委托步号会触发折叠层「步号不连续」响亮报错且确定性复发(终审 M-1)。
  applyForeignGaps(state);
  state.snapshot = fold(fresh, { flows: {} }, state.snapshot);
  if (fresh.some((event) => event.kind === 'definition-candidate-applied')) {
    onDefinitionCandidateApplied(state.snapshot);
  }
  state.committedCoreCount += fresh.length;
  state.lastSeq = Math.max(state.lastSeq, fresh[fresh.length - 1]!.seq);
}
