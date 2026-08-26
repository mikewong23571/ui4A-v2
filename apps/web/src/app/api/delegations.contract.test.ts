import { beforeEach, describe, expect, it } from 'vitest';

import { delegationRel, DELEGATIONS_REL } from '@ui4a/engine';

import { appendEvent, ensureEventsTable, type DbExecutor } from '../../db/events';
import { getPool } from '../../db/pool';
import { resetEngineForTests } from '../../engine/service';

import { GET as getEntityRoute } from './entity/route';

// delegations 集合投影合同测试(T5 Phase A / Task 2):
// worker(delegationWorkflow 经 activity)直接 appendEvent 写委托事件族——
// web 读路径**不需重启**即经增量 fold 看见(spec 决定 4 双写者方案),
// /api/entity?rel=delegations 返回集合实体(entities[] 各委托:
// goal/status/steps/successes;子实体直达 delegation:<id>)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

function request(query: string): Request {
  return new Request(`http://localhost:3100/api/entity${query}`);
}

function entityRoute(rel: string): Promise<Response> {
  return getEntityRoute(request(`?rel=${encodeURIComponent(rel)}`));
}

/** 模拟 worker 写入的一组委托事件(boot 之后追加——增量 fold 的可见性前提)。 */
async function appendWorkerDelegationEvents(db: DbExecutor): Promise<void> {
  const rel = delegationRel('wf-contract-1');
  await appendEvent(db, {
    kind: 'delegation-started',
    rel,
    actor: 'agent',
    principal: 'user:mike',
    channel: 'delegation',
    detail: {
      delegationId: 'wf-contract-1',
      goal: { verb: '发布', fields: { title: 't5 委托' } },
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
      op: { kind: 'exec', action: 'publish', params: { title: 't5 委托' } },
      outcome: 'executed',
    },
  });
  await appendEvent(db, {
    kind: 'delegation-completed',
    rel,
    actor: 'agent',
    channel: 'delegation',
    detail: { steps: 2, successes: 1, summary: '目标完成: publish 已成功' },
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('GET /api/entity?rel=delegations(委托集合投影,worker 写后免重启可见)', () => {
  it('空委托表:200 空集合(count=0),非 404', async () => {
    const res = await entityRoute(DELEGATIONS_REL);
    expect(res.status).toBe(200);
    const entity = (await res.json()) as { properties: Record<string, unknown> };
    expect(entity.properties).toEqual({
      rel: 'delegations',
      title: '在动',
      count: 0,
      presentation: {
        fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
      },
    });
  });

  it('boot 后 worker 追加委托事件 → 增量 fold 即刻可见:集合/子实体直达/单委托', async () => {
    // 先 boot(种子装载 + 空委托确认),再模拟 worker 追加——证明免重启可见性。
    const warm = await entityRoute('articles');
    expect(warm.status).toBe(200);
    const empty = await entityRoute(DELEGATIONS_REL);
    expect(((await empty.json()) as { properties: { count: number } }).properties.count).toBe(0);

    await appendWorkerDelegationEvents(pool);

    const res = await entityRoute(DELEGATIONS_REL);
    expect(res.status).toBe(200);
    const collection = (await res.json()) as {
      class: string[];
      properties: Record<string, unknown>;
      entities: {
        rel: string[];
        href: string;
        class: string[];
        properties: Record<string, unknown>;
      }[];
    };
    expect(collection.class).toEqual(['collection', 'delegations']);
    expect(collection.properties).toEqual({
      rel: 'delegations',
      title: '在动',
      count: 1,
      presentation: {
        fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
      },
    });
    expect(collection.entities).toHaveLength(1);
    const sub = collection.entities[0]!;
    expect(sub.rel).toEqual(['item']);
    // 子实体直达(B2 同款合同:href 的 rel 值可作 ?rel= 直接取)。
    expect(sub.href).toBe('/api/entity?rel=delegation:wf-contract-1');
    expect(sub.class).toEqual(['delegation', 'completed']);
    expect(sub.properties).toMatchObject({
      id: 'wf-contract-1',
      goal: { verb: '发布', fields: { title: 't5 委托' } },
      'driver-kind': 'rule',
      'start-rel': 'articles',
      principal: 'user:mike',
      status: 'completed',
      steps: 2,
      successes: 1,
      summary: '目标完成: publish 已成功',
    });

    // 单委托直达:href 的 rel 直接可查。
    const single = await entityRoute(delegationRel('wf-contract-1'));
    expect(single.status).toBe(200);
    const singleEntity = (await single.json()) as { properties: Record<string, unknown> };
    expect(singleEntity.properties).toMatchObject({ status: 'completed', steps: 2 });
  });

  it('running 委托同样可见(舰队页"并行中"数据源):started + 部分 step', async () => {
    await appendEvent(pool, {
      kind: 'delegation-started',
      rel: delegationRel('wf-running'),
      actor: 'agent',
      channel: 'delegation',
      detail: {
        delegationId: 'wf-running',
        goal: { verb: '审核' },
        driverKind: 'rule',
        startRel: 'comments',
      },
    });

    const res = await entityRoute(DELEGATIONS_REL);
    const collection = (await res.json()) as {
      properties: { count: number };
      entities: { properties: Record<string, unknown> }[];
    };
    expect(collection.properties.count).toBe(1);
    expect(collection.entities[0]?.properties).toMatchObject({
      status: 'running',
      steps: 0,
      successes: 0,
    });
  });

  it('未知委托 id → 404(与业务实体同口径)', async () => {
    const res = await entityRoute(delegationRel('nope'));
    expect(res.status).toBe(404);
  });
});
