/**
 * T52 扩展(invariants 套件)— 应用停用的全量重放/重启语义(I5/US2/US4/G4)。
 *
 * e2e/t52-application-deprecation.spec.ts 钉在线走查(浏览器门);本文件钉跨进程
 * 语义,分两相:
 * - 相位 1(在线):fresh server 内经合同出生一个测试应用(HTTP 同门:create →
 *   submit → approve;无浏览器)→ 经 flow 入口写一条业务数据 → 受治理停用 →
 *   在线收缩断言(实体 404/sitemap/授予全集);
 * - 相位间:保存全量日志 → TRUNCATE → 原序回灌(重放的唯一输入);
 * - 相位 2(重放/重启):fresh boot 全量 fold(fresh 进程 + keepLog)→
 *   ① 重启不复活(G4):应用不回 active 表、各收缩面保持、bootstrap 幂等;
 *   ② 重放一致(I5):applications 表内容 hash 跨边界一致;deprecatedApplications
 *      审计表与 definitions 置废条目经生产 fold 物化;实例按 D71.4 完整保留;
 *   ③ 名字烧毁(US4)重启后仍生效:烧毁名 create 被 guard 拒绝留痕(I6)。
 *
 * 停用回执与烧毁集口径(T52 终验修复后的事实):
 * - 人类通道 deprecate 的 HTTP 回执为 200,回执实体 = 收缩后的 meta/applications
 *   集合投影(D71.3:停用即离场,受影响面是集合);本不变量的主判据仍是
 *   事件对 + 收缩事实,回执形状为辅。
 * - deprecatedApplications 审计表随停用 exec 即时物化进在线快照(选择性补折),
 *   同进程内烧毁名 create 即时拒绝(t52 spec 与 service.application-deprecation
 *   钉);重启(本文件相位 2 的全量 fold)后同样生效——本文件钉跨进程语义。
 *
 * 单独跑:CI=true pnpm e2e invariants(PostgreSQL 5433 前置;无 worker 依赖)。
 */
import { expect, test } from '@playwright/test';

import { getPool } from '../../packages/db/src/pool';
import { readLog, type DbExecutor } from '../../packages/db/src/events';
import { businessFlows } from '../../apps/web/src/domain/flows';
import { contentVersion, fold } from '../../packages/engine/src/index';

import { DATABASE_URL, SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

const UNUSED_LLM_PROFILE = {
  LLM_API_KEY: 'e2e-unused-key',
  LLM_BASE_URL: 'http://127.0.0.1:9/v1',
  LLM_MODEL: 'e2e-unused-model',
};

const LENS = 'development';

interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
}

/** 日志行(回灌用:显式 seq 保序重放;与 invariants.spec.ts I5 同形)。 */
interface SavedEventRow {
  seq: number;
  ts: string;
  domain: string;
  actor: string | null;
  principal: string | null;
  channel: string | null;
  kind: string;
  rel: string | null;
  action: string | null;
  params: unknown;
  reason: string | null;
  detail: unknown;
}

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${SCENARIO_BASE}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${SCENARIO_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

/** meta exec(local demo 人通道:自报域 actor=human;草稿动词需显式 lens)。 */
function execMeta(rel: string, action: string, params: Record<string, unknown>) {
  return post(`/_meta/api/exec?scope=${LENS}`, { rel, action, params });
}

/** 读事件流;domain=core 时只取业务日志(伴随事件对/计数的裁决口径)。 */
async function getEvents(domain?: 'core'): Promise<LoggedEvent[]> {
  const query = domain === undefined ? '' : `?domain=${domain}`;
  const { status, body } = await get(`/api/events${query}`);
  expect(status).toBe(200);
  return (body.events ?? []) as LoggedEvent[];
}

/**
 * 静默窗口(I5 同款):等外部/旁路写者(presentation 域的 recipe 预生成等
 * fire-and-forget 追加)的事件落库稳定后再取日志——消除「保存日志与读取投影
 * 之间外部事件挤入」的竞态(两读相等即视为静默)。
 */
async function waitForQuietLog(db: DbExecutor, quietMs = 800): Promise<void> {
  let previous = -1;
  for (;;) {
    const result = await db.query('SELECT count(*)::int AS n FROM events');
    const current = result.rows[0]?.n ?? 0;
    if (current === previous) return;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, quietMs));
  }
}

/** 合法最小可写 bundle(t52 spec fixture 同形:向导 + append 产出实例)。 */
function bundlePayload(name: string, title: string): Record<string, unknown> {
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name, version: 1 },
    applications: [{ name, title, intent: 'T52 replay invariant: governed lifecycle' }],
    capabilities: [],
    flows: [
      {
        name: `${name}-entry`,
        title: 'Replay entry',
        app: name,
        initial: 'start',
        fields: [],
        nodes: [
          {
            name: 'start',
            title: 'Start',
            fields: [{ name: 'title', type: 'text', required: true, semantics: 'intent' }],
            actions: [
              {
                name: 'add',
                title: 'Add record',
                to: 'recorded',
                guards: [],
                fields: [],
                effect: [
                  { type: 'transition', to: 'recorded' },
                  {
                    type: 'append',
                    collection: `${name}-items`,
                    'resource-type': `${name}-item`,
                    flow: `${name}-item`,
                    'name-from': 'title',
                    node: 'open',
                  },
                ],
              },
            ],
          },
          { name: 'recorded', title: 'Recorded', fields: [], actions: [] },
        ],
      },
      {
        name: `${name}-item`,
        title: 'Replay item',
        app: name,
        initial: 'open',
        fields: [{ name: 'title', type: 'text', semantics: 'intent' }],
        collections: [{ collection: `${name}-items`, title: 'Replay items' }],
        nodes: [{ name: 'open', title: 'Open', fields: [], actions: [] }],
      },
    ],
    seed: {
      rel: `seed:${name}`,
      detail: {
        instances: {
          [`${name}-entry:main`]: {
            rel: `${name}-entry:main`,
            flow: `${name}-entry`,
            node: 'start',
            fields: {},
          },
        },
      },
    },
  };
}

async function saveLogRows(db: DbExecutor): Promise<SavedEventRow[]> {
  const result = await db.query<{
    seq: string | number;
    ts: Date;
    domain: string;
    actor: string | null;
    principal: string | null;
    channel: string | null;
    kind: string;
    rel: string | null;
    action: string | null;
    params: unknown;
    reason: string | null;
    detail: unknown;
  }>(
    'SELECT seq, ts, domain, actor, principal, channel, kind, rel, action, params, reason, detail FROM events ORDER BY seq ASC',
  );
  return result.rows.map((row) => ({
    seq: Number(row.seq),
    ts: new Date(row.ts).toISOString(),
    domain: row.domain,
    actor: row.actor,
    principal: row.principal,
    channel: row.channel,
    kind: row.kind,
    rel: row.rel,
    action: row.action,
    params: row.params ?? {},
    reason: row.reason,
    detail: row.detail ?? null,
  }));
}

/** TRUNCATE(空库)→ 原序回灌全部日志行 → 修复 bigserial 水位(I5 同形)。 */
async function restoreLogRows(db: DbExecutor, rows: readonly SavedEventRow[]): Promise<void> {
  await db.query('TRUNCATE events');
  for (const row of rows) {
    await db.query(
      `INSERT INTO events (seq, ts, domain, actor, principal, channel, kind, rel, action, params, reason, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb)`,
      [
        row.seq,
        row.ts,
        row.domain,
        row.actor,
        row.principal,
        row.channel,
        row.kind,
        row.rel,
        row.action,
        JSON.stringify(row.params ?? {}),
        row.reason,
        row.detail === null ? null : JSON.stringify(row.detail),
      ],
    );
  }
  await db.query(
    `SELECT setval(pg_get_serial_sequence('events', 'seq'), (SELECT COALESCE(max(seq), 1) FROM events))`,
  );
}

/** 应用维度的收缩面断言(在线/重放两相同一口径)。 */
async function expectRetracted(name: string, phase: string): Promise<void> {
  const application = await get(`/api/entity?rel=${encodeURIComponent(`application:${name}`)}`);
  expect(application.status, `[${phase}] application:<name> 应 404(存在性隐藏)`).toBe(404);
  const flow = await get(`/api/entity?rel=${encodeURIComponent(`flow:${name}-entry`)}`);
  expect(flow.status, `[${phase}] flow 入口别名应 404`).toBe(404);

  const sitemap = await get('/.well-known/ui4a.json');
  expect(sitemap.status).toBe(200);
  const surfaces = ((sitemap.body.surfaces ?? []) as { rel: string }[]).map((s) => s.rel);
  expect(surfaces, `[${phase}] sitemap 不含停用应用入口`).not.toContain(`flow:${name}-entry`);
  expect(surfaces, `[${phase}] 反向锚:publishing 入口不受影响`).toContain('flow:article-drafting');

  const applications = await get('/_meta/api/entity?rel=meta%2Fapplications');
  expect(applications.status).toBe(200);
  const names = ((applications.body.entities ?? []) as { properties?: { name?: unknown } }[]).map(
    (member) => String(member.properties?.name ?? ''),
  );
  expect(names, `[${phase}] meta/applications 不含停用应用(重启不复活)`).not.toContain(name);
  expect(names).toContain('publishing');

  const session = await get('/api/auth/session');
  expect(session.status).toBe(200);
  expect(session.body.grantedApplications as string[], `[${phase}] 授予全集收缩`).not.toContain(
    name,
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('I5/T52 应用停用:全量重放与重启语义', () => {
  test('出生→写数据→停用 → TRUNCATE 回灌 → fresh boot 全量 fold → 不复活/审计物化/烧毁生效', async () => {
    test.setTimeout(360_000);
    const pool = getPool(DATABASE_URL);
    const suffix = Math.random().toString(36).slice(2, 8);
    const name = `t52-replay-${suffix}`;
    const title = `T52 Replay ${suffix}`;
    const reason = `T52 replay invariant ${suffix}`;
    const itemRel = `${name}-item:t52-record-${suffix}`;

    let rows: SavedEventRow[] = [];
    let onlineApplicationsHash = '';
    let deprecatedSeq = -1;

    // ---- 相位 1(在线):合同出生 → 写数据 → 受治理停用 → 收缩留痕 ----------------
    await withFreshServer(async () => {
      // 先等静默:同一 playwright 进程里先行 spec 的 3100 webServer 仍在场,其
      // fire-and-forget 写者(recipe 预生成等)可能向共享库晚到落库——静默后再
      // 起场景,保证本相位的 core 事件流没有外来交错。
      await waitForQuietLog(pool);
      // genesis(create → submit → approve;local demo 人通道)
      const created = await execMeta('meta/drafts', 'create', {
        kind: 'application-bundle',
        target: name,
        commandId: `replay:create:${suffix}`,
        payload: bundlePayload(name, title),
      });
      expect(created.status).toBe(200);
      const draftRel = String(
        (created.body.entity as { properties?: { rel?: unknown } } | undefined)?.properties?.rel ??
          '',
      );
      expect(draftRel).toMatch(/^draft:/);

      const submitted = await execMeta(draftRel, 'submit', {
        commandId: `replay:submit:${suffix}`,
      });
      expect(submitted.status).toBe(200);
      const activationRel = String(
        (submitted.body.entity as { properties?: { activation?: unknown } } | undefined)?.properties
          ?.activation ?? '',
      );
      expect(activationRel).toMatch(/^meta\/activation:draft-/);

      const approved = await execMeta(activationRel, 'approve', {
        commandId: `replay:approve:${suffix}`,
      });
      expect(approved.status, '出生 approve 应成功').toBe(200);

      const applications = await get('/_meta/api/entity?rel=meta%2Fapplications');
      const names = (
        (applications.body.entities ?? []) as { properties?: { name?: unknown } }[]
      ).map((member) => String(member.properties?.name ?? ''));
      expect(names, '出生后应用在场').toContain(name);

      // 写数据:flow 入口别名 → 向导 add → append 产出业务实例
      const written = await post('/api/exec', {
        rel: `flow:${name}-entry`,
        action: 'add',
        params: { title: `t52 record ${suffix}` },
      });
      expect(written.status, '经 flow 入口写数据应成功').toBe(200);
      const instance = await get(`/api/entity?rel=${encodeURIComponent(itemRel)}`);
      expect(instance.status, '业务实例应在场').toBe(200);

      // 受治理停用:回执 200,实体 = 收缩后的 meta/applications 集合投影
      // (D71.3:停用即离场,受影响面是集合);不变量主判据仍是事件对 + 收缩事实。
      const deprecate = await post('/_meta/api/exec', {
        rel: `meta/application:${name}`,
        action: 'deprecate',
        params: { reason },
      });
      expect(deprecate.status, '停用回执应为 200').toBe(200);
      expect(
        (deprecate.body.entity as { class?: string[] } | undefined)?.class,
        '回执实体应为 meta/applications 集合投影',
      ).toContain('meta/applications');

      const events = await getEvents('core');
      const companion = events.find(
        (event) =>
          event.kind === 'application-deprecated' && event.rel === `meta/application:${name}`,
      );
      expect(companion, 'application-deprecated 伴随事件应留痕').toBeDefined();
      expect(companion!.detail).toMatchObject({
        name,
        reason,
        commandId: `application-deprecate:${name}`,
      });
      const executed = events.find(
        (event) =>
          event.kind === 'action-executed' &&
          event.rel === `meta/application:${name}` &&
          event.action === 'deprecate',
      );
      expect(executed).toBeDefined();
      // 序连续按 core 业务流口径断言:batch 是逐行 INSERT(seq 逐条分配),其它
      // 域的 fire-and-forget 追加可能在 seq 空间穿插——原子性承诺是「同事务
      // 提交」,core 流内相邻即证。
      expect(
        events[events.indexOf(executed!) + 1],
        '伴随事件对在 core 流内相邻(action-executed 之后即 application-deprecated)',
      ).toBe(companion);
      deprecatedSeq = companion!.seq;

      // 在线收缩面
      await expectRetracted(name, '在线');

      // 相位间输入:静默(旁路写者落库稳定)→ 全量日志 + applications 表内容
      // hash(生产 fold 口径;readLog 只取 core 域,fold 输入与在线引擎同源)。
      await waitForQuietLog(pool);
      rows = await saveLogRows(pool);
      onlineApplicationsHash = contentVersion(
        fold(await readLog(pool), { flows: businessFlows }).applications ?? {},
      );
      expect(rows.length, '压缩序列应产生非平凡日志').toBeGreaterThan(20);
    }, UNUSED_LLM_PROFILE);

    expect(deprecatedSeq).toBeGreaterThan(0);

    // ---- 相位间:TRUNCATE(空库)→ 原序回灌日志(重放的唯一输入)----------------
    await restoreLogRows(pool, rows);

    // ---- 相位 2(重放/重启):fresh boot 全量 fold --------------------------------
    await withFreshServer(
      async () => {
        // ① 重启不复活(G4):全部收缩面保持;bootstrap 幂等不再 seed 停用应用。
        await expectRetracted(name, '重放');

        // ② 重放一致(I5):applications 表内容 hash 跨边界一致;
        //    deprecatedApplications 审计表与 definitions 置废条目经生产 fold 物化;
        //    实例按 D71.4 完整保留(事件与 fold 不清存量)。
        const snapshot = fold(await readLog(pool), { flows: businessFlows });
        expect(
          contentVersion(snapshot.applications ?? {}),
          'applications 表:回灌重放后内容 hash 应与在线一致(I5)',
        ).toBe(onlineApplicationsHash);
        expect(snapshot.applications?.[name], '停用应用不得复活进 active 表').toBeUndefined();
        expect(snapshot.deprecatedApplications?.[name]).toMatchObject({ name, reason });
        expect(snapshot.definitions?.[`${name}-entry`]).toMatchObject({ status: 'deprecated' });
        expect(snapshot.definitions?.[`${name}-item`]).toMatchObject({ status: 'deprecated' });
        expect(
          snapshot.instances[itemRel],
          '存量实例按 D71.4 完整保留(读取面由受众层裁决)',
        ).toMatchObject({ flow: `${name}-item` });

        // 事件读回:core 流全量序完整(回灌保真;非 core 域的旁路追加不在业务
        // fold 口径内),停用事件对仍在原位。
        const events = await getEvents('core');
        expect(events.length).toBe(rows.filter((row) => row.domain === 'core').length);
        expect(events.find((event) => event.seq === deprecatedSeq)?.kind).toBe(
          'application-deprecated',
        );

        // ③ 名字烧毁(US4)重启后仍生效:烧毁名 create 被 guard 拒绝留痕(I6)。
        //    (在线同进程的即时拒绝已随停用 exec 补折生效;此处钉跨进程语义。)
        const rebirth = await execMeta('meta/drafts', 'create', {
          kind: 'application-bundle',
          target: name,
          commandId: `replay:rebirth:${suffix}`,
          payload: bundlePayload(name, `Rebirth ${suffix}`),
        });
        expect(rebirth.status, '烧毁名 create 应被 guard 拒(422)').toBe(422);
        expect(rebirth.body.layer).toBe('guard-failed');
        expect(String(rebirth.body.reason)).toContain('deprecated');

        const afterBurn = await getEvents('core');
        const rejected = afterBurn.find(
          (event) =>
            event.kind === 'action-rejected' &&
            event.rel === 'meta/drafts' &&
            event.action === 'create',
        );
        expect(rejected, '烧毁拒绝应留痕 action-rejected').toBeDefined();
        expect(String(rejected!.reason)).toContain('deprecated');
        // 拒绝之外零 Draft 建立(rebirth commandId 不得落 draft-created)。
        const draftCreated = afterBurn.filter((event) => event.kind === 'draft-created');
        expect(
          draftCreated.filter((event) =>
            JSON.stringify(event.detail).includes(`replay:rebirth:${suffix}`),
          ),
          '烧毁名拒绝之外零 Draft 建立',
        ).toEqual([]);
      },
      UNUSED_LLM_PROFILE,
      // 重放相位:fresh 进程但不清库——boot 的 fold 即全量重放本身。
      { keepLog: true },
    );

    console.log(
      `[I5/T52] 应用停用重放一致:name=${name} events=${rows.length} deprecatedSeq=${deprecatedSeq}`,
    );
  });
});
