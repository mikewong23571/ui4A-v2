import type { AuthPrivateStore } from './browser-session';

interface InMemoryAuthPrivateRecord {
  value: unknown;
  expiresAtMs: number;
}

export const AUTH_PRIVATE_STORE_MAX_ENTRIES = 4_096;

export class AuthPrivateStoreCapacityError extends Error {
  readonly code = 'auth_private_store_capacity_exceeded';

  constructor() {
    super('auth_private_store_capacity_exceeded');
    this.name = 'AuthPrivateStoreCapacityError';
  }
}

/**
 * Process-local private browser state for the single-replica experimental deployment.
 * Restarting Web intentionally clears all login transactions and sessions.
 */
export function createInMemoryAuthPrivateStore(
  options: { clock?: () => number; maxEntries?: number } = {},
): AuthPrivateStore {
  const clock = options.clock ?? Date.now;
  const maxEntries = options.maxEntries ?? AUTH_PRIVATE_STORE_MAX_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new TypeError('auth_private_store_max_entries_invalid');
  }
  const records = new Map<string, InMemoryAuthPrivateRecord>();

  function sweepExpired(): void {
    const now = clock();
    for (const [key, record] of records) {
      if (record.expiresAtMs <= now) records.delete(key);
    }
  }

  return {
    async get(key) {
      sweepExpired();
      return records.get(key)?.value;
    },

    async put(key, value, expiresAtMs) {
      sweepExpired();
      if (!records.has(key) && records.size >= maxEntries) {
        throw new AuthPrivateStoreCapacityError();
      }
      records.set(key, { value, expiresAtMs });
    },

    async take(key) {
      sweepExpired();
      const record = records.get(key);
      records.delete(key);
      return record?.value;
    },

    async delete(key) {
      sweepExpired();
      records.delete(key);
    },
  };
}
