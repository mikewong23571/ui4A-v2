import { beforeEach, describe, expect, it } from 'vitest';

import { flowSeedEvent } from '@ui4a/engine';
import type { FlowDefinition } from '@ui4a/shared';

import { ensureDraftTables, getDraft, rebuildDraftProjection } from '@ui4a/db/drafts';
import { appendEvent, ensureEventsTable, listEvents } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';
import { executeDraftMeta, getDraftMetaEntity } from './drafts';

// T48 Phase 4 / D67.3:kind=flow-definition 且 target 不存在时的 genesis 提案。
// create 在名称口径与声明 lens 内建立无基准 Draft(baseVersion undefined);
// 人类 approve 激活时产与启动 bootstrap 同种的 definition-seeded 出生事件
// (flowSeedEvent 同一构造器),sitemap 生长出全新 flow 入口;全 log 重放
// 集合一致(I5),Agent 不批(I4),同名双写者竞态判 stale 留痕(I6)。
const pool = getPool(process.env.DATABASE_URL!);
const OWNER = 'user:mike';
const SCOPE = 'publishing';
const TARGET = 'publishing-notes';

function genesisPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: TARGET,
    title: 'Publishing notes',
    app: SCOPE,
    initial: 'draft',
    nodes: [{ name: 'draft', title: 'Draft', fields: [], actions: [] }],
    fields: [],
    ...overrides,
  };
}

let engine: Awaited<ReturnType<typeof getEngine>>;

function draftMeta(
  action: string,
  params: Record<string, unknown>,
  rel = 'meta/drafts',
  actor: 'human' | 'agent' = 'agent',
) {
  return executeDraftMeta(
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
    { policyScope: SCOPE },
  );
}

function draftRelOf(outcome: Awaited<ReturnType<typeof executeDraftMeta>>): string {
  expect(outcome.kind).toBe('accepted');
  return outcome.kind === 'accepted' ? String(outcome.entity.properties.rel) : '';
}

/** create(genesis,有效 payload)→ submit,返回 draft/activation rel。 */
async function submitGenesis(
  commandPrefix: string,
  payload: Record<string, unknown> = genesisPayload(),
): Promise<{ rel: string; activation: string; draftId: string }> {
  const created = await draftMeta('create', {
    kind: 'flow-definition',
    target: TARGET,
    commandId: `${commandPrefix}:create`,
    payload,
  });
  const rel = draftRelOf(created);
  const submitted = await draftMeta('submit', { commandId: `${commandPrefix}:submit` }, rel);
  expect(submitted.kind).toBe('accepted');
  const activation = String(
    submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
  );
  return { rel, activation, draftId: rel.slice('draft:'.length) };
}

function approve(activation: string, commandId: string, actor: 'human' | 'agent' = 'human') {
  return draftMeta('approve', { commandId }, activation, actor);
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  engine = await getEngine(pool);
});

describe('governed flow-genesis Draft (D67.3)', () => {
  it('creates a genesis Draft for a missing target with no base version', async () => {
    const created = await draftMeta('create', {
      kind: 'flow-definition',
      target: TARGET,
      commandId: 'genesis:create',
      payload: genesisPayload(),
    });
    expect(created.kind).toBe('accepted');
    expect(created.kind === 'accepted' && created.entity.properties).toMatchObject({
      kind: 'flow-definition',
      target: TARGET,
      status: 'ready',
      policyScope: SCOPE,
    });
    expect(created.kind === 'accepted' && created.entity.properties.baseVersion).toBeUndefined();
    const stored = await getDraft(pool, draftIdOf(created), OWNER, SCOPE);
    expect(stored?.aggregate.kind).toBe('flow-definition');
    expect(stored?.aggregate.baseVersion).toBeUndefined();
    // genesis 提案不触碰定义面:快照仍无该 flow。
    expect(engine.getSnapshot().definitions?.[TARGET]).toBeUndefined();
  });

  it('rejects illegal names and cross-lens candidates with audited rejections', async () => {
    const before = (await listEvents(pool)).filter(({ kind }) => kind === 'action-rejected');

    const illegal = await draftMeta('create', {
      kind: 'flow-definition',
      target: 'Publishing_Notes',
      commandId: 'genesis:illegal-name',
      payload: genesisPayload({ name: 'Publishing_Notes' }),
    });
    expect(illegal).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      reason: expect.stringContaining('not a valid flow name'),
    });

    const crossLens = await draftMeta('create', {
      kind: 'flow-definition',
      target: TARGET,
      commandId: 'genesis:cross-lens',
      payload: genesisPayload({ app: 'community' }),
    });
    expect(crossLens).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      reason: expect.stringContaining('outside the credential policy scope'),
    });

    const rejectedEvents = (await listEvents(pool)).filter(
      ({ kind }) => kind === 'action-rejected',
    );
    expect(rejectedEvents).toHaveLength(before.length + 2);
    expect(rejectedEvents.slice(-2)).toEqual([
      expect.objectContaining({ rel: 'meta/drafts', action: 'create' }),
      expect.objectContaining({ rel: 'meta/drafts', action: 'create' }),
    ]);
    // 两次拒绝都不建立 Draft。
    expect((await listEvents(pool)).filter(({ kind }) => kind === 'draft-created')).toHaveLength(0);
  });

  it('revises and revalidates a genesis Draft normally', async () => {
    const created = await draftMeta('create', {
      kind: 'flow-definition',
      target: TARGET,
      commandId: 'genesis:revise:create',
      payload: genesisPayload({ title: 'First cut' }),
    });
    const rel = draftRelOf(created);
    expect(created.kind === 'accepted' && created.entity.properties.status).toBe('ready');

    const revised = await draftMeta(
      'revise',
      {
        commandId: 'genesis:revise:fix',
        baseVersion: 1,
        payload: genesisPayload(),
      },
      rel,
    );
    expect(revised.kind === 'accepted' && revised.entity.properties).toMatchObject({
      status: 'ready',
      version: 2,
    });

    const validated = await draftMeta('validate', { commandId: 'genesis:validate' }, rel);
    expect(validated.kind === 'accepted' && validated.entity.properties.status).toBe('ready');
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'ready',
    );
  });

  it('births the flow on human approval with the bootstrap-shaped seed event', async () => {
    const { rel, activation } = await submitGenesis('genesis:birth');

    const approved = await approve(activation, 'genesis:birth:approve');
    expect(approved.kind).toBe('accepted');
    expect(approved.kind === 'accepted' && approved.entity.properties.status).toBe('accepted');

    // 出生事件与启动 bootstrap 同种:先于 draft-accepted,kind/rel/provenance/
    // detail 与 flowSeedEvent 构造器输出逐字段一致,并与 boot 播种的
    // definition-seeded 先例(post-status)同键集。
    const events = await listEvents(pool);
    const acceptedSeq = events.find((event) => event.kind === 'draft-accepted')!.seq;
    const births = events.filter(
      (event) => event.kind === 'definition-seeded' && event.rel === `meta/flow:${TARGET}`,
    );
    expect(births).toHaveLength(1);
    const birth = births[0]!;
    expect(birth.seq).toBeLessThan(acceptedSeq);
    expect(birth).toMatchObject({
      kind: 'definition-seeded',
      rel: `meta/flow:${TARGET}`,
      actor: 'agent',
      principal: 'system:meta-bootstrap',
      channel: 'meta',
    });
    expect(birth.detail).toMatchObject({ name: TARGET, version: 1, status: 'active' });
    const born = birth.detail as { definition: FlowDefinition };
    expect(birth.detail).toEqual(flowSeedEvent(born.definition).detail);
    const precedent = events.find(
      (event) => event.kind === 'definition-seeded' && event.rel === 'meta/flow:post-status',
    );
    expect(Object.keys(birth.detail as Record<string, unknown>).sort()).toEqual(
      Object.keys((precedent?.detail as Record<string, unknown>) ?? {}).sort(),
    );

    // 出生效果:definitions/版本历史/sitemap 出现新 flow 与 flow-entry 入口。
    await engine.readSnapshot();
    const snapshot = engine.getSnapshot();
    expect(snapshot.definitions?.[TARGET]).toMatchObject({ version: 1, status: 'active' });
    expect(snapshot.definitionVersions?.[TARGET]?.[1]).toBeDefined();
    const sitemap = engine.getSitemap();
    expect(sitemap.flows.map((flow) => flow.name)).toContain(TARGET);
    expect(sitemap.surfaces.map((surface) => surface.rel)).toContain(`flow:${TARGET}`);
    const scopedFlows =
      sitemap.applications.find((application) => application.name === SCOPE)?.flows ?? [];
    expect(scopedFlows.map((flow) => flow.name)).toContain(TARGET);
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'accepted',
    );
  });

  it('replays the whole log into the same flow set (I5)', async () => {
    const { draftId, activation } = await submitGenesis('genesis:replay');
    expect((await approve(activation, 'genesis:replay:approve')).kind).toBe('accepted');
    await engine.readSnapshot();

    const before = engine.getSnapshot();
    const entry = before.definitions?.[TARGET];
    const flowNames = Object.keys(before.definitions ?? {}).sort();
    expect(flowNames).toContain(TARGET);

    // 业务投影即内存 fold:清空单例后全量重放,flow 集合与条目必须与重放前一致。
    resetEngineForTests();
    const reborn = await getEngine(pool);
    const after = reborn.getSnapshot();
    expect(Object.keys(after.definitions ?? {}).sort()).toEqual(flowNames);
    expect(after.definitions?.[TARGET]).toEqual(entry);
    expect(after.definitionVersions?.[TARGET]).toEqual(before.definitionVersions?.[TARGET]);
    expect(reborn.getSitemap().surfaces.map((surface) => surface.rel)).toContain(`flow:${TARGET}`);

    // Draft 投影可重建,激活终态不变。
    await pool.query('TRUNCATE draft_projection');
    await rebuildDraftProjection(pool);
    expect((await getDraft(pool, draftId, OWNER, SCOPE))?.aggregate.status).toBe('accepted');
  });

  it('refuses Agent approval with an audited rejection and births nothing', async () => {
    const { activation } = await submitGenesis('genesis:agent');

    const denied = await approve(activation, 'genesis:agent:approve', 'agent');
    expect(denied).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    const events = await listEvents(pool);
    expect(
      events.filter((event) => event.kind === 'action-rejected' && event.action === 'approve'),
    ).toHaveLength(1);
    expect(events.filter((event) => event.rel === `meta/flow:${TARGET}`)).toEqual([]);
  });

  it('marks the Draft stale when another path creates the same flow first', async () => {
    const { rel, activation } = await submitGenesis('genesis:race');

    // 双写者:批准前另一路径已创建同名 flow。
    await appendEvent(pool, {
      kind: 'definition-seeded',
      rel: `meta/flow:${TARGET}`,
      actor: 'agent',
      principal: 'system:other-path',
      channel: 'meta',
      detail: {
        name: TARGET,
        version: 1,
        status: 'active',
        definition: { ...genesisPayload(), title: 'Installed by another path' },
      },
    });
    await engine.readSnapshot();

    await expect(approve(activation, 'genesis:race:approve')).rejects.toThrow('stale');
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'stale',
    );
    const events = await listEvents(pool);
    const staled = events.filter((event) => event.kind === 'draft-staled');
    expect(staled).toHaveLength(1);
    expect(JSON.stringify(staled[0]?.detail)).toContain('created concurrently');
    // 竞态拒绝之外:该 rel 的唯一 seed 来自另一路径,本 Draft 零出生零接受。
    const seeds = events.filter(
      (event) => event.kind === 'definition-seeded' && event.rel === `meta/flow:${TARGET}`,
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.principal).toBe('system:other-path');
    expect(events.filter((event) => event.kind === 'draft-accepted')).toHaveLength(0);
  });
});

function draftIdOf(outcome: Awaited<ReturnType<typeof executeDraftMeta>>): string {
  expect(outcome.kind).toBe('accepted');
  return outcome.kind === 'accepted' ? String(outcome.entity.properties.id) : '';
}
