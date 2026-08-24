import type { AuthPrivateStore } from './browser-session';

interface InMemoryAuthPrivateRecord {
  value: unknown;
  expiresAtMs: number;
}

/**
 * Process-local private browser state for the single-replica experimental deployment.
 * Restarting Web intentionally clears all login transactions and sessions.
 */
export function createInMemoryAuthPrivateStore(
  options: { clock?: () => number } = {},
): AuthPrivateStore {
  const clock = options.clock ?? Date.now;
  const records = new Map<string, InMemoryAuthPrivateRecord>();

  function liveRecord(key: string): InMemoryAuthPrivateRecord | undefined {
    const record = records.get(key);
    if (record !== undefined && record.expiresAtMs <= clock()) {
      records.delete(key);
      return undefined;
    }
    return record;
  }

  return {
    async get(key) {
      return liveRecord(key)?.value;
    },

    async put(key, value, expiresAtMs) {
      records.set(key, { value, expiresAtMs });
    },

    async take(key) {
      const record = liveRecord(key);
      records.delete(key);
      return record?.value;
    },

    async delete(key) {
      records.delete(key);
    },
  };
}
