import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { SurfaceNode } from '@ui4a/engine';
import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable } from '@ui4a/db/events';
import { ensurePresentationTables, loadPresentationSnapshot } from '@ui4a/db/presentation';
import { getPool } from '@ui4a/db/pool';

import { getDb, getEngine, resetEngineForTests } from '../../service';
import { executeDraftMeta } from '../../drafts/drafts';
import { getAuthorizedPresentationResult } from '../../presentation/authorized-entity';
import { getPresentationBroker, resetPresentationBrokerForTests } from '../../presentation/runtime';
/**
 * 扩展性与有界读(T56 P1.3 A7/A8/A9;US11,Fixture H/I)。
 *
 * A7:未在 UI/产品代码硬编码的第二应用经治理通道(genesis Draft)装入后,工作线
 *     成员卡/责任卡/version:1 声明照常产出——纯投影零应用分支,零前端改动可读;
 * A8:无 version:1 认知声明的主体(threads 集合)走既有 generic 路径诚实显示,
 *     成员区维持 relation 角色,不被 trait 通路改写;
 * A9:30 个长标题材料的大工作集——呈现计划只依赖主体一份实体合同(有界读,
 *     零逐成员 N+1),成员卡不截断、无伪造分页;部分不可读(一个 context 无授权)
 *     时其余卡照常(「当前可见」口径);dangling 读取失败以自身卡可见,不与真空混淆。
 */

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test');
const RUN = randomUUID().slice(0, 8);
const OWNER = 'user:t56p13-owner';
const GOAL = '吸收一个全新应用的工作材料并给出决定';

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await ensurePresentationTables(pool);
  await pool.query('TRUNCATE events');
  await pool.query('TRUNCATE draft_projection, draft_payloads');
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

/** agent 发起 high 确认动作并挂起,返回 confirmation rel。 */
async function execSuspend(rel: string, action: string): Promise<string> {
  const engine = await getEngine(pool);
  const outcome = await engine.exec({
    rel,
    action,
    params: {},
    actor: 'agent',
    principal: OWNER,
    channel: 'http',
  });
  if (outcome.kind !== 'suspended') {
    throw new Error(`${rel}.${action} 预期 suspended,实际 ${outcome.kind}`);
  }
  return `confirmation:${outcome.confirmation.id}`;
}

/** genesis 装入一个全新应用(create → submit → approve;与 /_meta 合同同门)。
 *  flow 提供登记材料(log-material,append 效果)与 high 确认动作(request-archive)。 */
async function installExtensionApp(name: string): Promise<string> {
  const flow = `${name}-review`;
  const engine = await getEngine(pool);
  const draftMeta = (
    action: string,
    params: Record<string, unknown>,
    rel = 'meta/drafts',
    actor: 'human' | 'agent' = 'agent',
  ) =>
    executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action,
        actor,
        principal: OWNER,
        channel: actor === 'human' ? 'human-renderer' : 'cli',
        params,
      },
      { policyScope: 'development' },
    );
  const payload = {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name, version: 1 },
    applications: [{ name, title: '扩展评审应用', intent: 'T56 P1.3 Fixture H:全新应用' }],
    capabilities: [],
    flows: [
      {
        name: flow,
        title: '扩展评审',
        app: name,
        initial: 'review',
        collections: [{ collection: `${name}-materials`, title: '扩展材料' }],
        fields: [
          { name: 'title', type: 'text', title: '标题', presentation: { role: 'identity' } },
        ],
        nodes: [
          {
            name: 'review',
            title: '评审中',
            fields: [],
            actions: [
              {
                name: 'log-material',
                title: '登记材料',
                to: 'review',
                fields: [{ name: 'title', type: 'text', required: true }],
                effect: [
                  { type: 'transition', to: 'review' },
                  {
                    type: 'append',
                    collection: `${name}-materials`,
                    'resource-type': 'material',
                    'name-from': 'title',
                    node: 'logged',
                  },
                ],
              },
              {
                name: 'request-archive',
                title: '请求归档',
                to: 'archived',
                'requires-confirmation': 'high',
                fields: [],
                effect: [{ type: 'transition', to: 'archived' }],
              },
            ],
          },
          { name: 'archived', title: '已归档', fields: [], actions: [] },
        ],
      },
    ],
    seed: {
      rel: `seed:${name}`,
      detail: {
        instances: { [`${flow}:main`]: { rel: `${flow}:main`, flow, node: 'review', fields: {} } },
      },
    },
  };
  const created = await draftMeta('create', {
    kind: 'application-bundle',
    target: name,
    commandId: `${name}:create`,
    payload,
  });
  expect(created.kind, 'genesis create 应通过').toBe('accepted');
  const draftRel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
  const submitted = await draftMeta('submit', { commandId: `${name}:submit` }, draftRel);
  expect(submitted.kind).toBe('accepted');
  const activation = String(
    submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
  );
  const approved = await draftMeta(
    'approve',
    { commandId: `${name}:approve` },
    activation,
    'human',
  );
  expect(approved.kind, 'genesis approve 应通过').toBe('accepted');
  await engine.readSnapshot();
  expect(engine.getSnapshot().applications?.[name]).toBeDefined();
  return flow;
}

interface ExtensionFixture {
  threadRel: string;
  app: string;
  materialRels: string[];
  pendingApprovalRel: string;
}

/** 装入全新应用 + 登记 2 材料 + agent 请求归档挂起确认 + 线上挂 2 context 与 1 approval。 */
async function buildExtensionFixture(): Promise<ExtensionFixture> {
  const app = `t56p13-h-${RUN}`;
  const flow = await installExtensionApp(app);
  await execAccepted(`${flow}:main`, 'log-material', { title: `扩展材料甲 ${RUN}` }, 'agent');
  await execAccepted(`${flow}:main`, 'log-material', { title: `扩展材料乙 ${RUN}` }, 'agent');
  const materialRels = (await getEngine(pool)).getSnapshot().collections[`${app}-materials`] ?? [];
  expect(materialRels).toHaveLength(2);
  const pendingApprovalRel = await execSuspend(`${flow}:main`, 'request-archive');
  const threadId = `t56p13-h-${RUN}`;
  await execAccepted('threads', 'create', {
    commandId: threadId,
    goal: GOAL,
  });
  const attach = (category: string, rel: string): Promise<void> =>
    execAccepted(`thread:${threadId}`, 'attach', { category, rel });
  for (const rel of materialRels) await attach('context', rel);
  await attach('approval', pendingApprovalRel);
  return { threadRel: `thread:${threadId}`, app, materialRels, pendingApprovalRel };
}

async function readAuthorized(rel: string, grantedApplications: readonly string[]) {
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

function collectNodes(node: SurfaceNode, out: SurfaceNode[]): void {
  out.push(node);
  if (node.kind === 'layout') for (const child of node.children) collectNodes(child, out);
  if (node.kind === 'slot') collectNodes(node.child, out);
  if (node.kind === 'repeat') collectNodes(node.item, out);
}

function nodesOf(surface: SurfaceNode): SurfaceNode[] {
  const out: SurfaceNode[] = [];
  collectNodes(surface, out);
  return out;
}

describe('第二应用零改动可读(P1.3 A7/US11 Fixture H)', () => {
  it('全新应用的声明身份/责任语义经同一投影产出:成员卡/责任卡/version:1 声明/呈现计划照常', async () => {
    const { threadRel, app, materialRels, pendingApprovalRel } = await buildExtensionFixture();
    // 全授予读:两张材料卡(声明 title 身份解引用)+ 一张责任卡(声明动作)。
    const entity = await readAuthorized(threadRel, [app]);
    expect(cardRels(entity)).toEqual([...materialRels, pendingApprovalRel]);
    const firstMaterial = (entity.entities ?? []).find(
      (member) => (member.properties as { rel?: string }).rel === materialRels[0],
    );
    expect(firstMaterial!.class).toEqual(['thread-reference']);
    expect(firstMaterial!.properties).toMatchObject({
      identity: `扩展材料甲 ${RUN}`,
      status: 'logged',
      category: 'context',
    });
    const approvalCard = (entity.entities ?? []).find(
      (member) => (member.properties as { rel?: string }).rel === pendingApprovalRel,
    );
    expect(approvalCard!.properties).toMatchObject({
      identity: 'request-archive · 由 agent 提议',
      status: 'pending',
      category: 'approval',
    });
    expect(approvalCard!.actions.map((action) => action.name)).toEqual(['approve', 'reject']);
    const presentation = entity.properties.presentation as Record<string, unknown>;
    expect(presentation.version).toBe(1);
    expect(presentation.traits).toEqual(['human-responsibility', 'work-queue']);

    // 同一呈现链路逐成员携带认知:普通对象摘要行,当前责任由词汇展开为决定卡。
    const receipt = await present(threadRel, `t56p13-h-present-${RUN}`, [app]);
    expect(receipt.status).toBe('ready');
    const snapshot = await loadPresentationSnapshot(getDb());
    const version = snapshot.sidecars[receipt.sidecar!.id]!.versions[receipt.sidecar!.version]!;
    expect(version.provenance.kind).toBe('generic-fallback');
    const nodes = nodesOf(version.surface.root);
    const memberWord = nodes.find((node) => node.kind === 'word' && node.word === 'member-row');
    expect(memberWord).toMatchObject({
      bindings: {
        cognitive: { kind: 'item', path: 'properties.presentation' },
        members: { kind: 'item', path: 'entities' },
        actions: { kind: 'item', path: 'actions' },
      },
    });
    expect(firstMaterial!.properties.presentation).toMatchObject({
      version: 1,
      traits: ['work-queue'],
    });
    expect(approvalCard!.properties.presentation).toMatchObject({
      version: 1,
      traits: ['human-responsibility'],
    });
    const repeat = nodes.find((node) => node.kind === 'repeat');
    expect(repeat!.role).toBe('primary-content');

    // 批准后责任卡动作消失(与内置应用同门,动作照常可提交)。
    await execAccepted(pendingApprovalRel, 'approve');
    const after = await readAuthorized(threadRel, [app]);
    const decidedCard = (after.entities ?? []).find(
      (member) => (member.properties as { rel?: string }).rel === pendingApprovalRel,
    );
    expect(decidedCard!.actions).toEqual([]);
    expect(decidedCard!.properties.presentation).toMatchObject({
      version: 1,
      traits: ['human-responsibility', 'task-history'],
    });
  });
});

describe('无 version:1 声明的主体走既有 generic 路径(P1.3 A8/US11)', () => {
  it('threads 集合:成员区维持 relation 角色,计划不被 trait 通路改写', async () => {
    await execAccepted('threads', 'create', {
      commandId: `t56p13-u-${RUN}`,
      goal: '未知语义对照线',
    });
    const receipt = await present('threads', `t56p13-u-present-${RUN}`, ['local-demo']);
    expect(receipt.status).toBe('ready');
    const snapshot = await loadPresentationSnapshot(getDb());
    const version = snapshot.sidecars[receipt.sidecar!.id]!.versions[receipt.sidecar!.version]!;
    expect(version.provenance).toEqual({ kind: 'generic-fallback', ref: expect.any(String) });
    const nodes = nodesOf(version.surface.root);
    const repeat = nodes.find((node) => node.kind === 'repeat');
    expect(repeat).toBeDefined();
    // 无 traits 声明 → 成员区角色 = relation(历史树形),不冒充责任主内容。
    expect(repeat!.role).toBe('relation');
  });
});

describe('大工作集与部分不可读(P1.3 A9/US11 Fixture I)', () => {
  it('30 个长标题材料:呈现计划只依赖主体一份合同(有界读),成员卡不截断、无伪造分页;部分不可读时其余卡照常,dangling 以自身卡可见', async () => {
    const app = `t56p13-i-${RUN}`;
    const flow = await installExtensionApp(app);
    const threadId = `t56p13-i-${RUN}`;
    await execAccepted('threads', 'create', {
      commandId: threadId,
      goal: GOAL,
    });
    const longTitle = (index: number): string =>
      `t56p13 长标题材料 ${String(index).padStart(2, '0')} ${'很长的标题'.repeat(24)} ${RUN}`;
    for (let index = 0; index < 30; index += 1) {
      await execAccepted(`${flow}:main`, 'log-material', { title: longTitle(index) }, 'agent');
    }
    const materialRels =
      (await getEngine(pool)).getSnapshot().collections[`${app}-materials`] ?? [];
    expect(materialRels).toHaveLength(30);
    const attach = (category: string, rel: string): Promise<void> =>
      execAccepted(`thread:${threadId}`, 'attach', { category, rel });
    for (const rel of materialRels) await attach('context', rel);
    // 一条 dangling 引用(读取失败以自身卡可见)+ 一条他应用材料(publishing)。
    await attach('context', `material:never-created-${RUN}`);
    await attach('context', 'post:first-post');

    // 有界读:呈现计划的实体合同依赖只有主体一份(成员事实由客户端按需 deref,
    // 服务端计划零逐成员实体依赖,读请求数不随 N 放大)。
    const receipt = await present(`thread:${threadId}`, `t56p13-i-present-${RUN}`, ['local-demo']);
    expect(receipt.status).toBe('ready');
    const sidecarSnapshot = await loadPresentationSnapshot(getDb());
    const version =
      sidecarSnapshot.sidecars[receipt.sidecar!.id]!.versions[receipt.sidecar!.version]!;
    const entityContractRefs = version.dependencies
      .filter(({ kind }) => kind === 'entity-contract')
      .map(({ ref }) => ref);
    expect(entityContractRefs).toEqual([`thread:${threadId}`]);

    // 不截断:全部 32 张可见卡在列(context 31 条 + dangling 计入 context),
    // 且无线程级 next/prev 伪造分页链接(分页真实 = 无声明链接时零零件)。
    const entity = await readAuthorized(`thread:${threadId}`, ['local-demo']);
    expect(entity.properties.context).toHaveLength(32);
    expect(cardRels(entity)).toHaveLength(32);
    expect(entity.links.some((link) => link.rel.includes('next'))).toBe(false);
    expect(entity.links.some((link) => link.rel.includes('prev'))).toBe(false);
    const danglingCard = (entity.entities ?? []).find(
      (member) => (member.properties as { rel?: string }).rel === `material:never-created-${RUN}`,
    );
    expect(danglingCard!.class).toEqual(['thread-reference', 'dangling']);
    expect(danglingCard!.properties).toMatchObject({ status: '对象不存在' });

    // 部分不可读(扩展应用 30 卡全部无授权):其余卡照常——「当前可见」口径,
    // 区域不因批量不可读变成真空,也不泄露被裁对象的标题/rel。
    const trimmed = await readAuthorized(`thread:${threadId}`, ['publishing']);
    // 卡序 = 引用序(dangling 先于 post 挂载);可见卡 = dangling + 授权内 post。
    expect(cardRels(trimmed)).toEqual([`material:never-created-${RUN}`, 'post:first-post']);
    const serialized = JSON.stringify(trimmed);
    expect(serialized).not.toContain('很长的标题');
    expect(serialized).not.toContain('material:t56p13-00');
  });
});
