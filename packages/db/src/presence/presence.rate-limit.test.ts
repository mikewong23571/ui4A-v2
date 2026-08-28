import { beforeEach, describe, expect, it } from 'vitest';

import { PRESENCE_MAX_EVENTS_PER_WINDOW } from '@ui4a/shared';

import {
  appendPresenceChange,
  ensurePresenceTables,
  foldPresenceEvents,
  loadPresenceSnapshot,
  PresenceRateLimitError,
  rebuildPresenceProjection,
  type PresenceEventRow,
} from './presence';
import { getPool } from '../pool';

// presence 频率上限行为测试(T31 R2 ←T29 红线"频率上限入合同测试"的 db 层):
// - 同一 principal 的窗口预算按 events(domain='presence', principal, ts>now()-1min)
//   计数,第 PRESENCE_MAX_EVENTS_PER_WINDOW+1 次不同值写入被 PresenceRateLimitError 拒绝;
// - 等值重复上报在预算计数之前短路(changed=false),不消耗也不触发预算;
// - 不同 principal 预算互相独立;
// - 窗口滑动(ts 前移出窗)后恢复写入;
// - 上限生效前后投影与纯折叠保持一致(rebuild 幂等)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const LIMIT = PRESENCE_MAX_EVENTS_PER_WINDOW;

function threadChange(index: number): { schemaVersion: 1; kind: 'thread'; value: string } {
  return { schemaVersion: 1, kind: 'thread', value: `thread:case-${index}` };
}

function identityFor(principal: string): {
  principal: string;
  actor: 'human';
  channel: string;
} {
  return { principal, actor: 'human', channel: 'test' };
}

async function fillToLimit(principal: string): Promise<void> {
  for (let index = 0; index < LIMIT; index += 1) {
    const result = await appendPresenceChange(pool, threadChange(index), identityFor(principal));
    expect(result.changed).toBe(true);
  }
}

/**
 * events 是 append-only(行级触发器拒绝 UPDATE/DELETE);验证窗口滑动需要把该
 * principal 的 ts 前移出窗,故瞬时禁用命名触发器做 SQL 前移并在 finally 恢复。
 * ensureEventsTable 每次 boot 都会重建(DROP+CREATE)该触发器,残留不可能跨文件。
 */
async function slidePrincipalWindowBack(principal: string): Promise<void> {
  await pool.query('ALTER TABLE events DISABLE TRIGGER events_append_only_trigger');
  try {
    await pool.query(
      `UPDATE events SET ts = ts - interval '2 minutes'
       WHERE domain='presence' AND principal=$1`,
      [principal],
    );
  } finally {
    await pool.query('ALTER TABLE events ENABLE TRIGGER events_append_only_trigger');
  }
}

beforeEach(async () => {
  await ensurePresenceTables(pool);
  await pool.query('TRUNCATE events, presence_current');
});

describe('presence rate limit (db behavior)', () => {
  it(
    'rejects writes beyond the per-principal window budget and leaves no partial state',
    { timeout: 60_000 },
    async () => {
      await fillToLimit('rl:cap');
      await expect(
        appendPresenceChange(pool, threadChange(LIMIT), identityFor('rl:cap')),
      ).rejects.toBeInstanceOf(PresenceRateLimitError);
      // 被拒写入整体回滚:事件数停在预算值,投影不受污染。
      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM events
         WHERE domain='presence' AND principal=$1`,
        ['rl:cap'],
      );
      expect(Number(count.rows[0]?.count ?? 0)).toBe(LIMIT);
      const snapshot = await loadPresenceSnapshot(pool);
      expect(snapshot['rl:cap']?.thread).toBe(`thread:case-${LIMIT - 1}`);
    },
  );

  it('keeps budgets independent across principals', { timeout: 60_000 }, async () => {
    await fillToLimit('rl:a');
    // 触顶的 rl:a 不影响 rl:b 的独立预算;rl:a 自身仍被拒。
    const other = await appendPresenceChange(pool, threadChange(0), identityFor('rl:b'));
    expect(other.changed).toBe(true);
    await expect(
      appendPresenceChange(pool, threadChange(LIMIT), identityFor('rl:a')),
    ).rejects.toBeInstanceOf(PresenceRateLimitError);
  });

  it(
    'short-circuits equal-value reports before they consume window budget',
    { timeout: 60_000 },
    async () => {
      await fillToLimit('rl:dup');
      // 预算已满时等值上报仍走 changed=false 短路:证明等值检查先于窗口计数,
      // 不抛限流错误、不产生事件。写值不用 site 词表(T27 改名中)。
      const duplicate = await appendPresenceChange(
        pool,
        threadChange(LIMIT - 1),
        identityFor('rl:dup'),
      );
      expect(duplicate.changed).toBe(false);
      expect(duplicate.seq).toBeUndefined();
      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM events
         WHERE domain='presence' AND principal=$1`,
        ['rl:dup'],
      );
      expect(Number(count.rows[0]?.count ?? 0)).toBe(LIMIT);
    },
  );

  it(
    'recovers writing once events slide out of the one-minute window',
    { timeout: 60_000 },
    async () => {
      await fillToLimit('rl:slide');
      await slidePrincipalWindowBack('rl:slide');
      const recovered = await appendPresenceChange(
        pool,
        threadChange(LIMIT),
        identityFor('rl:slide'),
      );
      expect(recovered.changed).toBe(true);
      expect(typeof recovered.seq).toBe('number');
    },
  );

  it(
    'keeps projection and pure fold consistent across the rate-limit boundary',
    { timeout: 60_000 },
    async () => {
      await fillToLimit('rl:foldsafe');
      await expect(
        appendPresenceChange(pool, threadChange(LIMIT), identityFor('rl:foldsafe')),
      ).rejects.toBeInstanceOf(PresenceRateLimitError);
      const rows = await pool.query<{
        seq: string | number;
        principal: string;
        kind: PresenceEventRow['kind'];
        detail: PresenceEventRow['detail'];
      }>(
        `SELECT seq, principal, kind, detail FROM events
         WHERE domain='presence' AND principal=$1 ORDER BY seq ASC`,
        ['rl:foldsafe'],
      );
      const events: PresenceEventRow[] = rows.rows.map((row) => ({
        seq: Number(row.seq),
        principal: row.principal,
        kind: row.kind,
        detail: row.detail,
      }));
      const folded = foldPresenceEvents(events)['rl:foldsafe'];
      const online = (await loadPresenceSnapshot(pool))['rl:foldsafe'];
      expect(folded).toEqual(online);
      await rebuildPresenceProjection(pool);
      const rebuilt = (await loadPresenceSnapshot(pool))['rl:foldsafe'];
      expect(rebuilt).toEqual(online);
      expect(online?.thread).toBe(`thread:case-${LIMIT - 1}`);
    },
  );
});
