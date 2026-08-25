import { createHash } from 'node:crypto';

export interface RecoveryInput {
  events: Array<{ seq: number; domain: string; kind: string; detail: unknown }>;
  payloads: Array<{ table: string; hash: string; bytes: number }>;
  runs: Array<{
    runId: string;
    status: string;
    birthRef: string;
    resultRef?: string;
    artifactRefs: string[];
  }>;
  businessSnapshot: unknown;
  projections?: Record<string, unknown>;
}

export interface RecoveryFingerprint {
  schemaVersion: 1;
  eventHighWaterMark: number;
  eventCount: number;
  eventDigest: string;
  payloadDigest: string;
  runEvidenceDigest: string;
  businessSnapshotHash: string;
  authoritativeHash: string;
  projectionsExcluded: true;
}

export interface RecoveryComparison {
  authoritativeMatch: boolean;
  rpoEventDelta: number;
  rpoCommittedEvents: number;
  serviceRtoMs: number;
  verifiedRtoMs: number;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

/** Build one order-independent fingerprint over authoritative events, payloads, Runs and snapshot. */
export function buildRecoveryFingerprint(input: RecoveryInput): RecoveryFingerprint {
  const events = input.events
    .map((event) => ({ ...event }))
    .sort((left, right) => left.seq - right.seq || canonical(left).localeCompare(canonical(right)));
  const payloads = input.payloads
    .map((payload) => ({ ...payload }))
    .sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const runs = input.runs
    .map((run) => ({ ...run, artifactRefs: [...run.artifactRefs].sort() }))
    .sort((left, right) => left.runId.localeCompare(right.runId));
  const eventDigest = digest(events);
  const payloadDigest = digest(payloads);
  const runEvidenceDigest = digest(runs);
  const businessSnapshotHash = digest(input.businessSnapshot);
  const eventHighWaterMark = events.at(-1)?.seq ?? 0;
  const eventCount = events.length;
  const authoritativeHash = digest({
    businessSnapshotHash,
    eventCount,
    eventDigest,
    eventHighWaterMark,
    payloadDigest,
    runEvidenceDigest,
  });
  return {
    schemaVersion: 1,
    eventHighWaterMark,
    eventCount,
    eventDigest,
    payloadDigest,
    runEvidenceDigest,
    businessSnapshotHash,
    authoritativeHash,
    projectionsExcluded: true,
  };
}

function epoch(value: string): number {
  const parsed = new Date(value).valueOf();
  if (!Number.isFinite(parsed)) throw new Error('RECOVERY_TIME_INVALID');
  return parsed;
}

/** Compare source and isolated restore fingerprints and report measured event RPO and elapsed RTO. */
export function compareRecoveryFingerprints(input: {
  source: RecoveryFingerprint;
  restored: RecoveryFingerprint;
  restoreStartedAt: string;
  readyAt: string;
  verifiedAt: string;
}): RecoveryComparison {
  const started = epoch(input.restoreStartedAt);
  const ready = epoch(input.readyAt);
  const verified = epoch(input.verifiedAt);
  if (ready < started || verified < ready) throw new Error('RECOVERY_TIME_ORDER_INVALID');
  const eventDelta = Math.max(
    0,
    input.source.eventHighWaterMark - input.restored.eventHighWaterMark,
  );
  const countDelta = Math.max(0, input.source.eventCount - input.restored.eventCount);
  return {
    authoritativeMatch: input.source.authoritativeHash === input.restored.authoritativeHash,
    rpoEventDelta: eventDelta,
    rpoCommittedEvents: Math.max(eventDelta, countDelta),
    serviceRtoMs: ready - started,
    verifiedRtoMs: verified - started,
  };
}
