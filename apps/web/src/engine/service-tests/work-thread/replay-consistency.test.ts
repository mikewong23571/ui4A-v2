import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';
import { ensureEventsTable, listEvents, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { businessFlows } from '../../../domain/flows';
import { getEngine, resetEngineForTests } from '../../service';

/**
 * Work Thread 派生投影的重放一致性(T56 P1.3 A5;FR10/G1 I5 口径)。
 *
 * 成员卡(thread-reference)与 version:1 认知声明是纯投影:全部字段可从事件日志
 * 重建,不写进事件(零新事件种类)。在线路径 = engine.exec → applyEffects →
 * appendEvent → 增量快照;重放路径 = fold(全量日志)与重启 boot 同构。断言:
 * 1. 在线快照与 fold 快照内容 hash 相等(fold 对未知 kind 抛错 → 零新事件种类的
 *    机械守卫);
 * 2. 重启后的成员卡/声明投影与在线读取深度一致(派生卡不丢不重、不依赖进程内状态)。
 */

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test');
const RUN = randomUUID().slice(0, 8);
const OWNER = 'user:t56p13-owner';
const GOAL = '完成一项跨应用评审并记录决定';

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

async function execAccepted(rel: string, action: string, params: Record<string, unknown> = {}) {
  const engine = await getEngine(pool);
  const outcome = await engine.exec({
    rel,
    action,
    params,
    actor: 'human',
    principal: OWNER,
    channel: 'http',
  });
  if (outcome.kind !== 'accepted') {
    throw new Error(`${rel}.${action} 预期 accepted,实际 ${outcome.kind}`);
  }
}

/** agent 发起一次 high 确认动作并挂起,返回 confirmation rel。 */
async function suspendArchive(rel: string): Promise<string> {
  const engine = await getEngine(pool);
  const outcome = await engine.exec({
    rel,
    action: 'archive',
    params: {},
    actor: 'agent',
    principal: OWNER,
    channel: 'http',
  });
  if (outcome.kind !== 'suspended') {
    throw new Error(`${rel}.archive 预期 suspended,实际 ${outcome.kind}`);
  }
  return `confirmation:${outcome.confirmation.id}`;
}

async function buildThreadFixture(): Promise<string> {
  const threadId = `t56p13-r-${RUN}`;
  await execAccepted('threads', 'create', {
    commandId: threadId,
    goal: GOAL,
  });
  const pendingApprovalRel = await suspendArchive('post:post-welcome');
  const attach = (category: string, rel: string): Promise<void> =>
    execAccepted(`thread:${threadId}`, 'attach', { category, rel });
  await attach('context', 'post:first-post');
  await attach('context', 'comment:c2');
  await attach('active', 'software-change:main');
  await attach('approval', pendingApprovalRel);
  const log = await readLog(pool);
  const created = log.find(
    (event) => event.kind === 'thread-created' && event.rel === `thread:${threadId}`,
  );
  if (created === undefined) throw new Error('fixture 缺 thread-created 事件');
  await attach('event', `event:${created.seq}`);
  return `thread:${threadId}`;
}

describe('Work Thread 重放一致性(P1.3;FR10/G1)', () => {
  it('成员卡与认知声明从事件日志重建:fold 快照 hash 一致,重启后投影深度一致,零新事件种类', async () => {
    const threadRel = await buildThreadFixture();
    const engine = await getEngine(pool);
    const onlineEntity = await engine.getEntity(threadRel);
    expect(onlineEntity).toBeDefined();
    const onlineSnapshot = await engine.readSnapshot();
    const log = await readLog(pool);

    // 零新事件种类:全量日志经业务 fold(未知 kind 抛错)不抛 = 事件种类全部在
    // 既有词表内;且呈现域事件零写入(本投影不落日志)。
    const replayed = fold(log, { flows: businessFlows });
    expect(contentVersion(replayed)).toBe(contentVersion(onlineSnapshot));
    expect((await listEvents(pool)).filter((event) => event.domain === 'presentation')).toEqual([]);

    // 重启路径(生产 restart 语义)重建出的投影与在线读取深度一致——成员卡序、
    // 角色类别、责任卡动作与 version:1 声明全部可重建。
    resetEngineForTests();
    const restarted = await getEngine(pool);
    const replayedEntity = await restarted.getEntity(threadRel);
    expect(replayedEntity).toEqual(onlineEntity);
    const memberViews = (replayedEntity!.entities ?? []).map((member) => ({
      rel: (member.properties as { rel?: unknown }).rel,
      class: member.class,
      category: (member.properties as { category?: unknown }).category,
      identity: (member.properties as { identity?: unknown }).identity,
      status: (member.properties as { status?: unknown }).status,
      actions: member.actions.map((action) => action.name),
    }));
    expect(memberViews).toHaveLength(4);
    expect(memberViews).toEqual([
      {
        rel: 'post:first-post',
        class: ['thread-reference'],
        category: 'context',
        identity: '第一篇',
        status: 'published',
        actions: [],
      },
      {
        rel: 'comment:c2',
        class: ['thread-reference'],
        category: 'context',
        identity: 'comment:c2',
        status: 'pending',
        actions: [],
      },
      {
        rel: 'software-change:main',
        class: ['thread-reference'],
        category: 'active',
        identity: 'software-change:main',
        status: 'implementation-ready',
        actions: [],
      },
      {
        rel: expect.any(String),
        class: ['thread-reference'],
        category: 'approval',
        identity: 'archive · 由 agent 提议',
        status: 'pending',
        actions: ['approve', 'reject'],
      },
    ]);
    const presentation = replayedEntity!.properties.presentation as Record<string, unknown>;
    expect(presentation.version).toBe(1);
    expect(presentation.traits).toEqual(['human-responsibility', 'work-queue']);
    expect(presentation.groupRole).toBe('responsibility');
    expect(presentation.emptyMeaning).toBe('ready-to-start');
  });
});
