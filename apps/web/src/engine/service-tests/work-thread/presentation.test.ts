import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { SurfaceNode } from '@ui4a/engine';
import { ensureEventsTable, readLog } from '@ui4a/db/events';
import { ensurePresentationTables, loadPresentationSnapshot } from '@ui4a/db/presentation';
import { getPool } from '@ui4a/db/pool';

import { getDb, getEngine, resetEngineForTests } from '../../service';
import { getAuthorizedPresentationResult } from '../../presentation/authorized-entity';
import { getPresentationBroker, resetPresentationBrokerForTests } from '../../presentation/runtime';

/**
 * Work Thread 呈现链路服务层探针(T56 S1 → P1.1 种子)。
 *
 * 固定 Fixture A(acceptance.md §1):open 线 + 明确目标 + 跨两个 application 的
 * context + 一条 active + 当前与已决定的 approval + 一个显式 event。测试刻画
 * 当前合同行为的四个面,供 P1 改造时作 Red 基线:
 * 1. exact Siren(projectWorkThread 经服务层授权读面的输出全貌);
 * 2. 授权裁剪(授予集合变化时 properties/links/entities 的逐引用重审);
 * 3. focus=thread:<id> 的 Presentation 规划(Broker → generic planner → Sidecar);
 * 4. member/value/action/授权变化下的依赖判定与 Sidecar 版本演进。
 */

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test');
const RUN = randomUUID().slice(0, 8);
const OWNER = 'user:t56s1-owner';
const OTHER = 'user:t56s1-other';
const GOAL = '完成一项跨应用评审并记录决定';

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

interface FixtureA {
  threadRel: string;
  pendingApprovalRel: string;
  decidedApprovalRel: string;
}

/** 走完 article-drafting 三步向导并 publish,产出第二篇 published 文章。 */
async function publishSecondPost(): Promise<string> {
  const engine = await getEngine(pool);
  for (const params of [
    { title: 't56s1 second post' },
    { category: 'tech', tags: 't56s1' },
    { body: 'T56S1 fixture body' },
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
    params: { title: 't56s1 second post' },
    actor: 'agent',
    principal: OWNER,
    channel: 'http',
  });
  if (outcome.kind !== 'accepted') throw new Error(`publish 预期 accepted,实际 ${outcome.kind}`);
  return 'post:t56s1-second-post';
}

/**
 * Fixture A:线程 open,目标明确;
 * context = post:first-post(publishing)+ comment:c2(community);
 * active = software-change:main(development);
 * approval = confirmation:c1(pending,target post:post-welcome/publishing)
 *          + confirmation:c2(approved,target post:t56s1 第二篇/publishing);
 * event = 本线 thread-created 的显式 event 引用。
 */
async function buildFixtureA(): Promise<FixtureA> {
  const threadId = `t56s1-a-${RUN}`;
  await execAccepted('threads', 'create', {
    commandId: threadId,
    goal: GOAL,
  });
  const pendingApprovalRel = await suspendArchive('post:post-welcome');
  const decidedTargetRel = await publishSecondPost();
  const decidedApprovalRel = await suspendArchive(decidedTargetRel);
  await execAccepted(decidedApprovalRel, 'approve');
  const attach = (category: string, rel: string): Promise<void> =>
    execAccepted(`thread:${threadId}`, 'attach', { category, rel });
  await attach('context', 'post:first-post');
  await attach('context', 'comment:c2');
  await attach('active', 'software-change:main');
  await attach('approval', pendingApprovalRel);
  await attach('approval', decidedApprovalRel);
  const events = await readLog(pool);
  const created = events.find(
    (event) => event.kind === 'thread-created' && event.rel === `thread:${threadId}`,
  );
  if (created === undefined) throw new Error('fixture 缺 thread-created 事件');
  await attach('event', `event:${created.seq}`);
  return { threadRel: `thread:${threadId}`, pendingApprovalRel, decidedApprovalRel };
}

interface BindingSummary {
  kind: string;
  ref: string;
}

interface NodeSummary {
  kind: string;
  role?: string;
  word?: string;
  bindings?: BindingSummary[];
}

function bindingRef(binding: unknown): string {
  const record = binding as { kind?: unknown; path?: unknown; subject?: unknown };
  const kind = typeof record.kind === 'string' ? record.kind : 'unknown';
  const detail = typeof record.path === 'string' ? record.path : record.subject;
  return `${kind}:${typeof detail === 'string' ? detail : ''}`;
}

function summarizeNode(node: SurfaceNode, out: NodeSummary[]): void {
  const record = node as unknown as Record<string, unknown>;
  const bindings = record.bindings;
  out.push({
    kind: node.kind,
    ...(node.role === undefined ? {} : { role: node.role }),
    ...(node.kind === 'word' ? { word: node.word } : {}),
    ...(typeof bindings === 'object' && bindings !== null
      ? {
          bindings: Object.entries(bindings as Record<string, unknown>).map(([name, binding]) => ({
            kind: name,
            ref: bindingRef(binding),
          })),
        }
      : {}),
  });
  if (node.kind === 'layout') for (const child of node.children) summarizeNode(child, out);
  if (node.kind === 'slot') summarizeNode(node.child, out);
  if (node.kind === 'repeat') summarizeNode(node.item, out);
}

function summarizeTree(root: SurfaceNode): NodeSummary[] {
  const out: NodeSummary[] = [];
  summarizeNode(root, out);
  return out;
}

describe('T56 S1 探针:Work Thread 合同与呈现链路现状', () => {
  it('exact Siren:properties 携带 active/approval 状态指针,entities 携带全部角色成员卡(P1.2 升级)', async () => {
    const { threadRel, pendingApprovalRel, decidedApprovalRel } = await buildFixtureA();
    const engine = await getEngine(pool);
    const entity = await engine.getEntity(threadRel);
    expect(entity).toBeDefined();
    console.log('T56S1_EXACT_SIREN', JSON.stringify(entity));

    expect(entity!.class).toEqual(['work-thread', 'open']);
    expect(entity!.properties).toMatchObject({
      rel: threadRel,
      identity: GOAL,
      owner: OWNER,
      goal: { text: GOAL, source: threadRel.replace('thread:', 'thread-input:') },
      status: 'open',
      statusText: '进行中',
      context: ['post:first-post', 'comment:c2'],
      resume: '停在「implementation-ready」',
    });
    // active/approval 是 {rel,status,dangling} 状态指针数组(可重建派生,形状不变)。
    expect(entity!.properties.active).toEqual([
      { rel: 'software-change:main', status: 'implementation-ready', dangling: false },
    ]);
    expect(entity!.properties.approval).toEqual([
      { rel: pendingApprovalRel, status: 'pending', dangling: false },
      { rel: decidedApprovalRel, status: 'approved', dangling: false },
    ]);
    for (const entry of [
      ...(entity!.properties.active as object[]),
      ...(entity!.properties.approval as object[]),
    ]) {
      expect(Object.keys(entry).sort()).toEqual(['dangling', 'rel', 'status']);
    }
    // P1.2(D78 决定 2):成员卡与 properties 引用序同构(context → active →
    // approval),角色以 category 标注;approval 卡携带被引确认的声明动作。
    const memberRels = (entity!.entities ?? []).map(
      (member) => (member.properties as { rel?: unknown }).rel,
    );
    expect(memberRels).toEqual([
      'post:first-post',
      'comment:c2',
      'software-change:main',
      pendingApprovalRel,
      decidedApprovalRel,
    ]);
    expect(entity!.entities?.[0]).toMatchObject({
      class: ['thread-reference'],
      actions: [],
      properties: { rel: 'post:first-post', identity: '第一篇', category: 'context' },
    });
    // links:self + 每类引用逐条 link + event 审计链接。
    const linkRels = entity!.links.map((link) => link.rel.join('>'));
    expect(linkRels).toContain('self');
    expect(linkRels.filter((rel) => rel === 'context')).toHaveLength(2);
    expect(linkRels).toContain('active');
    expect(linkRels.filter((rel) => rel === 'approval')).toHaveLength(2);
    expect(linkRels).toContain('event');
    // open 线动作组;presentation.fields 只声明 identity/status/resume 三个读字段。
    expect(entity!.actions.map((action) => action.name)).toEqual([
      'attach',
      'detach',
      'pause',
      'complete',
      'archive',
    ]);
    const presentation = entity!.properties.presentation as {
      fields?: Array<{ path: string; role: string }>;
    };
    expect(presentation.fields?.map((field) => field.path)).toEqual([
      'properties.identity',
      'properties.statusText',
    ]);
    // 创建原文由 source link 独立回读，不在主内容重复目标。
    expect(entity!.properties).not.toHaveProperty('goalSourceText');
  });

  it('授权裁剪:少授予 development 时 active/resume 退场;少授予 publishing 时 approval 退场', async () => {
    const { threadRel, pendingApprovalRel, decidedApprovalRel } = await buildFixtureA();

    // 全授予(publishing/community/development):active、approval、context 全可见。
    const full = await getAuthorizedPresentationResult(threadRel, OWNER, [
      'publishing',
      'community',
      'development',
    ]);
    expect(full.kind).toBe('authorized');
    expect(full.entity?.properties.active).toEqual([
      { rel: 'software-change:main', status: 'implementation-ready', dangling: false },
    ]);
    expect(full.entity?.properties.approval).toEqual([
      { rel: pendingApprovalRel, status: 'pending', dangling: false },
      { rel: decidedApprovalRel, status: 'approved', dangling: false },
    ]);

    // 少授予 development:active 数组条目、active link、resume 派生行全部退场;
    // 可见数量口径 =「当前可见」,不暴露受限对象的存在性。
    const noDevelopment = await getAuthorizedPresentationResult(threadRel, OWNER, [
      'publishing',
      'community',
    ]);
    expect(noDevelopment.kind).toBe('authorized');
    expect(noDevelopment.entity?.properties.active).toEqual([]);
    expect(noDevelopment.entity?.properties).not.toHaveProperty('resume');
    expect(noDevelopment.entity?.properties.context).toEqual(['post:first-post', 'comment:c2']);
    expect(noDevelopment.entity?.properties.approval).toEqual([
      { rel: pendingApprovalRel, status: 'pending', dangling: false },
      { rel: decidedApprovalRel, status: 'approved', dangling: false },
    ]);
    expect(noDevelopment.entity?.links.some((link) => link.rel.includes('active'))).toBe(false);
    expect(noDevelopment.entity?.links.some((link) => link.rel.includes('context'))).toBe(true);

    // 少授予 publishing:两个 approval(target 均为 publishing 文章)与
    // publishing context 退场,development active 保留;hidden 成员无计数披露。
    // P1.2:成员卡逐引用同门退场,可见卡 = 可见引用条目(Comment context + active)。
    const noPublishing = await getAuthorizedPresentationResult(threadRel, OWNER, [
      'community',
      'development',
    ]);
    expect(noPublishing.kind).toBe('authorized');
    expect(noPublishing.entity?.properties.active).toEqual([
      { rel: 'software-change:main', status: 'implementation-ready', dangling: false },
    ]);
    expect(noPublishing.entity?.properties.approval).toEqual([]);
    expect(noPublishing.entity?.properties.context).toEqual(['comment:c2']);
    expect(
      noPublishing.entity?.entities?.map((member) => (member.properties as { rel?: unknown }).rel),
    ).toEqual(['comment:c2', 'software-change:main']);
  });

  it('线程生命周期动作不经确认门:agent archive 直通 accepted(声明标注 requires-confirmation 在 thread 路径不生效)', async () => {
    const engine = await getEngine(pool);
    const scratch = `t56s1-gate-${RUN}`;
    await execAccepted('threads', 'create', {
      commandId: scratch,
      goal: '确认门旁路刻画',
    });
    const outcome = await engine.exec({
      rel: `thread:${scratch}`,
      action: 'archive',
      params: {},
      actor: 'agent',
      principal: OWNER,
      channel: 'http',
    });
    // 刻画现状(exec/service-exec.ts:87-89 thread rels 直入 execThreadAction,
    // 不进 executeWithGates 的 Cedar 确认门):THREAD_ARCHIVE_ACTION 的
    // requires-confirmation: 'high' 标注在此路径无效果。
    expect(outcome.kind).toBe('accepted');
    expect(engine.getSnapshot().threads?.[scratch]?.status).toBe('archived');
    expect(engine.getSnapshot().confirmations ?? {}).toEqual({});
  });

  it('跨 principal:owner 重审 → subject-unavailable;Broker 拒绝分流为结构化 denied', async () => {
    const { threadRel } = await buildFixtureA();
    const other = await getAuthorizedPresentationResult(threadRel, OTHER, ['local-demo']);
    expect(other.kind).toBe('subject-unavailable');
    expect(other.entity).toBeUndefined();

    const receipt = await getPresentationBroker().present(
      {
        schemaVersion: 1,
        requestId: `t56s1-cross-${RUN}`,
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

  it('呈现链路:focus=thread 走 generic planner 落 Sidecar——字段/动作/链接入树,角色成员卡入 repeat 区(P1.2 升级)', async () => {
    const { threadRel } = await buildFixtureA();
    const receipt = await getPresentationBroker().present(
      {
        schemaVersion: 1,
        requestId: `t56s1-plan-${RUN}`,
        principal: OWNER,
        subject: threadRel,
        intent: 'read',
        delivery: 'canvas',
        sourceMessageIds: [],
      },
      { grantedApplications: ['local-demo'] },
    );
    expect(receipt.status).toBe('ready');
    expect(receipt.sidecar).toBeDefined();
    expect(receipt.surfaceUrl).toBe(
      `/canvas?sidecar=${encodeURIComponent(receipt.sidecar!.id)}&focus=${encodeURIComponent(threadRel)}`,
    );

    const snapshot = await loadPresentationSnapshot(getDb());
    const version = snapshot.sidecars[receipt.sidecar!.id]!.versions[receipt.sidecar!.version]!;
    console.log(
      'T56S1_SURFACE',
      JSON.stringify({
        provenance: version.provenance,
        dependencies: version.dependencies.map((dependency) => ({
          id: dependency.id,
          mode: dependency.mode,
        })),
        nodes: summarizeTree(version.surface.root),
      }),
    );

    // 无 LLM/无应用 Recipe 命中 → generic fallback;binding-only(无字面展示值)。
    expect(version.provenance).toEqual({ kind: 'generic-fallback', ref: expect.any(String) });
    const nodes = summarizeTree(version.surface.root);
    // 依赖:id 方案 = entity/catalog/definition/policy(+ members rehydrate)。
    const dependencyIds = version.dependencies.map((dependency) => dependency.id);
    expect(dependencyIds).toEqual([
      `entity:${threadRel}`,
      'catalog:semantic',
      'definition:generic-intent-policy',
      'policy:local-demo',
      `members:${threadRel}`,
    ]);
    expect(version.dependencies.find(({ id }) => id === `members:${threadRel}`)?.mode).toBe(
      'rehydrate',
    );
    // 已声明字段入树;事件审计 link 与成员卡入树。
    const boundPaths = nodes.flatMap((node) => node.bindings ?? []).map((binding) => binding.ref);
    expect(boundPaths).toContain('property:properties.identity');
    expect(boundPaths).toContain('property:properties.statusText');
    expect(boundPaths).not.toContain('property:properties.resume');
    expect(boundPaths.some((ref) => ref.startsWith('actions:'))).toBe(true);
    expect(boundPaths.some((ref) => ref.startsWith('links:'))).toBe(true);
    const work = nodes.find((node) => node.kind === 'word' && node.word === 'work-content');
    expect(work).toBeDefined();
    // P1.2(D78 决定 2):active/approval 角色成员卡经 entities 进 repeat 区
    //(状态指针数组本身不作为 property 词位绑定——成员事实由 item 绑定 + deref 携带)。
    expect(boundPaths.some((ref) => ref.startsWith('property:properties.active'))).toBe(false);
    expect(boundPaths.some((ref) => ref.startsWith('property:properties.approval'))).toBe(false);
    // 通用行携带逐成员认知/动作,由同一词汇区分普通材料与知情决定面。
    const memberWord = work;
    expect(memberWord?.bindings).toEqual(
      expect.arrayContaining([
        { kind: 'entities', ref: `entities:${threadRel}` },
        { kind: 'actions', ref: `actions:${threadRel}` },
        { kind: 'links', ref: `links:${threadRel}` },
      ]),
    );
    expect(work!.role).toBe('primary-content');
    const entity = await getEngine(pool).then((engine) => engine.getEntity(threadRel));
    const pendingMember = entity!.entities!.find(
      (member) =>
        member.properties.category === 'approval' && member.properties.status === 'pending',
    );
    expect(pendingMember?.properties.presentation).toMatchObject({
      version: 1,
      traits: ['human-responsibility'],
    });
    expect(pendingMember?.actions.map((action) => action.name)).toEqual(['approve', 'reject']);
    const materialMember = entity!.entities!.find(
      (member) => member.properties.category === 'context',
    );
    expect(materialMember?.properties.presentation).toMatchObject({
      version: 1,
      traits: ['supporting-context'],
    });
    const presentation = entity!.properties.presentation as Record<string, unknown>;
    // P1.2(D78 决定 2/D54 单一落点):version:1 认知声明经服务层同合同可见。
    expect(presentation.version).toBe(1);
    expect(presentation.traits).toEqual(['human-responsibility', 'work-queue', 'work-context']);
    expect(presentation.groupRole).toBe('responsibility');
    expect(presentation.emptyMeaning).toBe('ready-to-start');
  });

  it('新鲜度:责任动作与成员变化重规划;授权变化重新裁剪', async () => {
    const { threadRel, pendingApprovalRel } = await buildFixtureA();
    const broker = getPresentationBroker();
    const request = {
      schemaVersion: 1 as const,
      principal: OWNER,
      subject: threadRel,
      intent: 'read',
      delivery: 'canvas' as const,
      sourceMessageIds: [],
    };
    const first = await broker.present(
      { ...request, requestId: `t56s1-v1-${RUN}` },
      { grantedApplications: ['local-demo'] },
    );
    expect(first.status).toBe('ready');

    // 批准既改变状态也移除成员的批准/驳回动作；成员合同变化必须重规划。
    await execAccepted(pendingApprovalRel, 'approve');
    const afterValueChange = await broker.present(
      { ...request, requestId: `t56s1-v2-${RUN}` },
      { grantedApplications: ['local-demo'] },
    );
    expect(afterValueChange.status).toBe('ready');
    expect(afterValueChange.sidecar?.id).toBe(first.sidecar?.id);
    expect(afterValueChange.sidecar!.version).toBeGreaterThan(first.sidecar!.version);

    // 成员变化:attach 新 context → links + members 指纹变化 → 重规划(版本演进)。
    await execAccepted(threadRel, 'attach', { category: 'context', rel: 'comment:c3' });
    const afterMembership = await broker.present(
      { ...request, requestId: `t56s1-v3-${RUN}` },
      { grantedApplications: ['local-demo'] },
    );
    expect(afterMembership.status).toBe('ready');
    expect(afterMembership.sidecar!.id).toBe(first.sidecar!.id);
    expect(afterMembership.sidecar!.version).toBeGreaterThan(first.sidecar!.version);

    // 授权变化:同一 durable 键(principal/subject/intent/device),授予集合不同
    // → entity 指纹(链接被裁)+ policy 指纹同时失效 → 再次重规划。
    const afterGrantChange = await broker.present(
      { ...request, requestId: `t56s1-v4-${RUN}` },
      { grantedApplications: ['publishing'] },
    );
    expect(afterGrantChange.status).toBe('ready');
    expect(afterGrantChange.sidecar!.version).toBeGreaterThan(afterMembership.sidecar!.version);
    const snapshot = await loadPresentationSnapshot(getDb());
    const revised =
      snapshot.sidecars[first.sidecar!.id]!.versions[afterGrantChange.sidecar!.version]!;
    expect(revised.dependencies.map((dependency) => dependency.id)).toContain('policy:publishing');
    expect(
      revised.dependencies.find(({ id }) => id === `entity:${threadRel}`)?.fingerprint,
    ).not.toEqual(
      snapshot.sidecars[first.sidecar!.id]!.versions[first.sidecar!.version]!.dependencies.find(
        ({ id }) => id === `entity:${threadRel}`,
      )?.fingerprint,
    );
  });
});
