import { parseRenderSubject, type RenderSubject } from './presentation/presentation';

/** Versioned, append-only client → server presence protocol. */
export const PRESENCE_SCHEMA_VERSION = 1 as const;
export const MAX_PRESENCE_CLIENT_INSTANCE_ID_LENGTH = 128;
export const MAX_PRESENCE_VALUE_LENGTH = 256;
export const PRESENCE_RATE_WINDOW_MS = 60_000;
export const PRESENCE_MAX_EVENTS_PER_WINDOW = 120;
export const PRESENCE_CHANGE_KINDS = ['site', 'scope', 'thread', 'focus'] as const;

export type PresenceChangeKind = (typeof PRESENCE_CHANGE_KINDS)[number];
export type PresenceValue = string | RenderSubject | null;

/** One bounded change point. Principal and authorization are server-owned. */
export interface PresenceChange {
  schemaVersion: typeof PRESENCE_SCHEMA_VERSION;
  kind: PresenceChangeKind;
  value: PresenceValue;
  clientInstanceId?: string;
}

export interface PresenceProjection {
  principal: string;
  site: string | null;
  scope: string | null;
  thread: string | null;
  focus: RenderSubject | null;
  updatedSeq: number;
}

export type PresenceSnapshot = Record<string, PresenceProjection>;

const PRESENCE_EVENT_KINDS = {
  site: 'presence-site-changed',
  scope: 'presence-scope-changed',
  thread: 'presence-thread-changed',
  focus: 'presence-focus-changed',
} as const;

export type PresenceEventKind = (typeof PRESENCE_EVENT_KINDS)[PresenceChangeKind];

const PRESENCE_KIND_BY_EVENT = Object.fromEntries(
  Object.entries(PRESENCE_EVENT_KINDS).map(([kind, eventKind]) => [eventKind, kind]),
) as Record<PresenceEventKind, PresenceChangeKind>;

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) throw new Error(`${label} contains forbidden key ${unexpected}`);
}

function boundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string within ${max} characters`);
  }
  return value;
}

function parseValue(kind: PresenceChangeKind, value: unknown): PresenceValue {
  if (value === null) return null;
  if (kind === 'focus') {
    const subject = parseRenderSubject(value);
    const values = typeof subject === 'string' ? [subject] : subject.selection;
    if (values.some((entry) => entry.length > MAX_PRESENCE_VALUE_LENGTH)) {
      throw new Error(`Presence ${kind} value exceeds ${MAX_PRESENCE_VALUE_LENGTH} characters`);
    }
    return subject;
  }
  return boundedString(value, MAX_PRESENCE_VALUE_LENGTH, `Presence ${kind} value`);
}

/** Parse and close the only four presence changes; no identity fields are accepted. */
export function parsePresenceChange(value: unknown): PresenceChange {
  record(value, 'Presence change');
  exactKeys(value, ['schemaVersion', 'kind', 'value', 'clientInstanceId'], 'Presence change');
  if (value.schemaVersion !== PRESENCE_SCHEMA_VERSION) {
    throw new Error(`Presence change schemaVersion must be ${PRESENCE_SCHEMA_VERSION}`);
  }
  if (!PRESENCE_CHANGE_KINDS.includes(value.kind as PresenceChangeKind)) {
    throw new Error('Presence change kind must be site, scope, thread or focus');
  }
  const clientInstanceId =
    value.clientInstanceId === undefined
      ? undefined
      : boundedString(
          value.clientInstanceId,
          MAX_PRESENCE_CLIENT_INSTANCE_ID_LENGTH,
          'Presence clientInstanceId',
        );
  const kind = value.kind as PresenceChangeKind;
  const parsedValue = parseValue(kind, value.value);
  return {
    schemaVersion: PRESENCE_SCHEMA_VERSION,
    kind,
    value: parsedValue,
    ...(clientInstanceId === undefined ? {} : { clientInstanceId }),
  };
}

export function presenceEventKind(kind: PresenceChangeKind): PresenceEventKind {
  return PRESENCE_EVENT_KINDS[kind];
}

export function presenceChangeKind(eventKind: string): PresenceChangeKind | undefined {
  return PRESENCE_KIND_BY_EVENT[eventKind as PresenceEventKind];
}

export function presenceValuesEqual(left: PresenceValue, right: PresenceValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
