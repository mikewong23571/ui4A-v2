import type { SirenAction } from '@ui4a/engine';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

/** Ephemeral retry identity only: never caches authorization, guards, versions or caller data. */
export function createActionCommandIds() {
  const attempts = new Map<string, { signature: string; commandId: string }>();
  return {
    get(
      rel: string,
      action: SirenAction,
      params: Record<string, unknown>,
      candidate: string,
    ): string {
      const key = JSON.stringify([rel, action.name]);
      const signature = JSON.stringify(canonical([action.fields, params]));
      const prior = attempts.get(key);
      if (prior?.signature === signature) return prior.commandId;
      attempts.set(key, { signature, commandId: candidate });
      return candidate;
    },
    accept(rel: string, name: string, commandId: string): void {
      const key = JSON.stringify([rel, name]);
      if (attempts.get(key)?.commandId === commandId) attempts.delete(key);
    },
  };
}
