import {
  applySidecarCommand,
  foldPresentationEvents,
  sidecarKeyFingerprint,
  type PresentationSidecarEvent,
  type PresentationSnapshot,
  type SidecarCommand,
  type UserSidecarAggregate,
  type UserSidecarKey,
} from '@ui4a/engine';
import type { PoolClient } from 'pg';

import { appendEvent, ensureEventsTable, type DbExecutor } from './events';

export const PRESENTATION_DDL = `
CREATE TABLE IF NOT EXISTS presentation_user_sidecars (
  sidecar_id       TEXT PRIMARY KEY,
  key_fingerprint  TEXT NOT NULL,
  principal        TEXT NOT NULL,
  -- policy_scope:T33(D51) 起 durable 键无 scope 维度,本列停用——仅写入空串
  -- 占位以满足 NOT NULL,读取侧不再参与任何查询/判定。投影可重建,无需迁移。
  policy_scope     TEXT NOT NULL,
  subject          JSONB NOT NULL,
  intent           TEXT NOT NULL,
  device_class     TEXT NOT NULL,
  retention        TEXT NOT NULL,
  status           TEXT NOT NULL,
  active_version   INTEGER NOT NULL,
  max_version      INTEGER NOT NULL,
  aggregate        JSONB NOT NULL,
  updated_seq      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS presentation_user_sidecars_lookup
  ON presentation_user_sidecars
  (principal, policy_scope, key_fingerprint, intent, device_class, retention);

CREATE UNIQUE INDEX IF NOT EXISTS presentation_event_id_unique
  ON events ((detail->>'eventId'))
  WHERE domain = 'presentation' AND detail ? 'eventId';

CREATE UNIQUE INDEX IF NOT EXISTS presentation_command_id_unique
  ON events ((detail->>'commandId'))
  WHERE domain = 'presentation' AND kind LIKE 'user-sidecar-%' AND detail ? 'commandId';
`;

interface ConnectableDb extends DbExecutor {
  connect?: () => Promise<PoolClient>;
}

async function withTransaction<T>(
  db: ConnectableDb,
  run: (client: DbExecutor) => Promise<T>,
): Promise<T> {
  const acquired = db.connect === undefined ? db : await db.connect();
  const client = acquired as DbExecutor;
  await client.query('BEGIN');
  try {
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if ('release' in acquired && typeof acquired.release === 'function') acquired.release();
  }
}

export async function ensurePresentationTables(db: DbExecutor): Promise<void> {
  await ensureEventsTable(db);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740934)');
    await db.query(PRESENTATION_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function presentationEvents(db: DbExecutor): Promise<PresentationSidecarEvent[]> {
  const result = await db.query<{ detail: PresentationSidecarEvent }>(
    `SELECT detail FROM events
     WHERE domain = 'presentation' AND kind LIKE 'user-sidecar-%'
     ORDER BY seq ASC`,
  );
  return result.rows.map(({ detail }) => detail);
}

export async function loadPresentationSnapshot(db: DbExecutor): Promise<PresentationSnapshot> {
  return foldPresentationEvents(await presentationEvents(db));
}

function retentionOf(aggregate: UserSidecarAggregate): 'cache' | 'pinned' {
  return aggregate.versions[aggregate.activeVersion]?.retention ?? 'cache';
}

async function upsertAggregate(
  db: DbExecutor,
  aggregate: UserSidecarAggregate,
  updatedSeq: number,
): Promise<void> {
  await db.query(
    `INSERT INTO presentation_user_sidecars
       (sidecar_id,key_fingerprint,principal,policy_scope,subject,intent,device_class,
        retention,status,active_version,max_version,aggregate,updated_seq)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     ON CONFLICT (sidecar_id) DO UPDATE SET
       key_fingerprint=EXCLUDED.key_fingerprint,
       principal=EXCLUDED.principal,
       policy_scope=EXCLUDED.policy_scope,
       subject=EXCLUDED.subject,
       intent=EXCLUDED.intent,
       device_class=EXCLUDED.device_class,
       retention=EXCLUDED.retention,
       status=EXCLUDED.status,
       active_version=EXCLUDED.active_version,
       max_version=EXCLUDED.max_version,
       aggregate=EXCLUDED.aggregate,
       updated_seq=EXCLUDED.updated_seq`,
    [
      aggregate.id,
      sidecarKeyFingerprint(aggregate.key),
      aggregate.key.principal,
      // D51:policy_scope 列停用,恒写空串占位(NOT NULL),不再承载键维度。
      '',
      JSON.stringify(aggregate.key.subject),
      aggregate.key.intent,
      aggregate.key.deviceClass,
      retentionOf(aggregate),
      aggregate.stale === undefined ? 'active' : 'stale',
      aggregate.activeVersion,
      aggregate.maxVersion,
      JSON.stringify(aggregate),
      updatedSeq,
    ],
  );
}

export async function appendSidecarCommand(
  db: ConnectableDb,
  command: SidecarCommand,
): Promise<{ aggregate: UserSidecarAggregate; event?: PresentationSidecarEvent; seq?: number }> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      command.sidecarId,
    ]);
    const snapshot = await loadPresentationSnapshot(client);
    if (command.kind === 'instantiate' && snapshot.sidecars[command.sidecarId] !== undefined) {
      return { aggregate: snapshot.sidecars[command.sidecarId]! };
    }
    const result = applySidecarCommand(snapshot, command);
    if (result.events.length === 0) {
      const aggregate = snapshot.sidecars[command.sidecarId];
      if (aggregate === undefined) throw new Error('deduplicated sidecar command has no aggregate');
      return { aggregate };
    }
    const event = result.events[0]!;
    const owner = result.snapshot.sidecars[command.sidecarId]!;
    const appended = await appendEvent(client, {
      domain: 'presentation',
      kind: event.kind,
      rel: `user-sidecar:${command.sidecarId}`,
      principal: owner.key.principal,
      channel: 'presentation',
      detail: event,
    });
    await upsertAggregate(client, owner, appended.seq);
    return { aggregate: owner, event, seq: appended.seq };
  });
}

export async function findActiveSidecar(
  db: DbExecutor,
  key: UserSidecarKey,
): Promise<UserSidecarAggregate | undefined> {
  // D51:durable 键无 scope 维度;policy_scope 列已停用,查询不读它。
  const result = await db.query<{ aggregate: UserSidecarAggregate }>(
    `SELECT aggregate FROM presentation_user_sidecars
     WHERE principal=$1 AND key_fingerprint=$2
       AND subject=$3::jsonb AND intent=$4 AND device_class=$5 AND status='active'
     ORDER BY CASE retention WHEN 'pinned' THEN 0 ELSE 1 END, active_version DESC
     LIMIT 1`,
    [
      key.principal,
      sidecarKeyFingerprint(key),
      JSON.stringify(key.subject),
      key.intent,
      key.deviceClass,
    ],
  );
  return result.rows[0]?.aggregate;
}

export async function getSidecarById(
  db: DbExecutor,
  sidecarId: string,
  principal: string,
): Promise<UserSidecarAggregate | undefined> {
  const result = await db.query<{ aggregate: UserSidecarAggregate }>(
    `SELECT aggregate FROM presentation_user_sidecars
     WHERE sidecar_id=$1 AND principal=$2 AND status='active'`,
    [sidecarId, principal],
  );
  return result.rows[0]?.aggregate;
}

export async function rebuildPresentationProjection(db: ConnectableDb): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740935)');
    const snapshot = await loadPresentationSnapshot(client);
    await client.query('DELETE FROM presentation_user_sidecars');
    const seqResult = await client.query<{ seq: string | number | null }>(
      `SELECT max(seq) AS seq FROM events WHERE domain='presentation'`,
    );
    const updatedSeq = Number(seqResult.rows[0]?.seq ?? 0);
    for (const aggregate of Object.values(snapshot.sidecars)) {
      await upsertAggregate(client, aggregate, updatedSeq);
    }
  });
}
