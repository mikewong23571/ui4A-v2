import { createHash } from 'node:crypto';

export type TemporalWorkflowStatus =
  'running' | 'completed' | 'failed' | 'canceled' | 'terminated' | 'timed-out';

export interface TemporalHistoryEvent {
  eventId: number;
  eventType: string;
  /** Reader-private data. It is deliberately excluded from public recovery evidence. */
  payload?: unknown;
}

export interface TemporalWorkflowHistory {
  workflowId: string;
  runId: string;
  status: TemporalWorkflowStatus;
  events: TemporalHistoryEvent[];
}

export interface TemporalWorkflowReference {
  workflowId: string;
  runId: string;
}

export interface TemporalHistoryReader {
  read(reference: TemporalWorkflowReference): Promise<TemporalWorkflowHistory>;
}

export interface TemporalHistoryEvidence {
  schemaVersion: 1;
  workflowId: string;
  runId: string;
  status: TemporalWorkflowStatus;
  historyEventIds: number[];
  historyEventTypes: string[];
  historyEventCount: number;
  historyDigest: `sha256:${string}`;
}

export type TemporalHistoryRecoveryEvidence =
  | {
      kind: 'closed-exact-match';
      source: TemporalHistoryEvidence;
      restored: TemporalHistoryEvidence;
    }
  | {
      kind: 'open-advanced-to-terminal';
      source: TemporalHistoryEvidence & { status: 'running' };
      restored: TemporalHistoryEvidence & { status: Exclude<TemporalWorkflowStatus, 'running'> };
    };

export type TemporalEvidenceErrorCode =
  | 'TEMPORAL_HISTORY_CLOSED_MISMATCH'
  | 'TEMPORAL_HISTORY_COMPLETION_INVALID'
  | 'TEMPORAL_HISTORY_EVENT_INVALID'
  | 'TEMPORAL_HISTORY_EVENT_ORDER_INVALID'
  | 'TEMPORAL_HISTORY_IDENTITY_INVALID'
  | 'TEMPORAL_HISTORY_IDENTITY_MISMATCH'
  | 'TEMPORAL_HISTORY_PREFIX_MISMATCH'
  | 'TEMPORAL_HISTORY_RESTORED_NOT_TERMINAL'
  | 'TEMPORAL_HISTORY_STATUS_INVALID';

export class TemporalEvidenceError extends Error {
  constructor(readonly code: TemporalEvidenceErrorCode) {
    super(code);
    this.name = 'TemporalEvidenceError';
  }
}

const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const EVENT_TYPE_PATTERN = /^EVENT_TYPE_[A-Z0-9_]+$/;
const STATUS_VALUES = new Set<TemporalWorkflowStatus>([
  'running',
  'completed',
  'failed',
  'canceled',
  'terminated',
  'timed-out',
]);
const TERMINAL_EVENT_BY_STATUS: Record<Exclude<TemporalWorkflowStatus, 'running'>, string> = {
  completed: 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED',
  failed: 'EVENT_TYPE_WORKFLOW_EXECUTION_FAILED',
  canceled: 'EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED',
  terminated: 'EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED',
  'timed-out': 'EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT',
};
const TERMINAL_EVENT_TYPES = new Set(Object.values(TERMINAL_EVENT_BY_STATUS));

function fail(code: TemporalEvidenceErrorCode): never {
  throw new TemporalEvidenceError(code);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(',')}}`;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function assertIdentity(history: TemporalWorkflowHistory): void {
  if (!WORKFLOW_ID_PATTERN.test(history.workflowId) || !RUN_ID_PATTERN.test(history.runId)) {
    fail('TEMPORAL_HISTORY_IDENTITY_INVALID');
  }
}

function assertStatus(status: TemporalWorkflowStatus): void {
  if (!STATUS_VALUES.has(status)) fail('TEMPORAL_HISTORY_STATUS_INVALID');
}

function assertEvents(history: TemporalWorkflowHistory): void {
  let priorId = 0;
  for (const event of history.events) {
    if (
      !Number.isSafeInteger(event.eventId) ||
      event.eventId < 1 ||
      !EVENT_TYPE_PATTERN.test(event.eventType)
    ) {
      fail('TEMPORAL_HISTORY_EVENT_INVALID');
    }
    if (event.eventId <= priorId) fail('TEMPORAL_HISTORY_EVENT_ORDER_INVALID');
    priorId = event.eventId;
  }

  const terminalEvents = history.events.filter((event) =>
    TERMINAL_EVENT_TYPES.has(event.eventType),
  );
  if (history.status === 'running') {
    if (terminalEvents.length !== 0) fail('TEMPORAL_HISTORY_COMPLETION_INVALID');
    return;
  }
  if (
    terminalEvents.length !== 1 ||
    history.events.at(-1) !== terminalEvents[0] ||
    terminalEvents[0]?.eventType !== TERMINAL_EVENT_BY_STATUS[history.status]
  ) {
    fail('TEMPORAL_HISTORY_COMPLETION_INVALID');
  }
}

/** Build a canonical, payload-free fingerprint from an injected Temporal history snapshot. */
export function buildTemporalHistoryEvidence(
  history: TemporalWorkflowHistory,
): TemporalHistoryEvidence {
  assertIdentity(history);
  assertStatus(history.status);
  assertEvents(history);
  const evidence = {
    schemaVersion: 1 as const,
    workflowId: history.workflowId,
    runId: history.runId,
    status: history.status,
    historyEventIds: history.events.map(({ eventId }) => eventId),
    historyEventTypes: history.events.map(({ eventType }) => eventType),
    historyEventCount: history.events.length,
  };
  return { ...evidence, historyDigest: digest(evidence) };
}

function assertReference(
  reference: TemporalWorkflowReference,
  history: TemporalWorkflowHistory,
): void {
  if (history.workflowId !== reference.workflowId || history.runId !== reference.runId) {
    fail('TEMPORAL_HISTORY_IDENTITY_MISMATCH');
  }
}

function exactEvidenceMatch(
  source: TemporalHistoryEvidence,
  restored: TemporalHistoryEvidence,
): boolean {
  return canonical(source) === canonical(restored);
}

function assertStrictPrefix(
  source: TemporalHistoryEvidence,
  restored: TemporalHistoryEvidence,
): void {
  if (restored.historyEventCount <= source.historyEventCount) {
    fail('TEMPORAL_HISTORY_PREFIX_MISMATCH');
  }
  for (let index = 0; index < source.historyEventCount; index += 1) {
    if (
      source.historyEventIds[index] !== restored.historyEventIds[index] ||
      source.historyEventTypes[index] !== restored.historyEventTypes[index]
    ) {
      fail('TEMPORAL_HISTORY_PREFIX_MISMATCH');
    }
  }
}

/**
 * Compare source and isolated-restored histories without owning any network client. Closed runs are
 * immutable; runs open at backup time must retain the full source prefix and reach one terminal.
 */
export async function verifyTemporalHistoryRecovery(
  reference: TemporalWorkflowReference,
  readers: { source: TemporalHistoryReader; restored: TemporalHistoryReader },
): Promise<TemporalHistoryRecoveryEvidence> {
  const [sourceHistory, restoredHistory] = await Promise.all([
    readers.source.read(reference),
    readers.restored.read(reference),
  ]);
  assertReference(reference, sourceHistory);
  assertReference(reference, restoredHistory);
  const source = buildTemporalHistoryEvidence(sourceHistory);
  const restored = buildTemporalHistoryEvidence(restoredHistory);

  if (source.status !== 'running') {
    if (!exactEvidenceMatch(source, restored)) fail('TEMPORAL_HISTORY_CLOSED_MISMATCH');
    return { kind: 'closed-exact-match', source, restored };
  }
  if (restored.status === 'running') fail('TEMPORAL_HISTORY_RESTORED_NOT_TERMINAL');
  assertStrictPrefix(source, restored);
  return {
    kind: 'open-advanced-to-terminal',
    source: source as TemporalHistoryEvidence & { status: 'running' },
    restored: restored as TemporalHistoryEvidence & {
      status: Exclude<TemporalWorkflowStatus, 'running'>;
    },
  };
}
