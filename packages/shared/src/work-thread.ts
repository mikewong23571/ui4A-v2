/** Platform-neutral contracts for the principal-owned Work Thread projection. */
export const THREAD_EVENT_KINDS = [
  'thread-created',
  'thread-reference-attached',
  'thread-reference-detached',
  'thread-status-changed',
] as const;

export const THREAD_REFERENCE_CATEGORIES = ['context', 'active', 'approval', 'event'] as const;
export const THREAD_STATUSES = ['open', 'paused', 'completed', 'archived'] as const;
export const THREAD_REFERENCE_SOURCES = ['action', 'presence'] as const;

export const MAX_THREAD_ID_LENGTH = 64;
export const MAX_THREAD_OWNER_LENGTH = 256;
export const MAX_THREAD_GOAL_LENGTH = 2_048;
export const MAX_THREAD_REL_LENGTH = 512;
export const MAX_THREAD_REFERENCES_PER_CATEGORY = 256;
export const MAX_THREAD_RECENT_EVENTS = 50;

export type ThreadEventKind = (typeof THREAD_EVENT_KINDS)[number];
export type ThreadReferenceCategory = (typeof THREAD_REFERENCE_CATEGORIES)[number];
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export type ThreadReferenceSource = (typeof THREAD_REFERENCE_SOURCES)[number];

/** Goal text is copied only once; source remains a canonical audit reference. */
export interface ThreadGoal {
  text: string;
  source: string;
}

export interface ThreadCreatedDetail {
  threadId: string;
  owner: string;
  goal: ThreadGoal;
}

export interface ThreadReferenceAttachedDetail {
  threadId: string;
  category: ThreadReferenceCategory;
  rel: string;
  /** Presence may select a default, but the resolved attachment is still explicit. */
  source?: ThreadReferenceSource;
}

export interface ThreadReferenceDetachedDetail {
  threadId: string;
  category: ThreadReferenceCategory;
  rel: string;
  source?: ThreadReferenceSource;
}

export interface ThreadStatusChangedDetail {
  threadId: string;
  status: ThreadStatus;
}

export type ThreadEventDetail =
  | ThreadCreatedDetail
  | ThreadReferenceAttachedDetail
  | ThreadReferenceDetachedDetail
  | ThreadStatusChangedDetail;

export interface ThreadSnapshot {
  id: string;
  owner: string;
  goal: ThreadGoal;
  status: ThreadStatus;
  /** Ordered, duplicate-free canonical rels; membership comes only from explicit events. */
  references: Record<ThreadReferenceCategory, string[]>;
  /** Derived from references.event and capped at MAX_THREAD_RECENT_EVENTS. */
  recentEventSeqs: number[];
}

const threadIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const canonicalRelPattern = /^[^\s?#\u0000-\u001f\u007f]+$/u;
const eventRelPattern = /^event:([1-9][0-9]*)$/u;

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) throw new Error(`${label} contains forbidden key ${unexpected}`);
}

function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string within ${maximum} characters`);
  }
  return value;
}

function threadId(value: unknown): string {
  const parsed = boundedText(value, MAX_THREAD_ID_LENGTH, 'Thread id');
  if (!threadIdPattern.test(parsed)) {
    throw new Error('Thread id must match [a-z0-9][a-z0-9._-]*');
  }
  return parsed;
}

function canonicalRel(value: unknown, category?: ThreadReferenceCategory): string {
  const parsed = boundedText(value, MAX_THREAD_REL_LENGTH, 'Thread reference rel');
  if (!canonicalRelPattern.test(parsed)) throw new Error('Thread reference rel is invalid');
  if (category === 'event') {
    const sequence = eventRelPattern.exec(parsed)?.[1];
    if (sequence === undefined || !Number.isSafeInteger(Number(sequence))) {
      throw new Error('Thread event reference must be event:<positive safe integer>');
    }
  }
  return parsed;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label} is invalid`);
  }
  return value as T;
}

function goal(value: unknown): ThreadGoal {
  record(value, 'Thread goal');
  exactKeys(value, ['text', 'source'], 'Thread goal');
  return {
    text: boundedText(value.text, MAX_THREAD_GOAL_LENGTH, 'Thread goal text'),
    source: canonicalRel(value.source),
  };
}

function referenceDetail(
  value: Record<string, unknown>,
  label: string,
): ThreadReferenceAttachedDetail | ThreadReferenceDetachedDetail {
  exactKeys(value, ['threadId', 'category', 'rel', 'source'], label);
  const category = oneOf(value.category, THREAD_REFERENCE_CATEGORIES, 'Thread reference category');
  const source =
    value.source === undefined
      ? undefined
      : oneOf(value.source, THREAD_REFERENCE_SOURCES, 'Thread reference source');
  return {
    threadId: threadId(value.threadId),
    category,
    rel: canonicalRel(value.rel, category),
    ...(source === undefined ? {} : { source }),
  };
}

function referenceList(value: unknown, category: ThreadReferenceCategory): string[] {
  const maximum =
    category === 'event' ? MAX_THREAD_RECENT_EVENTS : MAX_THREAD_REFERENCES_PER_CATEGORY;
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`Thread ${category} references must contain at most ${maximum} rels`);
  }
  const parsed = value.map((rel) => canonicalRel(rel, category));
  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`Thread ${category} references must not contain duplicates`);
  }
  return parsed;
}

function recentEventSeqs(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_THREAD_RECENT_EVENTS) {
    throw new Error(`Thread recent events must contain at most ${MAX_THREAD_RECENT_EVENTS} seqs`);
  }
  const parsed = value.map((seq) => {
    if (!Number.isSafeInteger(seq) || Number(seq) <= 0) {
      throw new Error('Thread recent event seq must be a positive safe integer');
    }
    return Number(seq);
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new Error('Thread recent events must not contain duplicates');
  }
  return parsed;
}

/** Validate a serialized projection without accepting copied entity or chat content. */
export function parseThreadSnapshot(value: unknown): ThreadSnapshot {
  record(value, 'Thread snapshot');
  exactKeys(
    value,
    ['id', 'owner', 'goal', 'status', 'references', 'recentEventSeqs'],
    'Thread snapshot',
  );
  record(value.references, 'Thread snapshot references');
  exactKeys(value.references, THREAD_REFERENCE_CATEGORIES, 'Thread snapshot references');
  const references = {
    context: referenceList(value.references.context, 'context'),
    active: referenceList(value.references.active, 'active'),
    approval: referenceList(value.references.approval, 'approval'),
    event: referenceList(value.references.event, 'event'),
  };
  const seqs = recentEventSeqs(value.recentEventSeqs);
  if (
    references.event.length !== seqs.length ||
    !references.event.every((rel, index) => rel === `event:${seqs[index]}`)
  ) {
    throw new Error('Thread event references and recent event seqs must match');
  }
  return {
    id: threadId(value.id),
    owner: boundedText(value.owner, MAX_THREAD_OWNER_LENGTH, 'Thread owner'),
    goal: goal(value.goal),
    status: oneOf(value.status, THREAD_STATUSES, 'Thread status'),
    references,
    recentEventSeqs: seqs,
  };
}

export function parseThreadEventDetail(kind: 'thread-created', value: unknown): ThreadCreatedDetail;
export function parseThreadEventDetail(
  kind: 'thread-reference-attached',
  value: unknown,
): ThreadReferenceAttachedDetail;
export function parseThreadEventDetail(
  kind: 'thread-reference-detached',
  value: unknown,
): ThreadReferenceDetachedDetail;
export function parseThreadEventDetail(
  kind: 'thread-status-changed',
  value: unknown,
): ThreadStatusChangedDetail;
export function parseThreadEventDetail(kind: string, value: unknown): ThreadEventDetail;
/** Parse only the four closed core event details and reject every undeclared field. */
export function parseThreadEventDetail(kind: string, value: unknown): ThreadEventDetail {
  if (!THREAD_EVENT_KINDS.includes(kind as ThreadEventKind)) {
    throw new Error(`Unsupported thread event kind ${kind}`);
  }
  record(value, 'Thread event detail');
  switch (kind) {
    case 'thread-created':
      exactKeys(value, ['threadId', 'owner', 'goal'], 'Thread created detail');
      return {
        threadId: threadId(value.threadId),
        owner: boundedText(value.owner, MAX_THREAD_OWNER_LENGTH, 'Thread owner'),
        goal: goal(value.goal),
      };
    case 'thread-reference-attached':
      return referenceDetail(value, 'Thread reference attached detail');
    case 'thread-reference-detached':
      return referenceDetail(value, 'Thread reference detached detail');
    case 'thread-status-changed':
      exactKeys(value, ['threadId', 'status'], 'Thread status changed detail');
      return {
        threadId: threadId(value.threadId),
        status: oneOf(value.status, THREAD_STATUSES, 'Thread status'),
      };
    default:
      throw new Error(`Unsupported thread event kind ${kind}`);
  }
}
