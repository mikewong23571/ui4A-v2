import type { AuthPrivateStore } from '../auth/browser-session';

import type { DbExecutor } from './events';

interface AuthPrivateRecordRow {
  payload: unknown;
}

export interface PostgresAuthPrivateStore extends AuthPrivateStore {
  cleanupExpired(): Promise<number>;
}

/**
 * Migration-owned schema for opaque browser login transactions and sessions.
 * Runtime store construction and request methods intentionally never execute this DDL.
 */
export const AUTH_PRIVATE_STORE_DDL = `
CREATE TABLE IF NOT EXISTS auth_private_records (
  record_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_private_records_expires_at_idx
  ON auth_private_records (expires_at);
`;

/** PostgreSQL-backed private auth state. This table is not part of the business event log. */
export function createPostgresAuthPrivateStore(
  db: DbExecutor,
  options: { clock(): number },
): PostgresAuthPrivateStore {
  const currentTime = () => new Date(options.clock());

  return {
    async get(key) {
      const result = await db.query<AuthPrivateRecordRow>(
        `SELECT payload
           FROM auth_private_records
          WHERE record_key = $1
            AND expires_at > $2`,
        [key, currentTime()],
      );
      return result.rows[0]?.payload;
    },

    async put(key, value, expiresAtMs) {
      await db.query(
        `INSERT INTO auth_private_records (record_key, payload, expires_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (record_key) DO UPDATE
               SET payload = EXCLUDED.payload,
                   expires_at = EXCLUDED.expires_at`,
        [key, JSON.stringify(value), new Date(expiresAtMs)],
      );
    },

    async take(key) {
      const result = await db.query<AuthPrivateRecordRow>(
        `DELETE FROM auth_private_records
          WHERE record_key = $1
            AND expires_at > $2
        RETURNING payload`,
        [key, currentTime()],
      );
      return result.rows[0]?.payload;
    },

    async delete(key) {
      await db.query('DELETE FROM auth_private_records WHERE record_key = $1', [key]);
    },

    async cleanupExpired() {
      const result = await db.query('DELETE FROM auth_private_records WHERE expires_at <= $1', [
        currentTime(),
      ]);
      return result.rowCount ?? 0;
    },
  };
}
