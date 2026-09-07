import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion } from '@ui4a/engine';
import { ensureEventsTable } from '@ui4a/db/events';
import { ensurePresentationTables, loadPresentationSnapshot } from '@ui4a/db/presentation';
import { getPool } from '@ui4a/db/pool';

import { getDb, getEngine, resetEngineForTests } from '../../service';
import { getAuthorizedPresentationResult } from '../../presentation/authorized-entity';
import { getPresentationBroker, resetPresentationBrokerForTests } from '../../presentation/runtime';

/**
 * Work Thread 新鲜度合同(T56 P1.3 A1–A4;US03/FR10,D78 决定 2 与 S1 §4 新鲜度
 * 四类接线的常驻钉测)。fixture 前缀 `t56p13-`:
 * A1 成员变化(attach/detach)→ links+members 指纹失效重规划,旧 Sidecar 不返回旧成员集;
 * A2 同 rel 值变化(被引 post 标题更新)→ 同 Sidecar 命中,重读解引用新值;
 * A3 动作变化(pending approval 被 approve → 责任卡动作消失;主体动作组变化 → 指纹失效重规划);
 * A4 授权变化(授予撤回/追加)→ policy+entity 指纹失效重规划,撤回后旧 Sidecar 不命中。
 */

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test');
const RUN = randomUUID().slice(0, 8);
const OWNER = 'user:t56p13-owner';
const GOAL = '完成一项跨应用评审并记录决定';
const FULL_GRANTS = ['publishing', 'community', 'development'];
const TRIM_DEVELOPMENT = ['publishing', 'community'];

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensurePresentationTables(pool);
  await pool.query('TRUNCATE events');
  await pool.query('TRUNCATE presentation_user_sidecars');
  resetEngineForTests();
  resetPresentationBrokerForTests();
});

async function execAccepted(
  rel: string,
  action: string,
  params: Record<string, unknown> = {},
  actor: 'human' | 'agent' = 'human',
): Promise<void> {
  const engine = await getEngine(pool);
  const outcome = await engine.exec({
    rel,
    action,
    params,
    actor,
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

interface Fixture {
  threadRel: string;
  pendingApprovalRel: string;
}

/** 精简版 Fixture A:context = post:first-post + comment:c2,active = software-change:main,
 *  approval = 一个 pending 确认(publishing 归属)。 */
async function buildFixture(): Promise<Fixture> {
  const threadId = `t56p13-f-${RUN}`;
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
  return { threadRel: `thread:${threadId}`, pendingApprovalRel };
}

async function readAuthorized(
  rel: string,
  grantedApplications: readonly string[],
): Promise<NonNullable<Awaited<ReturnType<typeof getAuthorizedPresentationResult>>['entity']>> {
  const result = await getAuthorizedPresentationResult(rel, OWNER, grantedApplications);
  if (result.kind !== 'authorized' || result.entity === undefined) {
    throw new Error(`预期 authorized,实际 ${result.kind}`);
  }
  return result.entity;
}

function cardRels(entity: { entities?: Array<{ properties?: { rel?: unknown } }> }): string[] {
  return (entity.entities ?? []).map((member) => String(member.properties?.rel));
}

function present(subject: string, requestId: string, grantedApplications: readonly string[]) {
  return getPresentationBroker().present(
    {
      schemaVersion: 1,
      requestId,
      principal: OWNER,
      subject,
      intent: 'read',
      delivery: 'canvas',
      sourceMessageIds: [],
    },
    { grantedApplications },
  );
}

describe('Work Thread 新鲜度(P1.3;US03/FR10)', () => {
  it('A1 成员变化:attach/detach 后成员卡集合/links 立即反映,members 指纹失效重规划且旧 Sidecar 不返回旧成员集', async () => {
    const { threadRel } = await buildFixture();
    const first = await present(threadRel, `t56p13-m1-${RUN}`, ['local-demo']);
    expect(first.status).toBe('ready');

    // attach:links 与 members 指纹同时变化 → 重规划(版本演进)。
    await execAccepted(threadRel, 'attach', { category: 'context', rel: 'comment:c4' });
    const after = await readAuthorized(threadRel, ['local-demo']);
    expect(after.properties.context).toEqual(['post:first-post', 'comment:c2', 'comment:c4']);
    expect(cardRels(after)).toContain('comment:c4');
    expect(after.links.filter((link) => link.rel.includes('context'))).toHaveLength(3);

    const replanned = await present(threadRel, `t56p13-m2-${RUN}`, ['local-demo']);
    expect(replanned.status).toBe('ready');
    expect(replanned.sidecar!.id).toBe(first.sidecar!.id);
    expect(replanned.sidecar!.version).toBeGreaterThan(first.sidecar!.version);

    // 重规划后的活跃版本成员指纹 = 新成员集(命中旧版本不得返回旧成员集)。
    const snapshot = await loadPresentationSnapshot(getDb());
    const aggregate = snapshot.sidecars[first.sidecar!.id]!;
    const entityRels = contentVersion(cardRels(after));
    const activeVersion = aggregate.versions[aggregate.activeVersion]!;
    expect(
      activeVersion.dependencies.find(({ id }) => id === `members:${threadRel}`)?.fingerprint,
    ).toBe(entityRels);
    expect(aggregate.activeVersion).toBe(replanned.sidecar!.version);

    // detach:成员集收缩,再次重规划且读面立即少一张卡。
    await execAccepted(threadRel, 'detach', { category: 'context', rel: 'comment:c4' });
    const afterDetach = await readAuthorized(threadRel, ['local-demo']);
    expect(afterDetach.properties.context).toEqual(['post:first-post', 'comment:c2']);
    expect(cardRels(afterDetach)).not.toContain('comment:c4');
    const afterDetachPresent = await present(threadRel, `t56p13-m3-${RUN}`, ['local-demo']);
    expect(afterDetachPresent.sidecar!.version).toBeGreaterThan(replanned.sidecar!.version);
    const snapshotAfterDetach = await loadPresentationSnapshot(getDb());
    const activeAfterDetach =
      snapshotAfterDetach.sidecars[first.sidecar!.id]!.versions[
        snapshotAfterDetach.sidecars[first.sidecar!.id]!.activeVersion
      ]!;
    expect(
      activeAfterDetach.dependencies.find(({ id }) => id === `members:${threadRel}`)?.fingerprint,
    ).toBe(contentVersion(cardRels(afterDetach)));
  });

  it('A2 同 rel 值变化:被引 post 标题更新后同 Sidecar 命中,成员卡 identity 重读解引用为新值', async () => {
    const { threadRel } = await buildFixture();
    const first = await present(threadRel, `t56p13-v1-${RUN}`, ['local-demo']);
    expect(first.status).toBe('ready');

    // post:first-post(publishing)下线 → 编辑标题 → 重新发布:合同状态回到
    // published,标题字段更新。链接/成员/动作不变 → 合同指纹不变。
    await execAccepted('post:first-post', 'unpublish');
    await execAccepted('post:first-post', 'edit', { title: '第一篇(修订版)', body: '修订正文' });
    await execAccepted('post:first-post', 'republish');

    // 值变化 → 同 Sidecar 命中(呈现计划不变,事实由同源重读携带)。
    const after = await present(threadRel, `t56p13-v2-${RUN}`, ['local-demo']);
    expect(after.status).toBe('ready');
    expect(after.sidecar).toEqual(first.sidecar);

    // 重读解引用新值:成员卡 identity 不显示旧标题缓存,状态为合同原词。
    const entity = await readAuthorized(threadRel, ['local-demo']);
    const card = (entity.entities ?? []).find(
      (member) => (member.properties as { rel?: string }).rel === 'post:first-post',
    );
    expect(card).toBeDefined();
    expect(card!.properties).toMatchObject({ identity: '第一篇(修订版)', status: 'published' });
  });

  it('A3 动作变化:pending approval 被 approve 后责任卡声明动作消失使成员合同失效重规划;主体动作组变化触发指纹失效重规划', async () => {
    const { threadRel, pendingApprovalRel } = await buildFixture();
    const first = await present(threadRel, `t56p13-a1-${RUN}`, ['local-demo']);
    expect(first.status).toBe('ready');

    // 前提:责任卡携带声明动作(approve/reject)。
    const before = await readAuthorized(threadRel, ['local-demo']);
    const pendingCard = (before.entities ?? []).find(
      (member) => (member.properties as { rel?: string }).rel === pendingApprovalRel,
    );
    expect(pendingCard!.actions.map((action) => action.name)).toEqual(['approve', 'reject']);

    // 批准:责任卡动作组消失,嵌入成员合同变化 → 同 id 重规划,不可沿用旧责任结构。
    await execAccepted(pendingApprovalRel, 'approve', {}, 'human');
    const after = await readAuthorized(threadRel, ['local-demo']);
    const decidedCard = (after.entities ?? []).find(
      (member) => (member.properties as { rel?: string }).rel === pendingApprovalRel,
    );
    expect(decidedCard!.properties).toMatchObject({ status: 'approved' });
    expect(decidedCard!.actions).toEqual([]);

    const afterApprove = await present(threadRel, `t56p13-a2-${RUN}`, ['local-demo']);
    expect(afterApprove.status).toBe('ready');
    expect(afterApprove.sidecar!.id).toBe(first.sidecar!.id);
    expect(afterApprove.sidecar!.version).toBeGreaterThan(first.sidecar!.version);

    // 主体动作组变化(pause → resume 换位):entity 合同指纹含 actions → 失效重规划。
    await execAccepted(threadRel, 'pause');
    const paused = await readAuthorized(threadRel, ['local-demo']);
    expect(paused.actions.map((action) => action.name)).toEqual([
      'attach',
      'detach',
      'resume',
      'complete',
      'archive',
    ]);
    const afterPause = await present(threadRel, `t56p13-a3-${RUN}`, ['local-demo']);
    expect(afterPause.status).toBe('ready');
    expect(afterPause.sidecar!.version).toBeGreaterThan(first.sidecar!.version);
    const snapshot = await loadPresentationSnapshot(getDb());
    const revised = snapshot.sidecars[first.sidecar!.id]!.versions[afterPause.sidecar!.version]!;
    expect(
      revised.dependencies.find(({ id }) => id === `entity:${threadRel}`)?.fingerprint,
    ).not.toEqual(
      snapshot.sidecars[first.sidecar!.id]!.versions[first.sidecar!.version]!.dependencies.find(
        ({ id }) => id === `entity:${threadRel}`,
      )?.fingerprint,
    );
  });

  it('A4 授权变化:授予撤回→卡消失且 policy 指纹失效,撤回后旧 Sidecar 不命中;授予追加→卡恢复', async () => {
    const { threadRel } = await buildFixture();

    // 少授予 development 起 plan:active 卡退场(policy + entity 指纹按少授予集固化)。
    const trimmed = await present(threadRel, `t56p13-g1-${RUN}`, TRIM_DEVELOPMENT);
    expect(trimmed.status).toBe('ready');
    const trimmedEntity = await readAuthorized(threadRel, TRIM_DEVELOPMENT);
    expect(cardRels(trimmedEntity)).not.toContain('software-change:main');
    const trimmedSnapshot = await loadPresentationSnapshot(getDb());
    const trimmedVersion =
      trimmedSnapshot.sidecars[trimmed.sidecar!.id]!.versions[trimmed.sidecar!.version]!;
    expect(trimmedVersion.dependencies.map(({ id }) => id)).toContain(
      'policy:community|publishing',
    );

    // 授予追加:同 durable 键命中同 Sidecar,policy+entity 指纹失配 → 重规划,active 卡出现。
    const restored = await present(threadRel, `t56p13-g2-${RUN}`, FULL_GRANTS);
    expect(restored.status).toBe('ready');
    expect(restored.sidecar!.id).toBe(trimmed.sidecar!.id);
    expect(restored.sidecar!.version).toBeGreaterThan(trimmed.sidecar!.version);
    const restoredEntity = await readAuthorized(threadRel, FULL_GRANTS);
    expect(cardRels(restoredEntity)).toContain('software-change:main');
    const restoredSnapshot = await loadPresentationSnapshot(getDb());
    const restoredVersion =
      restoredSnapshot.sidecars[restored.sidecar!.id]!.versions[restored.sidecar!.version]!;
    expect(restoredVersion.dependencies.map(({ id }) => id)).toContain(
      'policy:community|development|publishing',
    );

    // 撤回:再次重规划回少授予视图;存储的活跃版本 policy 指纹回到撤回后的授予集,
    // 旧 Sidecar 版本(全授予视图)不再被命中返回。
    const revoked = await present(threadRel, `t56p13-g3-${RUN}`, TRIM_DEVELOPMENT);
    expect(revoked.status).toBe('ready');
    expect(revoked.sidecar!.version).toBeGreaterThan(restored.sidecar!.version);
    const revokedSnapshot = await loadPresentationSnapshot(getDb());
    const aggregate = revokedSnapshot.sidecars[trimmed.sidecar!.id]!;
    expect(aggregate.activeVersion).toBe(revoked.sidecar!.version);
    const activeVersion = aggregate.versions[aggregate.activeVersion]!;
    expect(activeVersion.dependencies.map(({ id }) => id)).toContain('policy:community|publishing');
    expect(
      activeVersion.dependencies.find(({ id }) => id === `entity:${threadRel}`)?.fingerprint,
    ).not.toEqual(
      aggregate.versions[restored.sidecar!.version]!.dependencies.find(
        ({ id }) => id === `entity:${threadRel}`,
      )?.fingerprint,
    );
    const revokedEntity = await readAuthorized(threadRel, TRIM_DEVELOPMENT);
    expect(cardRels(revokedEntity)).not.toContain('software-change:main');
    expect(JSON.stringify(revokedEntity)).not.toContain('software-change');
  });
});
