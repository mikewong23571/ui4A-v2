import { beforeEach, describe, expect, it } from 'vitest';

import { delegationRel } from '@ui4a/engine';

import { appendEvent, ensureEventsTable, type DbExecutor } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { GET as listDelegations } from './route';
import { GET as getDelegationDetail } from './[id]/route';

// /api/delegations 列表/详情合同测试(T5 Phase B / Task 1)。
// 数据源:**事件日志为唯一真相**(engine fold 增量投影;单写者、可重放)——
// Temporal client 只在 dispatch 路径使用,读路径零依赖(可独立于 Temporal 服务)。
// worker 写入的委托事件族 → /api/delegations 聚合舰队行;/api/delegations/<id>
// 返回 goal/status/steps/successes/summary + 事件流轨迹(messages 与 inline 等价,
// 等价性由 projection.test.ts 直接对拍保证,此处验合同形状与真实 PG 装配)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

/** 模拟 worker 写入的完整委托事件族(发布目标 4 步:导航+next+publish+done)。 */
async function appendCompletedDelegation(db: DbExecutor, id: string): Promise<void> {
  const rel = delegationRel(id);
  await appendEvent(db, {
    kind: 'delegation-started',
    rel,
    actor: 'agent',
    principal: 'user:mike',
    channel: 'delegation',
    detail: {
      delegationId: id,
      goal: { verb: '发布一篇文章', fields: { title: '舰队首航' } },
      driverKind: 'rule',
      startRel: 'articles',
      principal: 'user:mike',
    },
  });
  await appendEvent(db, {
    kind: 'delegation-step',
    rel,
    actor: 'agent',
    channel: 'delegation',
    detail: { step: 1, op: { kind: 'navigate', rel: 'articles' }, outcome: 'navigated' },
  });
  await appendEvent(db, {
    kind: 'delegation-step',
    rel,
    actor: 'agent',
    channel: 'delegation',
    detail: {
      step: 2,
      op: { kind: 'exec', action: 'next', params: { title: '舰队首航' } },
      outcome: 'executed',
    },
  });
  await appendEvent(db, {
    kind: 'delegation-step',
    rel,
    actor: 'agent',
    channel: 'delegation',
    detail: { step: 3, op: { kind: 'exec', action: 'publish' }, outcome: 'executed' },
  });
  await appendEvent(db, {
    kind: 'delegation-step',
    rel,
    actor: 'agent',
    channel: 'delegation',
    detail: { step: 4, op: { kind: 'done', summary: '目标完成: publish 已成功' }, outcome: 'done' },
  });
  await appendEvent(db, {
    kind: 'delegation-completed',
    rel,
    actor: 'agent',
    principal: 'user:mike',
    channel: 'delegation',
    detail: { steps: 4, successes: 2, summary: '目标完成: publish 已成功' },
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('GET /api/delegations(舰队列表:事件日志聚合)', () => {
  it('空舰队:200 空列表(集合恒可投影,非 404)', async () => {
    const response = await listDelegations();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delegations: [] });
  });

  it('completed + running 并存:两行,含 status/steps/successes/summary(时间无关摘要)', async () => {
    await appendCompletedDelegation(pool, 'wf-a');
    await appendEvent(pool, {
      kind: 'delegation-started',
      rel: delegationRel('wf-b'),
      actor: 'agent',
      channel: 'delegation',
      detail: { delegationId: 'wf-b', goal: { verb: '审核' }, driverKind: 'rule', startRel: 'comments' },
    });
    await appendEvent(pool, {
      kind: 'delegation-step',
      rel: delegationRel('wf-b'),
      actor: 'agent',
      channel: 'delegation',
      detail: { step: 1, op: { kind: 'navigate', rel: 'comments' }, outcome: 'navigated' },
    });

    const response = await listDelegations();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      delegations: {
        id: string;
        goal: Record<string, unknown>;
        status: string;
        steps: number;
        successes: number;
        summary?: string;
      }[];
    };
    expect(body.delegations).toHaveLength(2);
    const byId = new Map(body.delegations.map((row) => [row.id, row]));
    expect(byId.get('wf-a')).toEqual({
      id: 'wf-a',
      goal: { verb: '发布一篇文章', fields: { title: '舰队首航' } },
      status: 'completed',
      steps: 4,
      successes: 2,
      summary: '目标完成: publish 已成功',
    });
    expect(byId.get('wf-b')).toMatchObject({ status: 'running', steps: 1, successes: 0 });
  });
});

describe('GET /api/delegations/[id](详情:实体快照 + 事件流轨迹)', () => {
  function detailRequest(id: string): Request {
    return new Request(`http://localhost:3100/api/delegations/${encodeURIComponent(id)}`);
  }

  it('completed 委托:goal/status/计数/summary + trail + messages(与 inline 语义等价)', async () => {
    await appendCompletedDelegation(pool, 'wf-a');

    const response = await getDelegationDetail(detailRequest('wf-a'), {
      params: Promise.resolve({ id: 'wf-a' }),
    });
    expect(response.status).toBe(200);
    const detail = (await response.json()) as {
      id: string;
      goal: Record<string, unknown>;
      status: string;
      steps: number;
      successes: number;
      summary: string;
      driverKind: string;
      startRel: string;
      principal: string;
      trail: { step: number; rel: string; outcome: string }[];
      messages: { role: string; text: string }[];
    };
    expect(detail).toMatchObject({
      id: 'wf-a',
      goal: { verb: '发布一篇文章' },
      status: 'completed',
      steps: 4,
      successes: 2,
      summary: '目标完成: publish 已成功',
      driverKind: 'rule',
      startRel: 'articles',
      principal: 'user:mike',
    });
    expect(detail.trail).toHaveLength(4);
    expect(detail.messages.map((message) => message.text)).toEqual([
      '导航到 articles',
      '执行 next(articles) {"title":"舰队首航"}',
      '执行 publish(articles)',
      '完成: 目标完成: publish 已成功',
    ]);
  });

  it('running 委托:部分轨迹可见(舰队页轮询的中间态)', async () => {
    await appendEvent(pool, {
      kind: 'delegation-started',
      rel: delegationRel('wf-run'),
      actor: 'agent',
      channel: 'delegation',
      detail: { delegationId: 'wf-run', goal: { verb: '审核' }, driverKind: 'rule', startRel: 'comments' },
    });
    await appendEvent(pool, {
      kind: 'delegation-step',
      rel: delegationRel('wf-run'),
      actor: 'agent',
      channel: 'delegation',
      detail: { step: 1, op: { kind: 'navigate', rel: 'comments' }, outcome: 'navigated' },
    });

    const response = await getDelegationDetail(detailRequest('wf-run'), {
      params: Promise.resolve({ id: 'wf-run' }),
    });
    expect(response.status).toBe(200);
    const detail = (await response.json()) as { status: string; steps: number; messages: unknown[] };
    expect(detail.status).toBe('running');
    expect(detail.steps).toBe(1);
    expect(detail.messages).toEqual([{ role: 'assistant', text: '导航到 comments' }]);
  });

  it('未知委托 id → 404(含派发后首事件尚未落库的窗口)', async () => {
    const response = await getDelegationDetail(detailRequest('nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('nope');
  });

  it('空 id → 400', async () => {
    const response = await getDelegationDetail(detailRequest(''), {
      params: Promise.resolve({ id: '' }),
    });
    expect(response.status).toBe(400);
  });
});
