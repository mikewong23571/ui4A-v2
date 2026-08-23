import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';

import { businessFlows } from '../domain/flows';
import { ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';
import { deliverNotification } from '../../../worker/src/activities';

import { getEngine, resetEngineForTests } from './service';

// 双写一致性集成测试(T3 Phase C / Task 2,真 PG;spec 架构决定 4):
// worker 是事件日志的第二写者(直接 appendEvent 到同一 PG),web 读路径
// (getEntity/readSnapshot)在返回前按 seq 检查新事件并增量 fold——
// 外部追加的事件**不需重启**立即可见;与 web 自身 exec 交错不损坏快照(I5)。
const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);

const agentArchive = {
  rel: 'post:post-welcome',
  action: 'archive',
  params: {},
  actor: 'agent' as const,
  principal: 'user:mike',
  channel: 'http',
};

/** worker 写侧的确认摘要(与 dispatchNotify 派发的 payload 同构)。 */
const confirmationForNotify = {
  id: 'c1',
  targetRel: 'post:post-welcome',
  targetAction: 'archive',
  proposedBy: { actor: 'agent' as const, principal: 'user:mike' },
  reason: 'Cedar: high 风险动作且 actor=agent,需人类确认',
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('双写一致性:worker 侧 appendEvent 后 web 读路径立即可见', () => {
  it('getEntity 增量 fold worker 的 notification-delivered:inbox delivered 计数 + confirmation notified(不需重启)', async () => {
    const engine = await getEngine(pool);
    await engine.exec(agentArchive); // web 写:confirmation-requested(c1 挂起)
    // worker 写:同一 PG 直接送达(真 worker 代码路径 deliverNotification)。
    await deliverNotification(pool, confirmationForNotify);

    const inbox = await engine.getEntity('inbox');
    expect(inbox?.properties).toMatchObject({ count: 1, delivered: 1 });
    const item = inbox?.entities?.[0];
    expect(item?.properties).toMatchObject({
      id: 'c1',
      'target-action': 'archive',
      notified: true,
    });

    const confirmation = await engine.getEntity('confirmation:c1');
    expect(confirmation?.properties).toMatchObject({ status: 'pending', notified: true });
  });

  it('readSnapshot 同样反映外部追加(notified 标记入快照)', async () => {
    const engine = await getEngine(pool);
    await engine.exec(agentArchive);
    // 外部追加前:快照无 notified。
    expect(
      (await engine.readSnapshot()).confirmations?.['confirmation:c1']?.notified,
    ).toBeUndefined();

    await deliverNotification(pool, confirmationForNotify);
    expect((await engine.readSnapshot()).confirmations?.['confirmation:c1']?.notified).toBe(true);
  });

  it('外部追加后继续 exec:lastSeq 不双算,终态与 fold(日志) 同构(I5 跨写者)', async () => {
    const engine = await getEngine(pool);
    await engine.exec(agentArchive); // web 写(seq 1-2:seed 略,c1 挂起)
    await deliverNotification(pool, confirmationForNotify); // worker 写
    await engine.getEntity('inbox'); // 触发增量 fold(消费 worker 事件)

    const approved = await engine.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      params: {},
      actor: 'human',
    });
    expect(approved.kind).toBe('accepted');

    const snapshot = await engine.readSnapshot();
    expect(snapshot.instances['post:post-welcome']?.node).toBe('archived');
    expect(snapshot.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'approved',
      notified: true,
    });
    expect(contentVersion(fold(await readLog(pool), { flows: businessFlows }))).toBe(
      contentVersion(snapshot),
    );
  });

  it('并发读写交错:并行 getEntity/readSnapshot/exec 全部完成,终态与 fold 一致(串行队列不损坏)', async () => {
    const engine = await getEngine(pool);
    await engine.exec(agentArchive);
    await deliverNotification(pool, confirmationForNotify);

    const settled = await Promise.allSettled([
      engine.getEntity('inbox'),
      engine.getEntity('confirmation:c1'),
      engine.readSnapshot(),
      engine.exec({ rel: 'post:post-welcome', action: 'unpublish', params: {}, actor: 'agent' }),
      engine.getEntity('articles'),
    ]);
    for (const result of settled) {
      expect(result.status).toBe('fulfilled');
    }

    const snapshot = await engine.readSnapshot();
    expect(snapshot.instances['post:post-welcome']?.node).toBe('offline');
    expect(snapshot.confirmations?.['confirmation:c1']?.notified).toBe(true);
    expect(contentVersion(fold(await readLog(pool), { flows: businessFlows }))).toBe(
      contentVersion(snapshot),
    );
  });
});
