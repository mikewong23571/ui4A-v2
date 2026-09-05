/**
 * T54 G01 探针/验收(Phase 0 → Phase 1):严格策略下 Meta 确认批准编排。
 *
 * Phase 0 探针形态(断言 = 现状,Green 即现状如实记录):
 * - 直连路径(默认策略 human 直通):meta/application:<name> 的 deprecate 直接
 *   执行,事件计划 = [action-executed, application-deprecated] + 级联
 *   (applications 删键、同 app 定义条目置废)——这是确认批准必须对齐的基线;
 * - 批准路径(严格策略挂起后的批准):策略文件按测试不可注入,事件直插
 *   confirmation-requested 物化 pending(仓库 fixture 惯例,同
 *   deprecated-applications.contract.test.ts);approve 走真实 service 链路。
 *   现状(G01 缺口):结构化拒绝「目标动作未声明于节点」,仅 [action-rejected]
 *   留痕,业务状态不动——批准与直连两条路径的事件计划不一致。
 *
 * Phase 1 翻红:批准路径断言改为 accepted + 同一事件计划
 * [confirmation-approved, action-executed, application-deprecated] + 级联
 * (D74)。
 */
import { describe, expect, it } from 'vitest';

import { appendEvent, ensureEventsTable, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';

const pool = getPool(process.env.DATABASE_URL!);

async function resetAndBoot() {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
  return getEngine(pool);
}

/** 直插严格策略挂起物(confirmation-requested;形状与 suspendForConfirmation 同构)。 */
async function suspendViaLogEvent(principal: string, params: Record<string, unknown>) {
  await appendEvent(pool, {
    kind: 'confirmation-requested',
    rel: 'confirmation:c1',
    action: 'deprecate',
    actor: 'human',
    principal,
    channel: 'meta',
    params: { reason: { value: params.reason, origin: 'body' } },
    detail: {
      id: 'c1',
      targetRel: 'meta/application:editorial',
      targetAction: 'deprecate',
      policy: 'cedar:strict-fixture',
      policyReason: '严格策略探针:human + high 挂起',
      riskLevel: 'high',
      request: {
        rel: 'meta/application:editorial',
        action: 'deprecate',
        params,
        actor: 'human',
        principal,
        channel: 'meta',
      },
    },
  });
}

describe('G01 meta confirmation orchestration probe (T54 Phase 0)', () => {
  it('直连路径(基线):deprecate 直接执行,事件对 + 级联落态', async () => {
    const engine = await resetAndBoot();
    const before = engine.getSnapshot();
    expect(before.applications?.editorial).toBeDefined();
    const seqBefore = (await readLog(pool, 0)).at(-1)?.seq ?? 0;

    const outcome = await engine.exec({
      rel: 'meta/application:editorial',
      action: 'deprecate',
      actor: 'human',
      principal: 'human-alice',
      channel: 'meta',
      params: { reason: 'T54 探针:直连基线' },
    });
    expect(outcome.kind).toBe('accepted');

    const log = await readLog(pool, 0);
    const tail = log
      .filter((event) => event.seq > (seqBefore ?? 0))
      .map((event) => event.kind);
    expect(tail).toEqual(['action-executed', 'application-deprecated']);

    const after = engine.getSnapshot();
    expect(after.applications?.editorial).toBeUndefined();
    expect(after.definitions?.['writing-request']?.status).toBe('deprecated');
  });

  it('批准路径(现状):结构化拒绝「未声明于节点」,业务状态不动', async () => {
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    await suspendViaLogEvent('human-alice', { reason: 'T54 探针:严格策略提议' });
    const engine = await getEngine(pool);

    const pending = engine.getSnapshot().confirmations?.['confirmation:c1'];
    expect(pending?.status).toBe('pending');
    expect(pending?.targetRel).toBe('meta/application:editorial');

    const approval = await engine.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: 'human-governor',
      channel: 'meta',
    });

    // 探针现状断言(G01 缺口):confirmDeps 只有活跃业务定义,生命周期伪流
    // 不在注册表 → 声明层拒绝;批准与直连事件计划不一致。
    expect(approval).toMatchObject({
      kind: 'rejected',
      layer: 'undeclared',
    });
    expect((approval as { reason: string }).reason).toContain('未声明于节点');

    const log = await readLog(pool, 0);
    const decision = log.filter((event) => event.rel === 'confirmation:c1');
    expect(decision.map((event) => event.kind)).toEqual([
      'confirmation-requested',
      'action-rejected',
    ]);

    // 业务状态不动:应用仍在目录,定义仍活跃——不是「停用了一半」。
    const after = engine.getSnapshot();
    expect(after.applications?.editorial).toBeDefined();
    expect(after.definitions?.['writing-request']?.status).not.toBe('deprecated');
  });
});
