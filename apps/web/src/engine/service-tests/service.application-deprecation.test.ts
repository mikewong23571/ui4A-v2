/**
 * T52 终验缺陷修复钉测(service exec 同进程全链;真库):
 *
 * - 缺陷 A(deprecate 成功回执 500):exec 后置投影不变式对停用应用恒 undefined
 *   (D71.3 存在性隐藏)——修复后受影响面是集合:application-deprecated 伴随事件
 *   的成功回执 = 收缩后的 meta/applications 集合投影(停用即离场),其余 kind
 *   保持通用不变式 throw;
 * - 缺陷 B(烧毁集同进程不生效):deprecatedApplications 审计表原为 fold 侧专属
 *   物化(条目 seq 日志层分配,在线不可知),service 自身事件不增量折叠 →
 *   同进程停用后 create/validate 的 name-burn 守卫读不到审计集(US4/D71.5 要求
 *   三门即时 fail-closed)。修复 = exec 事务 append 后对 application-deprecated
 *   选择性补折进在线快照;本文件钉「不重启」语义:停用后立即 create 拒绝留痕、
 *   validate 判 stale,且在线审计集(含真 seq)与全量重放逐表零漂移。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold, type FoldSnapshot } from '@ui4a/engine';
import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable, listEvents, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';
import { executeDraftMeta } from '../drafts/drafts';
import { businessFlows } from '../../domain/flows';

const pool = getPool(process.env.DATABASE_URL!);
const OWNER = 'user:mike';
const SCOPE = 'development';

let engine: Awaited<ReturnType<typeof getEngine>>;

function bundlePayload(bundleName: string): Record<string, unknown> {
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name: bundleName, version: 1 },
    applications: [{ name: bundleName, title: 'Demo', intent: 'T52 service deprecation fixture' }],
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

/** genesis 装入 app(create → submit → approve;与 /_meta 合同同门)。 */
async function installApplication(name: string, commandPrefix: string): Promise<void> {
  const created = await draftMeta('create', {
    kind: 'application-bundle',
    target: name,
    commandId: `${commandPrefix}:create`,
    payload: bundlePayload(name),
  });
  expect(created.kind, 'genesis create 应通过').toBe('accepted');
  const rel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
  const submitted = await draftMeta('submit', { commandId: `${commandPrefix}:submit` }, rel);
  expect(submitted.kind).toBe('accepted');
  const activation = String(
    submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
  );
  const approved = await draftMeta(
    'approve',
    { commandId: `${commandPrefix}:approve` },
    activation,
    'human',
  );
  expect(approved.kind, 'genesis approve 应通过').toBe('accepted');
  await engine.readSnapshot();
  expect(engine.getSnapshot().applications?.[name]).toBeDefined();
}

/** 受治理停用(人类通道:guard actor-is-human + Cedar human 直通 → 直接执行)。 */
function deprecate(name: string, reason: string) {
  return engine.exec({
    rel: `meta/application:${name}`,
    action: 'deprecate',
    actor: 'human',
    principal: OWNER,
    channel: 'human-renderer',
    params: { reason },
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  engine = await getEngine(pool);
});

describe('application deprecation exec 回执(缺陷 A)', () => {
  it('deprecate 成功回执为 meta/applications 集合投影(停用即离场,成员不含停用名)', async () => {
    await installApplication('receipt-app', 'receipt');

    const outcome = await deprecate('receipt-app', 'receipt: reason');
    // 修复前:此处抛「exec 后目标实体 "meta/application:receipt-app" 不可投影」(500)。
    expect(outcome.kind, '停用成功应回 accepted(200),不再因存在性隐藏 500').toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    // 回执实体 = 收缩后的集合(受影响面是集合,不是存在性隐藏的目标实体)。
    expect(outcome.entity.class).toEqual(['collection', 'meta/applications']);
    expect(outcome.entity.properties).toMatchObject({ rel: 'meta/applications' });
    const members = (outcome.entity.entities ?? []).map((member) =>
      String((member.properties as { name?: unknown } | undefined)?.name ?? ''),
    );
    expect(members, '集合成员不含停用应用').not.toContain('receipt-app');
    // 事件对已原子落库(伴随 application-deprecated)。
    const events = await listEvents(pool);
    expect(
      events.filter(
        (event) =>
          event.kind === 'application-deprecated' && event.rel === 'meta/application:receipt-app',
      ),
    ).toHaveLength(1);
  });
});

describe('烧毁集同进程即时生效(缺陷 B / US4 / D71.5)', () => {
  it('停用后同进程 create 即时拒绝留痕、validate 即时 stale、审计集与重放零漂移', async () => {
    // 名字自由期先立 Draft D1(目标 burn-app;此后同名被安装又被停用)。
    const d1 = await draftMeta('create', {
      kind: 'application-bundle',
      target: 'burn-app',
      commandId: 'burn:d1:create',
      payload: bundlePayload('burn-app'),
    });
    expect(d1.kind).toBe('accepted');
    const d1Rel = d1.kind === 'accepted' ? String(d1.entity.properties.rel) : '';

    // genesis 装入 burn-app → 受治理停用(同一进程、同一 engine 单例,不重启)。
    await installApplication('burn-app', 'burn');
    const deprecated = await deprecate('burn-app', 'burn: same process');
    expect(deprecated.kind).toBe('accepted');

    // 在线审计集已随停用 exec 物化(条目携带真 seq——与 fold 首写同值)。
    const online = engine.getSnapshot() as FoldSnapshot;
    const audit = online.deprecatedApplications?.['burn-app'];
    expect(audit).toMatchObject({ name: 'burn-app', reason: 'burn: same process' });
    const deprecatedSeq = (await listEvents(pool)).find(
      (event) =>
        event.kind === 'application-deprecated' && event.rel === 'meta/application:burn-app',
    )!.seq;
    expect(audit?.seq, '审计条目 seq = 日志层分配的真 seq').toBe(deprecatedSeq);

    // create 门(同进程即时 fail-closed):烧毁名拒绝留痕,零 Draft 建立。
    const before = (await listEvents(pool)).filter(({ kind }) => kind === 'draft-created');
    const rebirth = await draftMeta('create', {
      kind: 'application-bundle',
      target: 'burn-app',
      commandId: 'burn:rebirth:create',
      payload: bundlePayload('burn-app'),
    });
    expect(rebirth, '烧毁名 create 应被 guard 拒(422 语义)').toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
    });
    if (rebirth.kind === 'rejected') {
      expect(rebirth.reason).toContain('burn-app');
      expect(rebirth.reason).toContain('deprecated');
      expect(rebirth.reason).not.toContain('already installed');
    }
    const events = await listEvents(pool);
    expect(
      events.filter(({ kind }) => kind === 'draft-created'),
      '拒绝之外零 Draft 建立',
    ).toEqual(before);
    expect(events.filter(({ kind }) => kind === 'action-rejected').at(-1)).toMatchObject({
      rel: 'meta/drafts',
      action: 'create',
      detail: { layer: 'guard-failed', domain: 'draft' },
    });

    // validate 门(同进程即时):目标名已烧毁 → Draft 判 stale,理由可区分。
    const validated = await draftMeta('validate', { commandId: 'burn:d1:validate' }, d1Rel);
    expect(validated.kind).toBe('accepted');
    expect(
      validated.kind === 'accepted' && String(validated.entity.properties.status),
      'validate 应判 stale(burned 语义),不回 ready',
    ).toBe('stale');
    const afterValidate = await listEvents(pool);
    const staled = afterValidate.filter(({ kind }) => kind === 'draft-staled');
    expect(staled.at(-1) && JSON.stringify(staled.at(-1))).toContain('burned');

    // 零漂移:在线快照受影响三表与全量重放逐表一致(I5 口径)。
    const replayed = fold(await readLog(pool), { flows: businessFlows }) as FoldSnapshot;
    expect(contentVersion(replayed.applications)).toBe(contentVersion(online.applications));
    expect(contentVersion(replayed.definitions)).toBe(contentVersion(online.definitions));
    expect(replayed.deprecatedApplications?.['burn-app']).toEqual(
      online.deprecatedApplications?.['burn-app'],
    );
  });
});
