import {
  parseRenderSubject,
  type PresenceChange,
  type PresenceChangeKind,
  type PresenceValue,
  type RenderSubject,
} from '@ui4a/shared';

import { metaFlowFocusForPathname } from './navigation';

export interface PresenceObservation {
  site: string;
  scope: string | null;
  thread: string | null;
  focus: RenderSubject | null;
}

export interface PresenceReporterOptions {
  transport: (change: PresenceChange) => Promise<unknown>;
  debounceMs?: number;
}

let latestPresenceSequence: number | undefined;

export function latestPresenceSeq(): number | undefined {
  return latestPresenceSequence;
}

function routeValue(route: string): URL {
  return new URL(route, 'http://ui4a.local');
}

function boundedQueryValue(url: URL, key: string): string | null {
  const value = url.searchParams.get(key);
  return value === null || value === '' ? null : value;
}

function focusFromLocation(url: URL): RenderSubject | null {
  const focus = boundedQueryValue(url, 'focus');
  if (focus !== null) return parseRenderSubject(focus);
  const roots = boundedQueryValue(url, 'roots');
  if (roots !== null) {
    const selection = roots.split(',').filter(Boolean);
    return selection.length === 0 ? null : parseRenderSubject({ selection });
  }
  const rel = boundedQueryValue(url, 'rel');
  if (rel !== null) return parseRenderSubject(rel);
  const metaFlowFocus = metaFlowFocusForPathname(url.pathname);
  return metaFlowFocus === null ? null : parseRenderSubject(metaFlowFocus);
}

/** Convert only explicit URL protocol fields into a structured presence observation. */
export function presenceObservationForLocation(route: string): PresenceObservation {
  const url = routeValue(route);
  const site =
    url.pathname === '/meta' || url.pathname.startsWith('/meta/') ? 'meta' : 'workstation';
  return {
    site,
    scope: boundedQueryValue(url, 'scope'),
    thread: boundedQueryValue(url, 'thread'),
    focus: focusFromLocation(url),
  };
}

function valuesEqual(left: PresenceValue, right: PresenceValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changeKinds(): readonly PresenceChangeKind[] {
  return ['site', 'scope', 'thread', 'focus'];
}

function changesBetween(
  previous: PresenceObservation | undefined,
  next: PresenceObservation,
  clientInstanceId: string,
): PresenceChange[] {
  return changeKinds().flatMap((kind) => {
    const value = next[kind];
    if (previous === undefined && value === null) return [];
    if (previous !== undefined && valuesEqual(previous[kind], value)) return [];
    return [{ schemaVersion: 1, kind, value, clientInstanceId }];
  });
}

/** Debounced change-point reporter. Transport failures are deliberately swallowed. */
export function createPresenceReporter(options: PresenceReporterOptions) {
  const debounceMs = options.debounceMs ?? 250;
  let previous: PresenceObservation | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<PresenceChangeKind, PresenceChange>();

  const flush = async (): Promise<void> => {
    timer = undefined;
    const changes = [...pending.values()];
    pending.clear();
    for (const change of changes) {
      try {
        await options.transport(change);
      } catch {
        // Presence is an optimization signal; browsing and Chat must remain available.
      }
    }
  };

  return {
    observe(observation: PresenceObservation, clientInstanceId: string): void {
      if (disposed) return;
      for (const change of changesBetween(previous, observation, clientInstanceId)) {
        pending.set(change.kind, change);
      }
      previous = observation;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void flush(), debounceMs);
    },
    flush,
    dispose(): void {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      pending.clear();
    },
  };
}

export async function postPresence(change: PresenceChange): Promise<unknown> {
  const response = await fetch('/api/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change),
  });
  if (!response.ok) throw new Error(`presence report failed: ${response.status}`);
  const result = (await response.json()) as {
    seq?: unknown;
    presence?: { updatedSeq?: unknown };
  };
  const seq = result.seq ?? result.presence?.updatedSeq;
  if (Number.isSafeInteger(seq) && (seq as number) >= 0) {
    latestPresenceSequence = seq as number;
  }
  return result;
}
