import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable, readLog } from '@ui4a/db/events';
import { ensurePresentationTables } from '@ui4a/db/presentation';
import { getPool } from '@ui4a/db/pool';

import {
  filterEntityForGrantedApplications,
  filterThreadEntityForPrincipal,
} from '../../../auth/application-scope';
import { getAuthorizedPresentationResult } from '../../presentation/authorized-entity';
import { getPresentationBroker, resetPresentationBrokerForTests } from '../../presentation/runtime';
import { getEngine, resetEngineForTests } from '../../service';

/**
 * Work Thread 授权读合同(T56 P1.1 Red;D78 决定 2/3 与 D51 纪律的服务层负例)。
 *
 * 固定 Fixture A(acceptance.md §1)与 presentation.test.ts 同构,fixture 前缀
 * `t56p11-`;断言钉死 D78 路线 A 的目标读语义,实现前必须失败(断言失败而非
 * 类型/语法错误),P1.2 落码后转绿:
 * 1. owner 正例:五张角色成员卡全可读、责任卡携带声明动作、认知声明 version:1;
 * 2. 授权裁剪:成员卡/链接/派生行逐引用退场,零计数/名称/占位泄露;
 * 3. 跨 principal:subject-unavailable 与结构化 denied 的存在性隐藏;
 * 4. 派生计数只反映可见集,实体读门与呈现读门双路径一致;
 * 5. 「裁剪 vs 真空」同形:语义声明只从可见状态派生,防 UI 写全称断言。
 */

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test');
const RUN = randomUUID().slice(0, 8);
const OWNER = 'user:t56p11-owner';
const OTHER = 'user:t56p11-other';
const GOAL = '完成一项跨应用评审并记录决定';
const FULL_GRANTS = ['publishing', 'community', 'development'];
const TRIM_DEVELOPMENT = ['publishing', 'community'];
const TRIM_PUBLISHING = ['community', 'development'];

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
  principal: string = OWNER,
): Promise<void> {
  const engine = await getEngine(pool);
  const outcome = await engine.exec({
    rel,
    action,
    params,
    actor: 'human',
    principal,
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

/** 走完 article-drafting 三步向导并 publish,产出第二篇 published 文章。 */
async function publishSecondPost(): Promise<string> {
  const engine = await getEngine(pool);
  for (const params of [
    { title: 't56p11 second post' },
    { category: 'tech', tags: 't56p11' },
    { body: 'T56P11 fixture body' },
  ]) {
    const outcome = await engine.exec({
      rel: 'article-drafting:main',
      action: 'next',
      params,
      actor: 'agent',
      principal: OWNER,
      channel: 'http',
    });
    if (outcome.kind !== 'accepted') throw new Error(`向导步预期 accepted,实际 ${outcome.kind}`);
  }
  const outcome = await engine.exec({
    rel: 'article-drafting:main',
    action: 'publish',
    params: { title: 't56p11 second post' },
    actor: 'agent',
    principal: OWNER,
    channel: 'http',
  });
  if (outcome.kind !== 'accepted') throw new Error(`publish 预期 accepted,实际 ${outcome.kind}`);
  return 'post:t56p11-second-post';
}

interface FixtureA {
  threadRel: string;
  pendingApprovalRel: string;
  decidedApprovalRel: string;
}

/**
 * Fixture A:线程 open,目标明确;
 * context = post:first-post(publishing)+ comment:c2(community);
 * active = software-change:main(development);
 * approval = confirmation:c1(pending,target post:post-welcome/publishing)
 *          + confirmation:c2(approved,target 第二篇 published 文章/publishing);
 * event = 本线 thread-created 的显式 event 引用。
 */
async function buildFixtureA(): Promise<FixtureA> {
  const threadId = `t56p11-a-${RUN}`;
  await execAccepted('threads', 'create', {
    commandId: threadId,
    goal: GOAL,
  });
  const pendingApprovalRel = await suspendArchive('post:post-welcome');
  const decidedTargetRel = await publishSecondPost();
  const decidedApprovalRel = await suspendArchive(decidedTargetRel);
  await execAccepted(decidedApprovalRel, 'approve');
  const attach = (threadId_: string, category: string, rel: string): Promise<void> =>
    execAccepted(`thread:${threadId_}`, 'attach', { category, rel });
  await attach(threadId, 'context', 'post:first-post');
  await attach(threadId, 'context', 'comment:c2');
  await attach(threadId, 'active', 'software-change:main');
  await attach(threadId, 'approval', pendingApprovalRel);
  await attach(threadId, 'approval', decidedApprovalRel);
  const events = await readLog(pool);
  const created = events.find(
    (event) => event.kind === 'thread-created' && event.rel === `thread:${threadId}`,
  );
  if (created === undefined) throw new Error('fixture 缺 thread-created 事件');
  await attach(threadId, 'event', `event:${created.seq}`);
  return { threadRel: `thread:${threadId}`, pendingApprovalRel, decidedApprovalRel };
}

/** 授权呈现读面(呈现链路/UI 同门)读取 owner 视图实体。 */
async function readAuthorizedOwnerEntity(
  rel: string,
  grantedApplications: readonly string[],
): Promise<EntityView> {
  const result = await getAuthorizedPresentationResult(rel, OWNER, grantedApplications);
  expect(result.kind).toBe('authorized');
  return result.entity as EntityView;
}

interface ThreadCardView {
  class: string[];
  properties: Record<string, unknown>;
  actions: Array<{ name: string }>;
  links: Array<{ rel: string[]; href: string }>;
}

/** 结构化视图(运行时对象断言,不引入未来类型)。 */
interface EntityView {
  class: string[];
  properties: Record<string, unknown>;
  actions: Array<{ name: string }>;
  links: Array<{ rel: string[]; href: string }>;
  entities?: ThreadCardView[];
}

function cardViews(entity: EntityView): ThreadCardView[] {
  return entity.entities ?? [];
}

function cardRels(entity: EntityView): string[] {
  return cardViews(entity).map((card) => card.properties.rel as string);
}

function cardOf(entity: EntityView, rel: string): ThreadCardView | undefined {
  return cardViews(entity).find((card) => card.properties.rel === rel);
}

/** 认知声明去掉字段引用后的语义部分(version/traits/groupRole/priority/emptyMeaning)。 */
function cognitionOf(presentation: Record<string, unknown>): Record<string, unknown> {
  return {
    version: presentation.version,
    traits: presentation.traits,
    groupRole: presentation.groupRole,
    priority: presentation.priority,
    emptyMeaning: presentation.emptyMeaning,
  };
}

describe('Work Thread 授权读合同(D78 路线 A 目标语义;Red)', () => {
  it('C6 owner 正例:Fixture A 五张角色成员卡全可读,责任卡携带声明动作,认知声明 version:1(D78 决定 2;US01)', async () => {
    const { threadRel, pendingApprovalRel, decidedApprovalRel } = await buildFixtureA();
    const entity = await readAuthorizedOwnerEntity(threadRel, FULL_GRANTS);
    // 成员卡序 = properties 引用序:context ×2 → active ×1 → approval ×2(当前仅 context 落卡)。
    expect(cardRels(entity)).toEqual([
      'post:first-post',
      'comment:c2',
      'software-change:main',
      pendingApprovalRel,
      decidedApprovalRel,
    ]);
    // 与 context 同构:class thread-reference + properties{rel,identity,status,category}。
    expect(cardOf(entity, 'post:first-post')).toMatchObject({
      class: ['thread-reference'],
      properties: {
        rel: 'post:first-post',
        identity: '第一篇',
        status: 'published',
        category: 'context',
      },
    });
    expect(cardOf(entity, 'software-change:main')).toMatchObject({
      class: ['thread-reference'],
      properties: {
        rel: 'software-change:main',
        status: 'implementation-ready',
        category: 'active',
      },
    });
    // 责任卡:pending 携带被引确认实体的声明动作(membersDeclareActions → member-card);
    // 已决定的确认是审计视图,无动作。
    expect(cardOf(entity, pendingApprovalRel)).toMatchObject({
      class: ['thread-reference'],
      properties: {
        rel: pendingApprovalRel,
        identity: 'archive · 由 agent 提议',
        status: 'pending',
        category: 'approval',
      },
    });
    expect(cardOf(entity, pendingApprovalRel)?.actions.map((action) => action.name)).toEqual([
      'approve',
      'reject',
    ]);
    expect(cardOf(entity, decidedApprovalRel)?.properties).toMatchObject({
      status: 'approved',
      category: 'approval',
    });
    expect(cardOf(entity, decidedApprovalRel)?.actions).toEqual([]);
    // 可到达:每张成员卡携带 self 链接。
    for (const card of cardViews(entity)) {
      const rel = card.properties.rel as string;
      expect(card.links).toContainEqual({ rel: ['self'], href: `/api/entity?rel=${rel}` });
    }
    // 认知声明 version:1 经服务层授权读面同样可见(与纯投影同合同)。
    const presentation = entity.properties.presentation as Record<string, unknown>;
    expect(presentation.version).toBe(1);
    expect(presentation.traits).toContain('human-responsibility');
  });

  it('C7 授权裁剪:少授予一个应用 → 成员卡/链接/派生行逐引用退场,零计数/名称/占位泄露(D78 决定 3;US10)', async () => {
    const { threadRel, pendingApprovalRel, decidedApprovalRel } = await buildFixtureA();
    // 前提(Red):全授予时五张角色成员卡在位——下方的裁剪语义才有可裁对象。
    const full = await readAuthorizedOwnerEntity(threadRel, FULL_GRANTS);
    expect(cardRels(full)).toHaveLength(5);

    // 少授予 development:active 成员卡/链接/条目与 resume 派生行全部退场。
    const noDevelopment = await readAuthorizedOwnerEntity(threadRel, TRIM_DEVELOPMENT);
    expect(noDevelopment.properties.active).toEqual([]);
    expect(cardRels(noDevelopment)).not.toContain('software-change:main');
    expect(cardRels(noDevelopment)).toEqual([
      'post:first-post',
      'comment:c2',
      pendingApprovalRel,
      decidedApprovalRel,
    ]);
    expect(noDevelopment.links.some((link) => link.rel.includes('active'))).toBe(false);
    expect(noDevelopment.properties).not.toHaveProperty('resume');
    // D51 授予内零可见:被裁对象的 rel/状态不得出现在任何计数/摘要/标题;
    // resume 被裁时该行消失,不加「不可见」占位。
    const noDevelopmentSerialized = JSON.stringify(noDevelopment);
    expect(noDevelopmentSerialized).not.toContain('software-change');
    expect(noDevelopmentSerialized).not.toContain('implementation-ready');
    expect(noDevelopmentSerialized).not.toContain('不可见');

    // 少授予 publishing:两张责任卡与 publishing context 卡退场,development active 保留。
    const noPublishing = await readAuthorizedOwnerEntity(threadRel, TRIM_PUBLISHING);
    expect(noPublishing.properties.approval).toEqual([]);
    expect(noPublishing.properties.context).toEqual(['comment:c2']);
    expect(cardRels(noPublishing)).toEqual(['comment:c2', 'software-change:main']);
    const noPublishingSerialized = JSON.stringify(noPublishing);
    expect(noPublishingSerialized).not.toContain(pendingApprovalRel);
    expect(noPublishingSerialized).not.toContain(decidedApprovalRel);
    expect(noPublishingSerialized).not.toContain('post:first-post');
  });

  it('C8 跨 principal:subject-unavailable 与结构化 denied 的存在性隐藏,与不存在线不可辨(D78/D51;US10)', async () => {
    const { threadRel } = await buildFixtureA();
    // 前提(Red):owner 全授予可见五张成员卡——下方的拒绝才是「隐藏」而非「读不出」。
    const own = await readAuthorizedOwnerEntity(threadRel, FULL_GRANTS);
    expect(cardRels(own)).toHaveLength(5);
    // 他者读取:subject-unavailable(不区分「他人私有物」与「不存在」)。
    const foreign = await getAuthorizedPresentationResult(threadRel, OTHER, ['local-demo']);
    expect(foreign.kind).toBe('subject-unavailable');
    expect(foreign.entity).toBeUndefined();
    const missing = await getAuthorizedPresentationResult(`thread:t56p11-missing-${RUN}`, OTHER, [
      'local-demo',
    ]);
    expect(missing.kind).toBe('subject-unavailable');
    expect(missing.entity).toBeUndefined();
    // 两者结构同形:存在性隐藏(404 族口径),不泄露被隐藏线的目标/成员/责任材料。
    expect(JSON.stringify(foreign)).toEqual(JSON.stringify(missing));
    // 呈现 Broker:结构化 denied 回执,无 sidecar/surface 泄露。
    const receipt = await getPresentationBroker().present(
      {
        schemaVersion: 1,
        requestId: `t56p11-cross-${RUN}`,
        principal: OTHER,
        subject: threadRel,
        intent: 'read',
        delivery: 'canvas',
        sourceMessageIds: [],
      },
      { grantedApplications: ['local-demo'] },
    );
    expect(receipt.status).toBe('failed');
    expect(receipt.reasonCode).toBe('subject-unavailable');
    expect(receipt.sidecar).toBeUndefined();
  });

  it('C9 派生计数只反映可见集;实体读门(/api/entity 组合)与呈现读门双路径一致(D78 决定 3;US10)', async () => {
    const { threadRel } = await buildFixtureA();
    const entity = await readAuthorizedOwnerEntity(threadRel, TRIM_DEVELOPMENT);
    const properties = entity.properties;
    // 成员卡数量 = 可见引用条目总数(当前 entities 仅 context 卡,数量对不上 → Red)。
    const visibleReferenceCount =
      (properties.context as unknown[]).length +
      (properties.active as unknown[]).length +
      (properties.approval as unknown[]).length;
    expect(cardViews(entity)).toHaveLength(visibleReferenceCount);
    // 为 P1.2 可能引入的可重建计数字段钉口径:任何 *count 派生字段只能取可见集数量。
    const visibleLengths = [
      visibleReferenceCount,
      (properties.context as unknown[]).length,
      (properties.active as unknown[]).length,
      (properties.approval as unknown[]).length,
    ];
    for (const [key, value] of Object.entries(properties)) {
      if (!key.toLowerCase().endsWith('count') || typeof value !== 'number') continue;
      expect(visibleLengths).toContain(value);
    }
    // 双路径:api/entity 的组合门(属主重审 → 授予集合重审)与呈现授权读面输出深度一致。
    const engine = await getEngine(pool);
    const projected = await engine.getEntity(threadRel);
    const snapshot = engine.getSnapshot();
    const sitemap = engine.getSitemap();
    const viaEntityGate = filterEntityForGrantedApplications(
      filterThreadEntityForPrincipal(projected!, snapshot, threadRel, OWNER),
      {
        snapshot,
        sitemap,
        plane: 'business',
        grantedApplications: TRIM_DEVELOPMENT,
        principal: OWNER,
      },
    );
    expect(viaEntityGate).toEqual(entity);
  });

  it('C10 「裁剪 vs 真空」同形:同一可见状态下语义声明一致,唯一 sanctioned 差异是 resume 行消失(D78 决定 3;US10)', async () => {
    const { threadRel, pendingApprovalRel, decidedApprovalRel } = await buildFixtureA();
    // 真空对照线:同目标语 ensured 不同 id、同 context、同 approval 引用,但从未挂 active。
    const vacuumId = `t56p11-b-${RUN}`;
    await execAccepted('threads', 'create', {
      commandId: vacuumId,
      goal: `${GOAL}(真空对照)`,
    });
    for (const [category, rel] of [
      ['context', 'post:first-post'],
      ['context', 'comment:c2'],
      ['approval', pendingApprovalRel],
      ['approval', decidedApprovalRel],
    ] as const) {
      await execAccepted(`thread:${vacuumId}`, 'attach', { category, rel });
    }
    // 两侧同授予:['publishing','community'] 对 A 线裁掉 development active;
    // 对照线本来就没有 active。可见剩余状态完全一致。
    const trimmed = await readAuthorizedOwnerEntity(threadRel, TRIM_DEVELOPMENT);
    const vacuum = await readAuthorizedOwnerEntity(`thread:${vacuumId}`, TRIM_DEVELOPMENT);
    const trimmedProperties = trimmed.properties;
    const vacuumProperties = vacuum.properties;
    // active 区域同形:裁剪后与从未挂载的线都输出 [](D78 决定 3 的「不可区分」本体)。
    expect(trimmedProperties.active).toEqual([]);
    expect(vacuumProperties.active).toEqual([]);
    // 唯一 sanctioned 差异:D78 明示的 resume 行消失(裁剪侧);真空侧不加占位语义。
    const trimmedKeys = Object.keys(trimmedProperties).sort();
    const vacuumKeys = Object.keys(vacuumProperties).sort();
    expect(vacuumKeys.filter((key) => !trimmedKeys.includes(key))).toEqual(['resume']);
    expect(trimmedKeys.filter((key) => !vacuumKeys.includes(key))).toEqual([]);
    // 语义声明(cognition 部分)只从可见状态派生:可见剩余一致 → 声明一致,
    // 渲染层无从对「被裁剪」写出与「真空」不同的全称断言分支。
    const trimmedPresentation = trimmedProperties.presentation as Record<string, unknown>;
    const vacuumPresentation = vacuumProperties.presentation as Record<string, unknown>;
    expect(cognitionOf(trimmedPresentation)).toEqual(cognitionOf(vacuumPresentation));
    expect(trimmedPresentation.version).toBe(1);
    // 裁剪侧无「不可见」占位。
    expect(JSON.stringify(trimmed)).not.toContain('不可见');
  });
});
