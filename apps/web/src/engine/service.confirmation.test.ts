import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';
import type { LogEvent } from '@ui4a/engine';

import { businessFlows } from '../domain/flows';
import { ensureEventsTable, readLog, type DbExecutor } from '../db/events';
import { getPool } from '../db/pool';

import { getEngine, resetEngineForTests } from './service';

// 确认门服务层集成测试(T3 Phase B / Task 2,真 PG):
// - exec 走 executeWithGates(deps.policy = Cedar 策略):agent + high → 挂起
//   (confirmation-requested 落库含 Cedar 策略 id 与原因 detail);
// - 挂起是第四层裁决:三层拒绝仍先于确认门(guard/schema 拒绝不挂起);
// - approve/reject 是普通 exec(confirmation:<id> 实体上的声明动作):
//   human approve → 目标动作生效 + 事件链(委托语义:actor=human、
//   principal=提议者、channel=confirmation);agent approve → guard 拒(I4);
//   reject 带理由 → 原动作永不生效;
// - B1–B3 回归:human archive 直通不挂起;
// - 增量快照与 fold(日志) 同构(I5)。
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

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

async function logEvents(): Promise<LogEvent[]> {
  return readLog(pool);
}

/** 挂起一次 agent archive,返回确认 id(服务层矩阵测试的公共前置)。 */
async function suspendArchive(): Promise<string> {
  const engine = await getEngine(pool);
  const outcome = await engine.exec(agentArchive);
  if (outcome.kind !== 'suspended') {
    throw new Error(`预期挂起,实际 ${outcome.kind}`);
  }
  return outcome.confirmation.id;
}

describe('exec 挂起(agent + high → Cedar 拦截)', () => {
  it('suspended:动作不生效,pending 确认物化,摘录带 Cedar 原因', async () => {
    const engine = await getEngine(pool);

    const outcome = await engine.exec(agentArchive);

    expect(outcome.kind).toBe('suspended');
    if (outcome.kind !== 'suspended') return;
    expect(outcome.confirmation).toMatchObject({
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      channel: 'http',
      policyReason: expect.stringContaining('Cedar'),
    });

    // 效果不应用:文章仍是 published;确认实体 pending。
    const snapshot = engine.getSnapshot();
    expect(snapshot.instances['post:post-welcome']?.node).toBe('published');
    expect(snapshot.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'pending',
      policy: expect.stringMatching(/^cedar:/),
    });
  });

  it('confirmation-requested 落库:Cedar 策略 id 与原因入 detail(spec 验收 5)', async () => {
    const engine = await getEngine(pool);
    await engine.exec(agentArchive);

    const last = (await logEvents()).at(-1);
    expect(last).toMatchObject({
      kind: 'confirmation-requested',
      rel: 'confirmation:c1',
      action: 'archive',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });
    expect(last?.detail).toMatchObject({
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      policy: expect.stringMatching(/^cedar:/),
      policyReason: expect.stringContaining('Cedar'),
    });
  });

  it('挂起后增量快照与 fold(日志) 同构(I5)', async () => {
    const engine = await getEngine(pool);
    await engine.exec(agentArchive);

    const replayed = fold(await logEvents(), { flows: businessFlows });
    expect(contentVersion(replayed)).toBe(contentVersion(engine.getSnapshot()));
  });

  it('确认门在三层之后:schema 失败仍先拒绝,不挂起', async () => {
    const engine = await getEngine(pool);
    // archive 声明了 high 标注,但多余参数在 schema 层就被拒(严格拒绝多余参数)
    // ——三层裁决先于确认门,挂起只发生在三层全过之后。
    const outcome = await engine.exec({
      rel: 'post:post-welcome',
      action: 'archive',
      params: { bogus: 1 },
      actor: 'agent',
    });

    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    expect(engine.getSnapshot().confirmations).toEqual({});
    expect(engine.getSnapshot().instances['post:post-welcome']?.node).toBe('published');
  });
});

describe('human approve(经普通 exec)', () => {
  it('rolls back every core event when a multi-event decision append fails', async () => {
    let armed = false;
    const shouldFail = (sqlText: string, values?: readonly unknown[]): boolean =>
      armed &&
      sqlText.includes('INSERT INTO events') &&
      values?.[3] === 'action-executed' &&
      values?.[4] === 'post:post-welcome' &&
      values?.[5] === 'archive';
    const failingDb = {
      query: async (sqlText: string, values?: readonly unknown[]) => {
        if (shouldFail(sqlText, values)) throw new Error('simulated append crash');
        return pool.query(sqlText, values as unknown[] | undefined);
      },
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sqlText: string, values?: readonly unknown[]) => {
            if (shouldFail(sqlText, values)) throw new Error('simulated append crash');
            return client.query(sqlText, values as unknown[] | undefined);
          },
          release: () => client.release(),
        };
      },
    } as unknown as DbExecutor;
    const engine = await getEngine(failingDb);
    const suspended = await engine.exec(agentArchive);
    expect(suspended.kind).toBe('suspended');
    armed = true;

    await expect(
      engine.exec({
        rel: 'confirmation:c1',
        action: 'approve',
        params: {},
        actor: 'human',
        principal: 'user:approver',
      }),
    ).rejects.toThrow('simulated append crash');

    const afterFailure = await logEvents();
    expect(
      afterFailure.filter(
        ({ kind, rel }) => kind === 'confirmation-approved' && rel === 'confirmation:c1',
      ),
    ).toHaveLength(0);
    expect(
      afterFailure.filter(
        ({ kind, rel, action }) =>
          kind === 'action-executed' && rel === 'post:post-welcome' && action === 'archive',
      ),
    ).toHaveLength(0);

    resetEngineForTests();
    const restarted = await getEngine(pool);
    expect(restarted.getSnapshot().confirmations?.['confirmation:c1']?.status).toBe('pending');
    expect(restarted.getSnapshot().instances['post:post-welcome']?.node).toBe('published');
  });

  it('同一 pending confirmation 并发 approve/reject:恰一终态、一拒绝且重放一致', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);

    const outcomes = await Promise.all([
      engine.exec({
        rel: `confirmation:${id}`,
        action: 'approve',
        params: {},
        actor: 'human',
        principal: 'user:approver',
      }),
      engine.exec({
        rel: `confirmation:${id}`,
        action: 'reject',
        params: { reason: 'concurrent rejection' },
        actor: 'human',
        principal: 'user:approver',
      }),
    ]);

    expect(outcomes.filter(({ kind }) => kind === 'accepted')).toHaveLength(1);
    expect(outcomes.filter(({ kind }) => kind === 'rejected')).toHaveLength(1);
    const events = await logEvents();
    expect(
      events.filter(
        ({ kind }) => kind === 'confirmation-approved' || kind === 'confirmation-rejected',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(({ kind, rel }) => kind === 'action-rejected' && rel === `confirmation:${id}`),
    ).toHaveLength(1);
    expect(engine.getSnapshot().confirmations?.[`confirmation:${id}`]?.status).toMatch(
      /approved|rejected/,
    );
    expect(contentVersion(engine.getSnapshot())).toBe(
      contentVersion(fold(events, { flows: businessFlows })),
    );
  });

  it('approve → 目标动作生效,事件链 confirmation-approved + action-executed(委托语义)', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);

    const outcome = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'approve',
      params: {},
      actor: 'human',
      channel: 'http',
    });

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    // 受影响实体 = 目标文章(已归档)。
    expect(outcome.entity.properties).toMatchObject({
      rel: 'post:post-welcome',
      node: 'archived',
    });

    expect(engine.getSnapshot().instances['post:post-welcome']?.node).toBe('archived');
    expect(engine.getSnapshot().confirmations?.[`confirmation:${id}`]?.status).toBe('approved');

    // 事件链:approved(链:proposed-by agent / decided-by human)→ executed
    // (actor=human、principal=提议者 principal、channel=confirmation)。
    const tail = (await logEvents()).slice(-2);
    expect(tail.map((event) => event.kind)).toEqual(['confirmation-approved', 'action-executed']);
    expect(tail[0]).toMatchObject({
      rel: `confirmation:${id}`,
      action: 'approve',
      actor: 'human',
      channel: 'confirmation',
    });
    expect(tail[0]?.detail).toMatchObject({
      id,
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      decidedBy: { actor: 'human' },
    });
    expect(tail[1]).toMatchObject({
      rel: 'post:post-welcome',
      action: 'archive',
      actor: 'human',
      principal: 'user:mike',
      channel: 'confirmation',
    });
  });

  it('approve 后重放一致(增量与 fold 同构,I5)', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);
    await engine.exec({ rel: `confirmation:${id}`, action: 'approve', params: {}, actor: 'human' });

    const replayed = fold(await logEvents(), { flows: businessFlows });
    expect(contentVersion(replayed)).toBe(contentVersion(engine.getSnapshot()));
  });

  it('对非 pending 确认重复 approve → undeclared 拒绝且留痕', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);
    await engine.exec({ rel: `confirmation:${id}`, action: 'approve', params: {}, actor: 'human' });

    const outcome = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'approve',
      params: {},
      actor: 'human',
    });

    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    expect((await logEvents()).at(-1)).toMatchObject({ kind: 'action-rejected' });
  });
});

describe('I4:agent 身份的审批被 guard 拒绝', () => {
  it('agent approve → guard-failed(actor-is-human),确认仍 pending,留痕', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);

    const outcome = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'approve',
      params: {},
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });

    expect(outcome).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      reason: expect.stringContaining('actor-is-human'),
    });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.detail).toEqual([
      expect.objectContaining({ name: 'actor-is-human', pass: false }),
    ]);

    // 动作不生效,确认仍 pending,事件留痕。
    const snapshot = engine.getSnapshot();
    expect(snapshot.instances['post:post-welcome']?.node).toBe('published');
    expect(snapshot.confirmations?.[`confirmation:${id}`]?.status).toBe('pending');
    expect((await logEvents()).at(-1)).toMatchObject({
      kind: 'action-rejected',
      rel: `confirmation:${id}`,
      action: 'approve',
      actor: 'agent',
    });
  });
});

describe('reject(带必填 reason)', () => {
  it('human reject → 原动作永不生效,confirmation-rejected 留痕', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);

    const outcome = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'reject',
      params: { reason: '这篇文章还要留着' },
      actor: 'human',
      channel: 'http',
    });

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    // 受影响实体 = 确认实体自身(rejected 审计视图)。
    expect(outcome.entity.properties).toMatchObject({ status: 'rejected' });

    expect(engine.getSnapshot().instances['post:post-welcome']?.node).toBe('published');
    expect(engine.getSnapshot().confirmations?.[`confirmation:${id}`]?.status).toBe('rejected');

    const last = (await logEvents()).at(-1);
    expect(last).toMatchObject({
      kind: 'confirmation-rejected',
      rel: `confirmation:${id}`,
      action: 'reject',
      actor: 'human',
      reason: '这篇文章还要留着',
    });
    expect(last?.detail).toMatchObject({
      id,
      decidedBy: { actor: 'human' },
      reason: '这篇文章还要留着',
    });
  });

  it('reject 后 approve 同一确认 → undeclared(终态不可再审批)', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);
    await engine.exec({
      rel: `confirmation:${id}`,
      action: 'reject',
      params: { reason: '不需要' },
      actor: 'human',
    });

    const outcome = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'approve',
      params: {},
      actor: 'human',
    });

    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    expect(engine.getSnapshot().instances['post:post-welcome']?.node).toBe('published');
  });

  it('缺 reason / 空 reason → schema-invalid 拒绝且留痕', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);

    const missing = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'reject',
      params: {},
      actor: 'human',
    });
    expect(missing).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });

    const empty = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'reject',
      params: { reason: '' },
      actor: 'human',
    });
    expect(empty).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });

    // 确认仍 pending(两次失败审批不消耗状态)。
    expect(engine.getSnapshot().confirmations?.[`confirmation:${id}`]?.status).toBe('pending');
    expect((await logEvents()).filter((event) => event.kind === 'action-rejected')).toHaveLength(2);
  });
});

describe('确认实体的声明层', () => {
  it('未知确认 id → undeclared', async () => {
    const engine = await getEngine(pool);
    const outcome = await engine.exec({
      rel: 'confirmation:nope',
      action: 'approve',
      params: {},
      actor: 'human',
    });
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });

  it('确认实体上未声明的动作 → undeclared 留痕', async () => {
    const id = await suspendArchive();
    const engine = await getEngine(pool);
    const outcome = await engine.exec({
      rel: `confirmation:${id}`,
      action: 'escalate',
      params: {},
      actor: 'human',
    });
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    expect((await logEvents()).at(-1)).toMatchObject({ kind: 'action-rejected' });
  });
});

describe('B1–B3 语义回归(确认门不改变既有路径)', () => {
  it('human archive(high)→ 直通 accepted,不挂起(B2)', async () => {
    const engine = await getEngine(pool);
    const outcome = await engine.exec({
      rel: 'post:post-welcome',
      action: 'archive',
      params: {},
      actor: 'human',
    });

    expect(outcome.kind).toBe('accepted');
    expect(engine.getSnapshot().instances['post:post-welcome']?.node).toBe('archived');
    expect(engine.getSnapshot().confirmations).toEqual({});
  });

  it('agent 无标注动作(unpublish)→ 直通(B2/B3)', async () => {
    const engine = await getEngine(pool);
    const outcome = await engine.exec({
      rel: 'post:post-welcome',
      action: 'unpublish',
      params: {},
      actor: 'agent',
    });
    expect(outcome.kind).toBe('accepted');
    expect(engine.getSnapshot().instances['post:post-welcome']?.node).toBe('offline');
    expect(engine.getSnapshot().confirmations).toEqual({});
  });

  it('挂起路径不污染既有 exec:B1 向导照常', async () => {
    await suspendArchive();
    const engine = await getEngine(pool);

    for (const [params] of [
      [{ title: 'New Article' }],
      [{ category: 'tech', tags: 'ui4a' }],
      [{ body: '正文内容' }],
    ] as const) {
      const outcome = await engine.exec({
        rel: 'article-drafting:main',
        action: 'next',
        params,
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      });
      expect(outcome.kind).toBe('accepted');
    }

    const publish = await engine.exec({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: 'New Article' },
      actor: 'agent',
      principal: 'user:mike',
    });
    expect(publish.kind).toBe('accepted');
    expect(engine.getSnapshot().collections.articles).toHaveLength(3);
  });
});
