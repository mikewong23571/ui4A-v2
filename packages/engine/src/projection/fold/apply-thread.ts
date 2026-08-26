import {
  MAX_THREAD_RECENT_EVENTS,
  MAX_THREAD_REFERENCES_PER_CATEGORY,
  parseThreadEventDetail,
  type EngineSnapshot,
  type ThreadReferenceCategory,
  type ThreadSnapshot,
  type ThreadStatus,
} from '@ui4a/shared';

import type { LogEvent } from './log-event';

const statusTransitions: Readonly<Record<ThreadStatus, readonly ThreadStatus[]>> = {
  open: ['paused', 'completed', 'archived'],
  paused: ['open', 'completed', 'archived'],
  completed: ['open', 'archived'],
  archived: [],
};

function principal(event: LogEvent): string {
  if (typeof event.principal !== 'string' || event.principal.trim() === '') {
    throw new Error(`重放失败:seq=${event.seq} thread 事件缺少 principal(日志完整性)`);
  }
  return event.principal;
}

function replaceThread(
  snapshot: EngineSnapshot,
  threadId: string,
  thread: ThreadSnapshot,
): EngineSnapshot {
  return { ...snapshot, threads: { ...(snapshot.threads ?? {}), [threadId]: thread } };
}

function existingThread(
  snapshot: EngineSnapshot,
  event: LogEvent,
  threadId: string,
): ThreadSnapshot {
  const existing = snapshot.threads?.[threadId];
  if (existing === undefined) {
    throw new Error(`重放失败:seq=${event.seq} thread "${threadId}" 不存在(日志与状态漂移)`);
  }
  const eventPrincipal = principal(event);
  if (eventPrincipal !== existing.owner) {
    throw new Error(`重放失败:seq=${event.seq} thread "${threadId}" principal 与 owner 不匹配`);
  }
  return existing;
}

function writableThread(
  snapshot: EngineSnapshot,
  event: LogEvent,
  threadId: string,
): ThreadSnapshot {
  const existing = existingThread(snapshot, event, threadId);
  if (existing.status === 'archived') {
    throw new Error(`重放失败:seq=${event.seq} thread "${threadId}" 已归档(终态不可写)`);
  }
  return existing;
}

function eventSeq(rel: string): number {
  return Number(rel.slice('event:'.length));
}

function attach(
  snapshot: EngineSnapshot,
  event: LogEvent,
  detail: { threadId: string; category: ThreadReferenceCategory; rel: string },
): EngineSnapshot {
  const existing = writableThread(snapshot, event, detail.threadId);
  const current = existing.references[detail.category];
  if (current.includes(detail.rel)) return snapshot;

  if (detail.category !== 'event' && current.length >= MAX_THREAD_REFERENCES_PER_CATEGORY) {
    throw new Error(
      `重放失败:seq=${event.seq} thread "${detail.threadId}" ${detail.category} 引用超过上限 ${MAX_THREAD_REFERENCES_PER_CATEGORY}`,
    );
  }

  const appended = [...current, detail.rel];
  const references = {
    ...existing.references,
    [detail.category]:
      detail.category === 'event' ? appended.slice(-MAX_THREAD_RECENT_EVENTS) : appended,
  };
  const recentEventSeqs =
    detail.category === 'event' ? references.event.map(eventSeq) : existing.recentEventSeqs;
  return replaceThread(snapshot, detail.threadId, {
    ...existing,
    references,
    recentEventSeqs,
  });
}

function detach(
  snapshot: EngineSnapshot,
  event: LogEvent,
  detail: { threadId: string; category: ThreadReferenceCategory; rel: string },
): EngineSnapshot {
  const existing = writableThread(snapshot, event, detail.threadId);
  const current = existing.references[detail.category];
  if (!current.includes(detail.rel)) return snapshot;
  const references = {
    ...existing.references,
    [detail.category]: current.filter((rel) => rel !== detail.rel),
  };
  return replaceThread(snapshot, detail.threadId, {
    ...existing,
    references,
    recentEventSeqs:
      detail.category === 'event' ? references.event.map(eventSeq) : existing.recentEventSeqs,
  });
}

/** Fold one strictly parsed Work Thread event into the rebuildable thread table. */
export function applyThreadEvent(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  switch (event.kind) {
    case 'thread-created': {
      const created = parseThreadEventDetail(event.kind, event.detail);
      const eventPrincipal = principal(event);
      if (eventPrincipal !== created.owner) {
        throw new Error(`重放失败:seq=${event.seq} thread principal 与 owner 不匹配`);
      }
      if (snapshot.threads?.[created.threadId] !== undefined) {
        throw new Error(`重放失败:seq=${event.seq} thread "${created.threadId}" 重复创建`);
      }
      return replaceThread(snapshot, created.threadId, {
        id: created.threadId,
        owner: created.owner,
        goal: created.goal,
        status: 'open',
        references: { context: [], active: [], approval: [], event: [] },
        recentEventSeqs: [],
      });
    }
    case 'thread-reference-attached':
      return attach(snapshot, event, parseThreadEventDetail(event.kind, event.detail));
    case 'thread-reference-detached':
      return detach(snapshot, event, parseThreadEventDetail(event.kind, event.detail));
    case 'thread-status-changed': {
      const detail = parseThreadEventDetail(event.kind, event.detail);
      const existing = writableThread(snapshot, event, detail.threadId);
      if (!statusTransitions[existing.status].includes(detail.status)) {
        throw new Error(
          `重放失败:seq=${event.seq} thread "${detail.threadId}" 非法状态转移 ${existing.status} -> ${detail.status}`,
        );
      }
      return replaceThread(snapshot, detail.threadId, { ...existing, status: detail.status });
    }
    default:
      throw new Error(`重放失败:seq=${event.seq} applyThreadEvent 收到非 thread 事件`);
  }
}
