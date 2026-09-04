import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  assertMetaBootstrapIntegrity,
  planMetaBootstrap,
  validateApplicationBundleDraft,
} from '@ui4a/engine';
import {
  appendDraftCommand,
  ensureDraftTables,
  getDraft,
  payloadSha256,
  rebuildDraftProjection,
} from '@ui4a/db/drafts';
import { appendEvent, ensureEventsTable, listEvents, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';
import { executeDraftMeta, getDraftMetaEntity } from './drafts';

// T48 Phase 2 / T2.2:application-bundle Draft 的人类激活事务(DECISIONS.md D66.3)。
// approve 在 Draft 锁内重验(valid / target 未安装 / payloadHash 对齐锁定版本)后,
// 用与启动 bootstrap 同源的 planMetaBootstrap 规划事件,经 acceptDraftWithCoreEvent
// 与 draft-accepted 同事务原子落库:新 app 出生即进 applications 全集,sitemap 可见
// 其 flow 入口,receipt 幂等,全 log 重放后集合一致(I5),Agent 不批(I4),
// 同名双写者竞态判 stale 并留痕(I6)。
const pool = getPool(process.env.DATABASE_URL!);
const OWNER = 'user:mike';
const SCOPE = 'development';

function bundlePayload(bundleName = 'demo-bundle'): Record<string, unknown> {
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name: bundleName, version: 1 },
    applications: [
      { name: bundleName, title: 'Demo', intent: 'Demonstrate a governed bundle installation' },
    ],
    capabilities: [],
    flows: [
      {
        name: `${bundleName}-entry`,
        title: 'Demo entry',
        app: bundleName,
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    ],
    seed: { rel: `seed:${bundleName}`, detail: { instances: {} } },
  };
}

let engine: Awaited<ReturnType<typeof getEngine>>;

async function submitBundle(
  bundleName: string,
  commandPrefix: string,
): Promise<{ rel: string; activation: string; draftId: string }> {
  const created = await executeDraftMeta(
    pool,
    engine,
    {
      rel: 'meta/drafts',
      action: 'create',
      actor: 'agent',
      principal: OWNER,
      channel: 'cli',
      params: {
        kind: 'application-bundle',
        target: bundleName,
        commandId: `${commandPrefix}:create`,
        payload: bundlePayload(bundleName),
      },
    },
    { policyScope: SCOPE },
  );
  expect(created.kind).toBe('accepted');
  const rel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
  const draftId = rel.slice('draft:'.length);
  const submitted = await executeDraftMeta(
    pool,
    engine,
    {
      rel,
      action: 'submit',
      actor: 'agent',
      principal: OWNER,
      channel: 'cli',
      params: { commandId: `${commandPrefix}:submit` },
    },
    { policyScope: SCOPE },
  );
  expect(submitted.kind).toBe('accepted');
  const activation = String(
    submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
  );
  return { rel, activation, draftId };
}

function approve(activation: string, commandId: string, actor: 'human' | 'agent' = 'human') {
  return executeDraftMeta(
    pool,
    engine,
    {
      rel: activation,
      action: 'approve',
      actor,
      principal: OWNER,
      channel: actor === 'human' ? 'human-renderer' : 'cli',
      params: { commandId },
    },
    { policyScope: SCOPE },
  );
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  engine = await getEngine(pool);
});

describe('governed application-bundle Draft activation', () => {
  it('installs the bundle atomically and the application is born into scope', async () => {
    const { rel, activation } = await submitBundle('demo-bundle', 'act:install');

    const approved = await approve(activation, 'act:install:approve');
    expect(approved.kind).toBe('accepted');
    expect(approved.kind === 'accepted' && approved.entity.properties.status).toBe('accepted');

    // 原子性:seed 事件族 + bootstrap receipt 先于 draft-accepted,与启动 bootstrap 同种。
    // (boot 已播种内置 bundle,故按本 bundle 的 rel 精确圈定。)
    const events = await listEvents(pool);
    const acceptedSeq = events.find((event) => event.kind === 'draft-accepted')!.seq;
    const installed = events.filter(
      (event) =>
        event.domain === 'core' &&
        [
          'meta/application:demo-bundle',
          'meta/flow:demo-bundle-entry',
          'seed:demo-bundle',
          'meta/bootstrap:demo-bundle@1',
        ].includes(event.rel ?? ''),
    );
    expect(installed.map((event) => event.kind)).toEqual([
      'application-seeded',
      'definition-seeded',
      'seed',
      'meta-bootstrap-applied',
    ]);
    for (const event of installed) expect(event.seq).toBeLessThan(acceptedSeq);
    const receipt = installed.at(-1)!;
    expect(receipt.rel).toBe('meta/bootstrap:demo-bundle@1');
    expect(receipt.actor).toBe('agent');
    expect(receipt.principal).toBe('system:meta-bootstrap');

    // 出生效果:engine 投影 + sitemap 可见新 app 与其 flow 入口。
    await engine.readSnapshot();
    const snapshot = engine.getSnapshot();
    expect(snapshot.applications?.['demo-bundle']).toMatchObject({
      name: 'demo-bundle',
      title: 'Demo',
    });
    expect(snapshot.definitions?.['demo-bundle-entry']).toMatchObject({ version: 1 });
    const sitemap = engine.getSitemap();
    expect(sitemap.applications.map((application) => application.name)).toContain('demo-bundle');
    expect(
      sitemap.applications.find((application) => application.name === 'demo-bundle')?.flows,
    ).toEqual([expect.objectContaining({ name: 'demo-bundle-entry', app: 'demo-bundle' })]);
    expect(sitemap.flows.map((flow) => flow.name)).toContain('demo-bundle-entry');
    expect(sitemap.surfaces.map((surface) => surface.rel)).toContain('flow:demo-bundle-entry');

    // 完整性与幂等:receipt 清单可由日志证明;同 bundle 再规划 → 空数组。
    const log = await readLog(pool);
    expect(() => assertMetaBootstrapIntegrity(log)).not.toThrow();
    const bundle = validateApplicationBundleDraft(bundlePayload()).value;
    expect(bundle).toBeDefined();
    expect(planMetaBootstrap(bundle!, log)).toEqual([]);
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'accepted',
    );
  });

  it('replays the whole log into the same application set (I5)', async () => {
    const { activation, draftId } = await submitBundle('demo-bundle', 'act:replay');
    expect((await approve(activation, 'act:replay:approve')).kind).toBe('accepted');
    await engine.readSnapshot();

    const before = engine.getSnapshot();
    const applicationNames = Object.keys(before.applications ?? {}).sort();
    const flowNames = Object.keys(before.definitions ?? {}).sort();
    expect(applicationNames).toContain('demo-bundle');

    // 业务投影即内存 fold:清空单例后全量重放,集合必须与重放前一致。
    resetEngineForTests();
    const reborn = await getEngine(pool);
    const after = reborn.getSnapshot();
    expect(Object.keys(after.applications ?? {}).sort()).toEqual(applicationNames);
    expect(Object.keys(after.definitions ?? {}).sort()).toEqual(flowNames);
    expect(reborn.getSitemap().surfaces.map((surface) => surface.rel)).toContain(
      'flow:demo-bundle-entry',
    );

    // Draft 投影可重建,激活终态不变。
    await pool.query('TRUNCATE draft_projection');
    await rebuildDraftProjection(pool);
    expect((await getDraft(pool, draftId, OWNER, SCOPE))?.aggregate.status).toBe('accepted');
  });

  it('refuses Agent approval with an audited rejection and installs nothing', async () => {
    const { rel, activation } = await submitBundle('demo-bundle', 'act:agent');

    const denied = await approve(activation, 'act:agent:approve', 'agent');
    expect(denied).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    const events = await listEvents(pool);
    expect(
      events.filter((event) => event.kind === 'action-rejected' && event.action === 'approve'),
    ).toHaveLength(1);
    // boot 播种的内置 application 仍在;本 bundle 的任何安装痕迹必须为零。
    expect(events.filter((event) => event.rel === 'meta/application:demo-bundle')).toEqual([]);
    expect(events.filter((event) => event.rel === 'meta/flow:demo-bundle-entry')).toEqual([]);
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'pending-approval',
    );
  });

  it('marks the Draft stale when the bundle inventory conflicts with installed names (D66.1 fail-closed)', async () => {
    // 评审修复:bundle 名(target)全新,但 applications 声明了 boot 已安装的
    // 次级名称 default。机器门禁必须 fail-closed 拒绝并留痕(I6),不得按
    // bootstrap 幂等语义静默跳过部分安装。
    const payload = bundlePayload('fresh-bundle');
    (payload.applications as unknown[]).push({
      name: 'default',
      title: 'Conflicting secondary application',
      intent: 'Already installed by the built-in bootstrap',
    });
    const created = await executeDraftMeta(
      pool,
      engine,
      {
        rel: 'meta/drafts',
        action: 'create',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: {
          kind: 'application-bundle',
          target: 'fresh-bundle',
          commandId: 'act:conflict:create',
          payload,
        },
      },
      { policyScope: SCOPE },
    );
    expect(created.kind).toBe('accepted');
    const rel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'submit',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: { commandId: 'act:conflict:submit' },
      },
      { policyScope: SCOPE },
    );
    expect(submitted.kind).toBe('accepted');
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );

    await expect(approve(activation, 'act:conflict:approve')).rejects.toThrow(
      'conflicts with installed',
    );
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'stale',
    );
    // 拒绝留痕之外零安装:无出生事件、无 receipt、无 draft-accepted。
    const events = await listEvents(pool);
    expect(events.filter((event) => event.kind === 'draft-staled')).toHaveLength(1);
    expect(JSON.stringify(events.find((event) => event.kind === 'draft-staled')?.detail)).toContain(
      'default',
    );
    expect(events.filter((event) => event.rel === 'meta/application:fresh-bundle')).toEqual([]);
    expect(events.filter((event) => event.rel === 'meta/flow:fresh-bundle-entry')).toEqual([]);
    expect(events.filter((event) => event.rel === 'meta/bootstrap:fresh-bundle@1')).toEqual([]);
    expect(events.filter((event) => event.kind === 'draft-accepted')).toEqual([]);
  });

  it('marks the Draft stale when another path installs the same application first', async () => {
    const { rel, activation } = await submitBundle('demo-bundle', 'act:race');

    // 双写者:批准前另一路径已安装同名 application。
    await appendEvent(pool, {
      kind: 'application-seeded',
      rel: 'meta/application:demo-bundle',
      actor: 'agent',
      principal: 'system:other-path',
      channel: 'meta',
      detail: {
        name: 'demo-bundle',
        definition: { name: 'demo-bundle', title: 'Demo', intent: 'Installed by another path' },
      },
    });
    await engine.readSnapshot();

    await expect(approve(activation, 'act:race:approve')).rejects.toThrow('stale');
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'stale',
    );
    const events = await listEvents(pool);
    const staled = events.filter((event) => event.kind === 'draft-staled');
    expect(staled).toHaveLength(1);
    expect(JSON.stringify(staled[0]?.detail)).toContain('installed concurrently');
    // 拒绝留痕之外不落任何该 bundle 的安装事件(无 flows、无 receipt)。
    expect(events.filter((event) => event.rel === 'meta/flow:demo-bundle-entry')).toEqual([]);
    expect(events.filter((event) => event.rel === 'meta/bootstrap:demo-bundle@1')).toEqual([]);
  });

  it('re-verifies the bare application name contract at activation (T50 P4 / D69.4)', async () => {
    // 预守卫事件形状:直接落库 target 带 `application:` 前缀的既有 Draft
    // (绕过 create 守卫,模拟守卫出生前已存在的事件流;engine 对 bundle.name
    // 只做非空校验,该 payload 可解析为 ready)。激活必须在 Draft 锁内
    // 重验同判,绝不把带前缀的 application 名安装进库。
    const target = 'application:preceding-notes';
    const payload = bundlePayload(target);
    const commandId = 'act:bare:preceding-create';
    const draftId = createHash('sha256')
      .update(`${OWNER}\0${SCOPE}\0${commandId}`)
      .digest('hex')
      .slice(0, 20);
    await appendDraftCommand(
      pool,
      {
        kind: 'create',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        owner: OWNER,
        policyScope: SCOPE,
        draftKind: 'application-bundle',
        target,
        payloadHash: payloadSha256(payload),
        schemaRef: 'ui4a://application-bundle/v1',
        provenance: { actor: 'agent', principal: OWNER, commandId, sources: [] },
        validation: { valid: true, issues: [] },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      payload,
    );
    const rel = `draft:${draftId}`;
    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'submit',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: { commandId: 'act:bare:submit' },
      },
      { policyScope: SCOPE },
    );
    expect(submitted.kind).toBe('accepted');
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );

    await expect(approve(activation, 'act:bare:approve')).rejects.toThrow(
      'application bundle target must be a bare application name',
    );
    // 同判拒绝之外零安装:无出生事件、无 receipt、无 draft-accepted。
    const events = await listEvents(pool);
    expect(events.filter((event) => event.kind === 'draft-accepted')).toEqual([]);
    expect(events.filter((event) => event.rel === 'meta/application:preceding-notes')).toEqual([]);
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'pending-approval',
    );
  });
});
