import { beforeEach, describe, expect, it } from 'vitest';

import type { FoldSnapshot } from '@ui4a/engine';
import { ensureDraftTables } from '@ui4a/db/drafts';
import { appendEvent, ensureEventsTable, listEvents } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';
import { executeDraftMeta, getDraftMetaEntity } from './drafts';

// T52 Phase 2(D71.5 / D71.8):名字烧毁集统一与 flow 名烧毁级联 —— Draft 门禁。
//
// D71.5 takenApplicationNames = active(applications 键)∪ deprecated
// (deprecatedApplications 审计表键;fold 级联删 applications 键后,停用名不因
// 停用释放)。三处守卫统一:create(安装目标合同扩烧毁侧,拒绝理由与「同名
// 已装」可区分,I6 留痕)、validate(bundle 基准从「未安装」扩为「名未被占用」,
// 全量清单冲突的 applications 侧同口径)、activate(锁内重读 log,显式计入
// application-deprecated 事件名——现状只数 seeded 恰好仍拦,seeded 事件永存;
// 显式化防未来只查活跃表时漏)。
//
// D71.8:停用级联置废的 flow 条目仅翻 status、键保留,create/validate/activate
// 三路名冲突数据源(definitions 键集)天然覆盖;指向停用 app 的新候选由
// app-known(T52 P1 已钉)fail-closed。本文件按事实钉测试,不重复实现。
const pool = getPool(process.env.DATABASE_URL!);
const OWNER = 'user:mike';

let engine: Awaited<ReturnType<typeof getEngine>>;

function draftMeta(
  action: string,
  params: Record<string, unknown>,
  rel = 'meta/drafts',
  actor: 'human' | 'agent' = 'agent',
  policyScope = 'development',
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
    { policyScope },
  );
}

function draftRelOf(outcome: Awaited<ReturnType<typeof executeDraftMeta>>): string {
  expect(outcome.kind).toBe('accepted');
  return outcome.kind === 'accepted' ? String(outcome.entity.properties.rel) : '';
}

/** 受治理停用事件(直接落库模拟治理裁决路径的伴随事件)+ 增量折入快照。 */
async function deprecateApplication(name: string, commandId: string): Promise<void> {
  await appendEvent(pool, {
    kind: 'application-deprecated',
    rel: `meta/application:${name}`,
    action: 'deprecate',
    actor: 'human',
    principal: 'system:governance',
    channel: 'meta',
    detail: { name, commandId, reason: 'T52 Phase 2 burn-set fixture' },
  });
  await engine.readSnapshot();
}

/** 双写者:另一路径安装同名 application(事件永存,不折入断言前的状态)。 */
async function seedApplicationByOtherPath(name: string): Promise<void> {
  await appendEvent(pool, {
    kind: 'application-seeded',
    rel: `meta/application:${name}`,
    actor: 'agent',
    principal: 'system:other-path',
    channel: 'meta',
    detail: {
      name,
      definition: { name, title: name, intent: 'Installed by another path' },
    },
  });
  await engine.readSnapshot();
}

/** 双写者:另一路径创建同名 flow(definition-seeded 出生事件)。 */
async function seedFlowByOtherPath(name: string, app: string): Promise<void> {
  await appendEvent(pool, {
    kind: 'definition-seeded',
    rel: `meta/flow:${name}`,
    actor: 'agent',
    principal: 'system:other-path',
    channel: 'meta',
    detail: {
      name,
      version: 1,
      status: 'active',
      definition: {
        name,
        title: 'Installed by another path',
        app,
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    },
  });
  await engine.readSnapshot();
}

function bundlePayload(bundleName: string): Record<string, unknown> {
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

function flowPayload(name: string, app: string): Record<string, unknown> {
  return {
    name,
    title: 'Burn cascade fixture',
    app,
    initial: 'start',
    nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
    fields: [],
  };
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  engine = await getEngine(pool);
});

describe('application name burn set (T52 P2 / D71.5)', () => {
  it('create rejects a burned target with an audited, distinguishable guard failure', async () => {
    // boot 播种的 editorial 被受治理停用:applications 删键、审计集留痕。
    await deprecateApplication('editorial', 'burn:create:deprecate');
    const snapshot = engine.getSnapshot() as FoldSnapshot;
    expect(snapshot.deprecatedApplications?.['editorial']).toMatchObject({ name: 'editorial' });
    expect(snapshot.applications?.['editorial']).toBeUndefined();

    const before = (await listEvents(pool)).filter(({ kind }) => kind === 'action-rejected');
    const outcome = await draftMeta('create', {
      kind: 'application-bundle',
      target: 'editorial',
      commandId: 'burn:create',
      payload: bundlePayload('editorial'),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    const reason = outcome.kind === 'rejected' ? outcome.reason : '';
    expect(reason).toContain('editorial');
    expect(reason).toContain('deprecated');
    // 理由与「同名已装」(application X is already installed)可区分。
    expect(reason).not.toContain('already installed');

    const events = await listEvents(pool);
    const rejectedEvents = events.filter(({ kind }) => kind === 'action-rejected');
    expect(rejectedEvents).toHaveLength(before.length + 1);
    expect(rejectedEvents.at(-1)).toMatchObject({
      rel: 'meta/drafts',
      action: 'create',
      detail: { layer: 'guard-failed', domain: 'draft' },
    });
    // 拒绝之外零 Draft 建立。
    expect(events.filter(({ kind }) => kind === 'draft-created')).toEqual([]);
  });

  it('validate marks the Draft stale with a burn reason after the target is deprecated', async () => {
    const created = await draftMeta('create', {
      kind: 'application-bundle',
      target: 'future-app',
      commandId: 'burn:validate:create',
      payload: bundlePayload('future-app'),
    });
    const rel = draftRelOf(created);

    // 双写者安装后又被治理停用:active 侧空、烧毁侧在——validate 不得回 ready。
    await seedApplicationByOtherPath('future-app');
    await deprecateApplication('future-app', 'burn:validate:deprecate');

    const validated = await draftMeta('validate', { commandId: 'burn:validate:again' }, rel);
    expect(validated.kind === 'accepted' && validated.entity.properties.status).toBe('stale');
    const staled = (await listEvents(pool)).filter(({ kind }) => kind === 'draft-staled');
    expect(staled).toHaveLength(1);
    const detail = JSON.stringify(staled[0]?.detail);
    expect(detail).toContain('future-app');
    expect(detail).toContain('burned');
    expect(detail).not.toContain('already installed');
  });

  it('approve counts application-deprecated names in the log and fails closed on a burned target', async () => {
    const created = await draftMeta('create', {
      kind: 'application-bundle',
      target: 'future-app',
      commandId: 'burn:approve:create',
      payload: bundlePayload('future-app'),
    });
    const rel = draftRelOf(created);
    const submitted = await draftMeta('submit', { commandId: 'burn:approve:submit' }, rel);
    expect(submitted.kind).toBe('accepted');
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );

    await seedApplicationByOtherPath('future-app');
    await deprecateApplication('future-app', 'burn:approve:deprecate');

    // 锁内重读 log:烧毁是显式计入的事件名,拒绝理由与竞态安装可区分。
    await expect(
      draftMeta('approve', { commandId: 'burn:approve:decide' }, activation, 'human'),
    ).rejects.toThrow('burned');
    expect(
      (await getDraftMetaEntity(pool, engine, rel, OWNER, 'development'))?.properties.status,
    ).toBe('stale');
    const events = await listEvents(pool);
    const staled = events.filter(({ kind }) => kind === 'draft-staled');
    expect(staled).toHaveLength(1);
    expect(JSON.stringify(staled[0]?.detail)).toContain('burned');
    // 拒绝留痕之外零安装:application-seeded 仅有另一路径的一条,无 receipt/接受。
    expect(
      events.filter(
        ({ kind, rel: eventRel }) =>
          kind === 'application-seeded' && eventRel === 'meta/application:future-app',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(({ rel: eventRel }) => eventRel === 'meta/bootstrap:future-app@1'),
    ).toEqual([]);
    expect(events.filter(({ kind }) => kind === 'draft-accepted')).toEqual([]);
  });

  it('validate flags inventory conflicts against audit-only burned names (deprecation frees nothing)', async () => {
    // ghost-app 从未安装、仅有停用事件(fold 审计集键即烧毁)——声明的次级
    // application 名不得因「当前不活跃」而逃过全量清单 fail-closed。
    await deprecateApplication('ghost-app', 'burn:inventory:deprecate');
    const payload = bundlePayload('fresh-bundle');
    (payload.applications as unknown[]).push({
      name: 'ghost-app',
      title: 'Burned secondary application',
      intent: 'Deprecated before this bundle was proposed',
    });
    const created = await draftMeta('create', {
      kind: 'application-bundle',
      target: 'fresh-bundle',
      commandId: 'burn:inventory:create',
      payload,
    });
    const rel = draftRelOf(created);

    const validated = await draftMeta('validate', { commandId: 'burn:inventory:validate' }, rel);
    expect(validated.kind === 'accepted' && validated.entity.properties.status).toBe('stale');
    const staled = (await listEvents(pool)).filter(({ kind }) => kind === 'draft-staled');
    expect(staled).toHaveLength(1);
    expect(JSON.stringify(staled[0]?.detail)).toContain('ghost-app');
  });

  it('approve fails closed when the inventory declares a burned secondary application', async () => {
    await deprecateApplication('ghost-app', 'burn:approve-inventory:deprecate');
    const payload = bundlePayload('fresh-bundle');
    (payload.applications as unknown[]).push({
      name: 'ghost-app',
      title: 'Burned secondary application',
      intent: 'Deprecated before this bundle was proposed',
    });
    const created = await draftMeta('create', {
      kind: 'application-bundle',
      target: 'fresh-bundle',
      commandId: 'burn:approve-inventory:create',
      payload,
    });
    const rel = draftRelOf(created);
    const submitted = await draftMeta(
      'submit',
      { commandId: 'burn:approve-inventory:submit' },
      rel,
    );
    expect(submitted.kind).toBe('accepted');
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );

    await expect(
      draftMeta('approve', { commandId: 'burn:approve-inventory:decide' }, activation, 'human'),
    ).rejects.toThrow('conflicts with installed');
    const events = await listEvents(pool);
    // 拒绝之外零安装:两个 application 都无出生事件(fixture 的停用事件除外),
    // 无 receipt、无 draft-accepted。
    expect(
      events.filter(
        ({ kind, rel: eventRel }) =>
          kind === 'application-seeded' &&
          (eventRel === 'meta/application:ghost-app' ||
            eventRel === 'meta/application:fresh-bundle'),
      ),
    ).toEqual([]);
    expect(events.filter(({ kind }) => kind === 'draft-accepted')).toEqual([]);
  });
});

describe('flow name burn cascade (T52 P2 / D71.8)', () => {
  it('create routes a cascade-deprecated flow name to revision, never genesis', async () => {
    // 停用 editorial → writing-request 条目仅翻 status(deprecated),键保留。
    await deprecateApplication('editorial', 'flow-burn:create:deprecate');
    const snapshot = engine.getSnapshot() as FoldSnapshot;
    expect(snapshot.definitions?.['writing-request']).toMatchObject({ status: 'deprecated' });

    const created = await draftMeta(
      'create',
      {
        kind: 'flow-definition',
        target: 'writing-request',
        commandId: 'flow-burn:create',
        payload: flowPayload('writing-request', 'editorial'),
      },
      'meta/drafts',
      'agent',
      'editorial',
    );
    expect(created.kind).toBe('accepted');
    // 键保留 → 走修订分支(baseVersion 在场),烧毁名不是 genesis 新名。
    expect(created.kind === 'accepted' && created.entity.properties.baseVersion).toBe('1');
    // 候选指向停用 app → app-known(P1)fail-closed:Draft 生而 invalid,不可激活。
    expect(created.kind === 'accepted' && created.entity.properties.status).toBe('invalid');
    const validation =
      created.kind === 'accepted' ? created.entity.properties.validation : undefined;
    expect(JSON.stringify(validation)).toContain('app-known');
  });

  it('validate marks a genesis Draft stale when the target flow is cascade-deprecated', async () => {
    const created = await draftMeta(
      'create',
      {
        kind: 'flow-definition',
        target: 'editorial-notes',
        commandId: 'flow-burn:validate:create',
        payload: flowPayload('editorial-notes', 'editorial'),
      },
      'meta/drafts',
      'agent',
      'editorial',
    );
    expect(created.kind === 'accepted' && created.entity.properties.baseVersion).toBeUndefined();
    const rel = draftRelOf(created);

    // 另一路径创建同名 flow,随后 app 停用级联置废该条目(键保留)。
    await seedFlowByOtherPath('editorial-notes', 'editorial');
    await deprecateApplication('editorial', 'flow-burn:validate:deprecate');

    const validated = await draftMeta(
      'validate',
      { commandId: 'flow-burn:validate:again' },
      rel,
      'agent',
      'editorial',
    );
    expect(validated.kind === 'accepted' && validated.entity.properties.status).toBe('stale');
    const staled = (await listEvents(pool)).filter(({ kind }) => kind === 'draft-staled');
    expect(staled).toHaveLength(1);
    expect(JSON.stringify(staled[0]?.detail)).toContain('already exists');
  });

  it('approve marks a genesis Draft stale when the target flow entry is cascade-deprecated', async () => {
    const created = await draftMeta(
      'create',
      {
        kind: 'flow-definition',
        target: 'editorial-notes',
        commandId: 'flow-burn:approve:create',
        payload: flowPayload('editorial-notes', 'editorial'),
      },
      'meta/drafts',
      'agent',
      'editorial',
    );
    const rel = draftRelOf(created);
    const submitted = await draftMeta(
      'submit',
      { commandId: 'flow-burn:approve:submit' },
      rel,
      'agent',
      'editorial',
    );
    expect(submitted.kind).toBe('accepted');
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );

    await seedFlowByOtherPath('editorial-notes', 'editorial');
    await deprecateApplication('editorial', 'flow-burn:approve:deprecate');

    // 激活数据源 = 锁内重读 log 的 fold:deprecated 条目键保留 → 同名即 stale。
    await expect(
      draftMeta(
        'approve',
        { commandId: 'flow-burn:approve:decide' },
        activation,
        'human',
        'editorial',
      ),
    ).rejects.toThrow('created concurrently');
    expect(
      (await getDraftMetaEntity(pool, engine, rel, OWNER, 'editorial'))?.properties.status,
    ).toBe('stale');
    const events = await listEvents(pool);
    expect(
      events.filter(
        ({ kind, rel: eventRel }) =>
          kind === 'definition-seeded' && eventRel === 'meta/flow:editorial-notes',
      ),
    ).toHaveLength(1);
    expect(events.filter(({ kind }) => kind === 'draft-accepted')).toEqual([]);
  });

  it('approve fails a genesis candidate closed via app-known once its application is deprecated', async () => {
    const created = await draftMeta(
      'create',
      {
        kind: 'flow-definition',
        target: 'editorial-extra',
        commandId: 'flow-burn:app:create',
        payload: flowPayload('editorial-extra', 'editorial'),
      },
      'meta/drafts',
      'agent',
      'editorial',
    );
    expect(created.kind === 'accepted' && created.entity.properties.status).toBe('ready');
    const rel = draftRelOf(created);
    const submitted = await draftMeta(
      'submit',
      { commandId: 'flow-burn:app:submit' },
      rel,
      'agent',
      'editorial',
    );
    expect(submitted.kind).toBe('accepted');
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );

    // flow 名从未被占,但候选 app 已停用:激活重验走 app-known(P1)fail-closed。
    await deprecateApplication('editorial', 'flow-burn:app:deprecate');
    await expect(
      draftMeta('approve', { commandId: 'flow-burn:app:decide' }, activation, 'human', 'editorial'),
    ).rejects.toThrow('no longer valid');
    const events = await listEvents(pool);
    expect(events.filter(({ rel: eventRel }) => eventRel === 'meta/flow:editorial-extra')).toEqual(
      [],
    );
    expect(events.filter(({ kind }) => kind === 'draft-accepted')).toEqual([]);
  });
});
