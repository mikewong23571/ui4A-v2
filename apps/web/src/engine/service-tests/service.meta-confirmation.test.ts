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
import { fold } from '@ui4a/engine';

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
    params: { reason: { value: params.reason, origin: 'intent' } },
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

  it('批准路径(D74):同一事件计划 + 级联;重启(事件日志即真相)后仍可批准', async () => {
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    await suspendViaLogEvent('human-alice', { reason: 'T54 探针:严格策略提议' });
    const booted = await getEngine(pool);
    const pending = booted.getSnapshot().confirmations?.['confirmation:c1'];
    expect(pending?.status).toBe('pending');
    expect(pending?.targetRel).toBe('meta/application:editorial');

    // 重启边界:进程内引擎复位后从日志重建(US 验收「重启」步)。
    resetEngineForTests();
    const engine = await getEngine(pool);
    expect(engine.getSnapshot().confirmations?.['confirmation:c1']?.status).toBe('pending');

    const approval = await engine.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: 'human-governor',
      channel: 'meta',
    });
    expect(approval.kind).toBe('accepted');

    // 事件计划同一(D74.2):批准路径前置 confirmation-approved,业务事件序列
    // 与直连一致。
    const log = await readLog(pool, 0);
    const decision = log.filter((event) => event.rel === 'confirmation:c1');
    expect(decision.map((event) => event.kind)).toEqual([
      'confirmation-requested',
      'confirmation-approved',
    ]);
    const business = log
      .filter((event) => event.rel === 'meta/application:editorial')
      .filter((event) => event.kind !== 'application-seeded');
    expect(business.map((event) => event.kind)).toEqual([
      'action-executed',
      'application-deprecated',
    ]);

    // 级联落态 + 决定留痕:提议者/批准者链保留。
    const after = engine.getSnapshot();
    expect(after.applications?.editorial).toBeUndefined();
    expect(after.definitions?.['writing-request']?.status).toBe('deprecated');
    expect(after.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'approved',
      proposedBy: { actor: 'human', principal: 'human-alice' },
      approvedBy: { actor: 'human', principal: 'human-governor' },
    });

    // 完整重放与在线一致(I5;审计表 seq 属日志层,仅断言键集)。
    const replayed = fold(log, { flows: {} });
    expect(replayed.instances).toEqual(after.instances);
    expect(replayed.applications).toEqual(after.applications);
    expect(replayed.definitions).toEqual(after.definitions);
    expect(replayed.confirmations).toEqual(after.confirmations);
    expect(Object.keys(replayed.deprecatedApplications ?? {})).toEqual(['editorial']);
  });

  it('批准边界:重复批准至多一次;agent 批准被 guard 拒;目标漂移结构化拒绝留痕', async () => {
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    await suspendViaLogEvent('human-alice', { reason: 'T54 探针:边界' });
    const engine = await getEngine(pool);

    // agent 批准:铁律 5,guard actor-is-human 拒绝并留痕。
    const agentApproval = await engine.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'agent',
      principal: 'agent:bot',
      channel: 'meta',
    });
    expect(agentApproval).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });

    // 目标漂移:pending 期间应用被直连停用(默认策略 human 直通),
    // 批准必须按当前事实结构化拒绝,不产第二次停用事件。
    const drift = await engine.exec({
      rel: 'meta/application:editorial',
      action: 'deprecate',
      actor: 'human',
      principal: 'human-other',
      channel: 'meta',
      params: { reason: 'pending 期间直连停用' },
    });
    expect(drift.kind).toBe('accepted');

    const stale = await engine.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: 'human-governor',
      channel: 'meta',
    });
    expect(stale).toMatchObject({ kind: 'rejected', layer: 'undeclared' });

    // 重复批准不可达(该确认从未 approved);换一个真实批准后再重复,
    // 至多生效一次:状态裁决(pending → approved 单向)。
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    await suspendViaLogEvent('human-alice', { reason: 'T54 探针:幂等' });
    const engine2 = await getEngine(pool);
    const first = await engine2.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: 'human-governor',
      channel: 'meta',
    });
    expect(first.kind).toBe('accepted');
    const second = await engine2.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: 'human-governor',
      channel: 'meta',
    });
    expect(second).toMatchObject({ kind: 'rejected', layer: 'undeclared' });

    const log = await readLog(pool, 0);
    const deprecations = log.filter((event) => event.kind === 'application-deprecated');
    expect(deprecations).toHaveLength(1);
  });
});
