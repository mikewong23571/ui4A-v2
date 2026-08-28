/**
 * T8 Phase A / Task 1 — 不变量套件 I1–I6(GOAL「不变量」表的收拢,持续运行口径)。
 *
 * 每条不变量一个命名 describe;断言核心**复用**既有 spec 的逻辑而非重写:
 * - I1(零智能完整):显式删除 e2e 进程的 LLM 配置三项 + spawn server 注入空配置
 *   (进程无 LLM profile 即零 LLM 网络调用的证据)→ 一条场景内跑 B1/B2/B3(baseline
 *   的 runAgent 合同路径核心)+ 表单版 S1(agent HTTP 挂起 → 人类 RJSF 批准,
 *   s1 UI 走查核心;无需 worker——inbox 投影列出全部 pending,送达断言属
 *   s1 的 notify 链路)+ exact entity 状态与事件流断言;
 * - I2(事实不可发明):s5 对拍逻辑的精简重跑——chat(rule)生成零字面 spec →
 *   生产解引用器 derefSpec 对实体快照解引用 → 分组计数逐项对拍(无浏览器);
 * - I3(交互必背书):i3 fuzz 的抽页重跑(首页 + 实体页),同一探针口径;
 * - I4(审批不委托):s1 的 agent approve 拒核心(422 guard actor-is-human
 *   留痕,confirmation 仍 pending),withFreshServer 即可(不断言送达);
 * - I5(可重放,本套件核心新增):一个 fresh server 内跑完整压缩场景序列
 *   (B1 发布 → B2 下线 → B3 审核[混合 actor] → S1 挂起+approve → S4 六步
 *   计划 → S5 render 凝固)→ 读日志经生产 fold 枚举全部实体 rel(实例/集合/
 *   确认/委托/激活/renderSpecs/meta 面)→ 逐 rel 取投影聚合 contentVersion
 *   hash → TRUNCATE + 原序回灌日志 → fresh boot 全量 fold(生产 boot 路径)
 *   → 同一 rel 集逐实体 + 综合 hash 一致;
 * - I6(拒绝留痕):一条"拒绝 → /api/events 带原因 → agent 下一步上下文
 *   (lastRejection)含同一原因"的显式链(脚本化 driver 捕获决策上下文)。
 *
 * 单独跑:CI=true pnpm e2e invariants。
 * PostgreSQL 5433 为既有前置;S1 表单版不需要 worker(notify 送达链路由
 * s1.spec 覆盖),Temporal 不可达时本文件不跳过(与 s1 互补的口径)。
 */
import { planFor, runAgent } from '@ui4a/agent';
import { createRuleDriver } from '@ui4a/agent/testkit/rule-driver';
import type { AgentDriver, DriverContext, SirenEntity, TrailStep } from '@ui4a/agent';
import { expect, test, type Page } from '@playwright/test';

import { getPool } from '../apps/web/src/db/pool';
import { readLog, type DbExecutor } from '../apps/web/src/db/events';
import { businessFlows } from '../apps/web/src/domain/flows';
import { terminateStaleNotifyWorkflows } from '../apps/web/src/temporal/notify';
import { derefSpec, type DimensionCount, type EntityCache } from '../apps/web/src/render/deref';
import { validateSpec } from '../apps/web/src/render/validator';
import { contentVersion, fold } from '../packages/engine/src/index';
import { metaFlowRel } from '../packages/shared/src/definition/definition';

import { DATABASE_URL, SCENARIO_BASE, withFreshServer } from './kits/server-kit';

const UNUSED_LLM_PROFILE = {
  LLM_API_KEY: 'e2e-unused-key',
  LLM_BASE_URL: 'http://127.0.0.1:9/v1',
  LLM_MODEL: 'e2e-unused-model',
};

// 本文件全部用例指向场景 server(3110)。
test.use({ baseURL: SCENARIO_BASE });

// ---- 共用客户端形状(与 baseline/s1/s4 同源)----------------------------------

interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
  reason: string | null;
  detail: unknown;
}

interface EntityShape {
  class: string[];
  properties: Record<string, unknown>;
  actions: { name: string; title: string; fields: Record<string, unknown> }[];
  entities?: EntityShape[];
}

const AGENT_PRINCIPAL = 'user:mike';
const HUMAN_PRINCIPAL = 'local-user';

async function execHttp(
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${SCENARIO_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function getEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events: LoggedEvent[] }).events;
}

function executedOf(events: LoggedEvent[], action: string): LoggedEvent[] {
  return events.filter((event) => event.kind === 'action-executed' && event.action === action);
}

function opKinds(steps: TrailStep[]): string[] {
  return steps.map((step) => step.op.kind);
}

/** runAgent 的合同客户端配置(baseline 同参:零特权 startRel + agent 身份)。 */
function agentOptions(principal: string, startRel: string) {
  return {
    baseUrl: SCENARIO_BASE,
    fetchImpl: (url: string, init?: RequestInit) => fetch(url, init),
    startRel,
    actor: 'agent' as const,
    principal,
    channel: 'e2e',
  };
}

/** agent 第一跳:读 sitemap(读路径;planFor 的 sitemap 参数形状)。 */
async function fetchSitemap(): Promise<Parameters<typeof planFor>[1]> {
  const response = await fetch(`${SCENARIO_BASE}/.well-known/ui4a.json`);
  expect(response.status).toBe(200);
  return (await response.json()) as Parameters<typeof planFor>[1];
}

/** chat 合同的 AI-first render 请求；命中机械 binding-only 路径时不调用模型。 */
async function chatAuto(
  verb: string,
  sessionId: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, driver: 'auto', goal: { verb } }),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译),30s 不够;I5 双 boot 另行放宽。
  test.setTimeout(180_000);
});

// ---- I1 零智能完整 --------------------------------------------------------------

test.describe('I1 零智能完整(已被 T15 AI-first supersede)', () => {
  test.skip('旧 keyless rule-driver 用户故事不再作为产品验收证据', async ({ page }) => {
    test.setTimeout(240_000);
    // 显式撤销:e2e 进程删除配置三项(断言为证);spawn server 注入空配置压过
    // .env.local(进程 env 优先)。进程无 LLM profile → 全程零 LLM 网络调用可证。
    const hadKey = process.env.LLM_API_KEY;
    const hadBase = process.env.LLM_BASE_URL;
    const hadModel = process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    expect(process.env.LLM_API_KEY, 'e2e 进程必须显式无 LLM key').toBeUndefined();
    expect(process.env.LLM_BASE_URL, 'e2e 进程必须显式无 LLM base URL').toBeUndefined();
    expect(process.env.LLM_MODEL, 'e2e 进程必须显式无 LLM model').toBeUndefined();
    try {
      await terminateStaleNotifyWorkflows(['c1']);
      await withFreshServer(
        async () => {
          // ---- B1 委托发布(baseline 核心:三步向导 + publish,计数 2→3)----
          const b1 = await runAgent(
            createRuleDriver(),
            {
              verb: '发布',
              fields: {
                title: 'i1 的第三篇',
                category: 'tech',
                tags: 'i1',
                body: '第三篇正文:keyless 环境由 rule driver 经合同发布。',
              },
            },
            agentOptions(AGENT_PRINCIPAL, 'articles'),
          );
          expect(b1.outcome, `轨迹:${JSON.stringify(opKinds(b1.steps))}`).toBe('done');
          expect(b1.successes.map((entry) => entry.action)).toEqual([
            'next',
            'next',
            'next',
            'publish',
          ]);
          const articles = await getEntity('articles');
          expect(articles.properties.count).toBe(3);
          const publishes = executedOf(await getEvents(), 'publish');
          expect(publishes).toHaveLength(1);
          expect(publishes[0]).toMatchObject({ actor: 'agent', principal: AGENT_PRINCIPAL });

          // ---- B2 点名下线(baseline 核心:子实体链接直达,精确下线一篇)----
          const b2 = await runAgent(
            createRuleDriver(),
            { verb: '下线', resource: 'post-welcome' },
            agentOptions(AGENT_PRINCIPAL, 'articles'),
          );
          expect(b2.outcome, `轨迹:${JSON.stringify(opKinds(b2.steps))}`).toBe('done');
          expect(b2.steps[0]!.op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });
          expect((await getEntity('post:post-welcome')).properties.node).toBe('offline');
          expect((await getEntity('post:first-post')).properties.node).toBe('published');

          // ---- B3 审核队列(baseline 核心:pending 清零,c4 不重复处理)----
          const b3 = await runAgent(
            createRuleDriver(),
            { verb: '审核' },
            { ...agentOptions(AGENT_PRINCIPAL, 'comments'), maxSteps: 32 },
          );
          expect(b3.outcome, `轨迹:${JSON.stringify(opKinds(b3.steps))}`).toBe('done');
          const comments = await getEntity('comments');
          expect((comments.entities ?? []).map((sub) => sub.properties.node)).toEqual([
            'approved',
            'approved',
            'approved',
            'approved',
          ]);
          const approves = executedOf(await getEvents(), 'approve');
          expect(approves.map((event) => event.rel).sort()).toEqual([
            'comment:c1',
            'comment:c2',
            'comment:c3',
          ]);
          expect(approves.every((event) => event.actor === 'agent')).toBe(true);

          // ---- 表单版 S1(s1 UI 走查核心:agent HTTP 挂起 → 人类 RJSF 批准)----
          // post-welcome 已下线,本段目标换 post:first-post(仍 published)。
          const { status, json } = await execHttp({
            rel: 'post:first-post',
            action: 'archive',
            actor: 'agent',
            principal: AGENT_PRINCIPAL,
            channel: 'e2e',
          });
          expect(status, 'agent archive 应挂起 202').toBe(202);
          expect(json.status).toBe('suspended');
          expect((json.confirmation as { rel?: string } | undefined)?.rel).toBe('confirmation:c1');
          // 挂起即未生效。
          expect((await getEntity('post:first-post')).properties.node).toBe('published');

          // 人类全程 renderer:canonical 收件箱实体 → 成员 → 确认页 RJSF 批准。
          expect((await getEntity('inbox')).properties).toMatchObject({ count: 1 });
          await page.goto('/entity?rel=inbox');
          const member = page.locator('section[aria-label="成员"] a', {
            hasText: 'target-action=archive',
          });
          await expect(member).toContainText('proposed-by.actor=agent');
          await member.click();
          const approve = page.getByRole('button', { name: '批准' });
          await expect(approve).toBeEnabled();
          // D50:驳回表单默认收起,先打开再断言 reason 必填
          await page.getByRole('button', { name: '填写驳回参数' }).click();
          await expect(page.getByRole('textbox', { name: /reason|原因/i })).toHaveAttribute(
            'required',
            '',
          );
          await approve.click();
          await expect(page.getByRole('button', { name: '批准' })).toHaveCount(0);
          await expect(
            page.locator('section[aria-label="属性"] tbody tr', { hasText: 'approved' }).first(),
          ).toBeVisible();
          expect((await getEntity('post:first-post')).properties.node).toBe('archived');
          expect((await getEntity('inbox')).properties).toMatchObject({ count: 0 });
          await page.goto('/entity?rel=post:first-post');
          await expect(
            page.locator('section[aria-label="属性"] tbody tr', { hasText: 'archived' }).first(),
          ).toBeVisible();

          // 事件流页:timeline 词条渲染原始事件(本场景 publish 留痕可见)。
          await page.goto('/events');
          await expect(page.locator('[data-word="timeline"]')).toBeVisible();
          await expect(page.locator('[data-word="timeline"]')).toContainText('publish');
        },
        // spawn server 的显式空配置(压过 apps/web/.env.local)。
        { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
      );
    } finally {
      // 单 worker 串行复用进程:恢复现场,不污染后续 spec(llm-smoke 等)。
      if (hadKey === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = hadKey;
      if (hadBase === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = hadBase;
      if (hadModel === undefined) delete process.env.LLM_MODEL;
      else process.env.LLM_MODEL = hadModel;
      await terminateStaleNotifyWorkflows(['c1']);
    }
  });
});

// ---- I2 事实不可发明 --------------------------------------------------------------

test.describe('I2 事实不可发明', () => {
  test.skip('渲染 spec 解引用后的值与实体快照一致(s5 对拍逻辑精简重跑)', async () => {
    await withFreshServer(async () => {
      const { status, json } = await chatAuto('按分类展示文章', 'i2-e2e');
      expect(status).toBe(200);
      expect(json.outcome).toBe('done');
      const render = json.render as
        | { spec: { concern: string; component: string; bind: unknown }; frozenNow: boolean }
        | undefined;
      expect(render).toBeDefined();
      const spec = render!.spec;
      // 零字面校验器(与 s5 同一生产校验器):spec 递归不含字面数值。
      expect(validateSpec(spec)).toEqual({ valid: true });
      expect(render!.frozenNow).toBe(true);

      // 对拍:渲染器私有缓存(实体投影)→ 生产解引用器聚合 → 逐项对拍。
      const articles = await getEntity('articles');
      const cache: EntityCache = new Map([['articles', articles as SirenEntity]]);
      // 类型断言理由:chat 合同载荷按 RenderSpec 形状收窄后交生产解引用器。
      const derefed = derefSpec(spec as Parameters<typeof derefSpec>[0], cache) as {
        series: DimensionCount[];
      };
      const rendered = derefed.series;

      // 独立口径重算:直接从集合成员 fields.category 分组(不经渲染路径)。
      const expected = new Map<string, number>();
      for (const member of articles.entities ?? []) {
        const category = member.properties.fields?.category;
        if (typeof category !== 'string') throw new Error('成员缺 category(快照形状意外)');
        expected.set(category, (expected.get(category) ?? 0) + 1);
      }
      expect(expected.size).toBeGreaterThanOrEqual(2); // 种子 tech/essay 起步

      // 逐项一致(不发明、不丢失):每个渲染数值都在快照有出处。
      expect(rendered).toHaveLength(expected.size);
      let total = 0;
      for (const entry of rendered) {
        const origin = expected.get(entry.key);
        expect(origin, `维度 ${entry.key} 必须在实体快照有出处`).toBeDefined();
        expect(entry.count).toBe(origin);
        total += entry.count;
      }
      expect(total).toBe((articles.entities ?? []).length); // 计数总和 = 成员数
    }, UNUSED_LLM_PROFILE);
  });
});

// ---- I3 交互必背书 ---------------------------------------------------------------

test.describe('I3 交互必背书', () => {
  /** 可点元素探针(i3 同口径:button/a/[role=button] 的标注枚举,零白名单)。 */
  function probeClickables(
    page: Page,
  ): Promise<{ tag: string; text: string; action: string | null; nav: string | null }[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, [role="button"]')).map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? '').trim().slice(0, 32),
        action: element.getAttribute('data-action'),
        nav: element.getAttribute('data-nav'),
      })),
    );
  }

  test('抽 2 页 fuzz:首页与实体页全部可点元素必映射已声明 action 或导航', async ({ page }) => {
    await withFreshServer(async () => {
      const targets = [
        { name: '首页', path: '/', ready: '[data-surface]' },
        {
          name: '实体页(已发布文章,含动作)',
          path: '/entity?rel=post:post-welcome',
          ready: '[data-action]',
        },
      ];
      for (const target of targets) {
        await page.goto(`${SCENARIO_BASE}${target.path}`);
        await page.waitForSelector(target.ready, { timeout: 30_000 });
        const clickables = await probeClickables(page);
        expect(clickables.length, `${target.name} 应存在可点元素(fuzz 非空泛)`).toBeGreaterThan(0);
        const offenders = clickables.filter(
          (element) => element.action === null && element.nav === null,
        );
        expect(
          offenders,
          `${target.name} 存在未背书可点元素:\n${offenders
            .map((element) => `  <${element.tag}> "${element.text}"`)
            .join('\n')}`,
        ).toEqual([]);
      }
    });
  });
});

// ---- I4 审批不委托 ---------------------------------------------------------------

test.describe('I4 审批不委托', () => {
  test('agent exec approve → 422 guard(actor-is-human)留痕,confirmation 仍 pending', async () => {
    try {
      await terminateStaleNotifyWorkflows(['c1']);
      await withFreshServer(async () => {
        // agent 提议 archive(post-welcome 初始 published)→ 202 挂起。
        const suspend = await execHttp({
          rel: 'post:post-welcome',
          action: 'archive',
          actor: 'agent',
          principal: AGENT_PRINCIPAL,
          channel: 'e2e',
        });
        expect(suspend.status).toBe(202);

        // 以 agent 身份执行 approve → 必被拒(铁律 5:审批不委托)。
        const { status, json } = await execHttp({
          rel: 'confirmation:c1',
          action: 'approve',
          actor: 'agent',
          principal: AGENT_PRINCIPAL,
          channel: 'e2e',
        });
        expect(status).toBe(422);
        expect(json.layer).toBe('guard-failed');
        expect(json.reason).toContain('actor-is-human');

        // 拒绝留痕(action-rejected,actor=agent)且不影响确认。
        const rejected = (await getEvents()).filter((event) => event.kind === 'action-rejected');
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toMatchObject({
          rel: 'confirmation:c1',
          action: 'approve',
          actor: 'agent',
          reason: expect.stringContaining('actor-is-human'),
        });
        const confirmation = await getEntity('confirmation:c1');
        expect(confirmation.properties.status).toBe('pending');
        expect(confirmation.actions.map((action) => action.name)).toEqual(['approve', 'reject']);
        expect((await getEntity('post:post-welcome')).properties.node).toBe('published');
      });
    } finally {
      await terminateStaleNotifyWorkflows(['c1']);
    }
  });
});

// ---- I6 拒绝留痕 -----------------------------------------------------------------

test.describe('I6 拒绝留痕', () => {
  test('被拒动作原因入日志,且回流 agent 下一步决策上下文(lastRejection)', async () => {
    await withFreshServer(async () => {
      // 脚本化 driver:捕获每次 decide 的上下文;两次 unpublish(第二次必被
      // 拒:offline 节点未声明)后,以 lastRejection 在场为终止条件。
      const contexts: DriverContext[] = [];
      const driver: AgentDriver = {
        decide: (context) => {
          contexts.push(context);
          if (context.lastRejection !== undefined) {
            return { kind: 'done', summary: '拒绝已回流下一步上下文' };
          }
          return { kind: 'exec', action: 'unpublish' };
        },
      };

      const result = await runAgent(
        driver,
        { verb: '下线', targetRel: 'post:post-welcome' },
        agentOptions('user:i6-agent', 'post:post-welcome'),
      );
      expect(result.outcome, `轨迹:${JSON.stringify(opKinds(result.steps))}`).toBe('done');
      expect(contexts).toHaveLength(3); // 执行 → 被拒 → 拒绝回流后收工

      // 链条第三环:lastRejection 携带被拒动作与结构化原因。
      const lastRejection = contexts[2]!.lastRejection;
      expect(lastRejection).toMatchObject({ rel: 'post:post-welcome', action: 'unpublish' });
      expect(lastRejection!.layer).toBe('undeclared');
      expect(lastRejection!.reason).toBeTruthy();

      // 链条第二环:同一拒绝在 /api/events 带原因留痕(与上下文原因同源同串)。
      const rejected = (await getEvents()).filter(
        (event) => event.kind === 'action-rejected' && event.action === 'unpublish',
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        rel: 'post:post-welcome',
        actor: 'agent',
        principal: 'user:i6-agent',
      });
      expect(rejected[0]!.reason, '日志原因必须与 agent 下一步上下文的原因逐字一致').toBe(
        lastRejection!.reason,
      );

      // 拒绝不改状态:第一次 unpublish 生效(published→offline),第二次被拒
      // 后状态仍是 offline;消费即清(第三步上下文里已用作终止条件)。
      expect((await getEntity('post:post-welcome')).properties.node).toBe('offline');
    });
  });
});

// ---- I5 可重放(全量)--------------------------------------------------------------

test.describe('I5 可重放', () => {
  /** 日志行(回灌用:显式 seq 保序重放)。 */
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

  /** TRUNCATE(空库)→ 原序回灌全部日志行 → 修复 bigserial 水位。 */
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

  /**
   * 全部实体 rel 枚举:读日志 → 生产 fold(与 boot 同依赖)→ 快照各表键
   * ∪ 服务面固定视图(threads/inbox/delegations/render-specs/meta 面)。枚举完整性
   * 由日志保证(fold 是 rel 的唯一来源),两侧(在线/重放)用同一清单。
   */
  async function enumerateEntityRels(db: DbExecutor): Promise<string[]> {
    const snapshot = fold(await readLog(db), { flows: businessFlows });
    const rels = new Set<string>([
      ...Object.keys(snapshot.instances),
      ...Object.keys(snapshot.collections),
      ...Object.keys(snapshot.confirmations ?? {}),
      ...Object.keys(snapshot.delegations ?? {}),
      ...Object.keys(snapshot.threads ?? {}).map((id) => `thread:${id}`),
      ...Object.keys(snapshot.activations ?? {}),
      ...Object.values(snapshot.renderSpecs ?? {}).map((frozen) => `render-spec:${frozen.concern}`),
      'inbox',
      'delegations',
      'render-specs',
      'threads',
      'meta/self',
      'meta/flows',
      'meta/activations',
      ...Object.keys(snapshot.definitions ?? {}).map((name) => metaFlowRel(name)),
    ]);
    return [...rels].sort();
  }

  /**
   * 静默窗口:等外部写者(环境中若有常驻 notify worker,会为挂起确认补投
   * notification-delivered)的事件落库稳定后再取日志/世界态——消除"保存日志
   * 与读取投影之间外部事件挤入"的竞态(两读相等即视为静默)。
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

  /** 逐 rel 取 Siren 投影(meta 前缀走 /api/meta/entity)+ sitemap,聚合世界态。 */
  async function readWorld(rels: readonly string[]): Promise<Record<string, unknown>> {
    const world: Record<string, unknown> = {};
    for (const rel of rels) {
      const meta = rel === 'meta/self' || rel.startsWith('meta/');
      const path = meta ? '/api/meta/entity' : '/api/entity';
      const response = await fetch(`${SCENARIO_BASE}${path}?rel=${encodeURIComponent(rel)}`);
      expect(response.status, `GET ${rel} 应为 200(枚举来自同一日志,两侧必同形)`).toBe(200);
      world[rel] = await response.json();
    }
    const sitemapResponse = await fetch(`${SCENARIO_BASE}/.well-known/ui4a.json`);
    expect(sitemapResponse.status).toBe(200);
    world['@sitemap'] = await sitemapResponse.json();
    return world;
  }

  test('完整压缩场景序列 → TRUNCATE 回灌重放(生产 boot 全量 fold)→ 全实体 hash 一致', async () => {
    test.setTimeout(420_000);
    const pool = getPool(DATABASE_URL);

    let rows: SavedEventRow[] = [];
    let rels: string[] = [];
    let onlineWorld: Record<string, unknown> = {};

    // ---- 相位 1(在线轨道):fresh server 跑完整压缩序列,增量维护快照 ----
    try {
      await terminateStaleNotifyWorkflows(['c1']);
      await withFreshServer(async () => {
        // B1 发布(agent 合同循环)。
        const b1 = await runAgent(
          createRuleDriver(),
          {
            verb: '发布',
            fields: {
              title: 'i5-replay-article',
              category: 'tech',
              tags: 'i5',
              body: 'I5 全量重放序列的 B1 产物。',
            },
          },
          agentOptions('user:i5-agent', 'articles'),
        );
        expect(b1.outcome, 'B1 应完成').toBe('done');

        // B2 下线(agent)。
        const b2 = await runAgent(
          createRuleDriver(),
          { verb: '下线', resource: 'post-welcome' },
          agentOptions('user:i5-agent', 'articles'),
        );
        expect(b2.outcome, 'B2 应完成').toBe('done');

        // B3 审核(混合 actor:agent approve c1;human approve c2/c3)。
        const c1 = await execHttp({
          rel: 'comment:c1',
          action: 'approve',
          actor: 'agent',
          principal: 'user:i5-agent',
          channel: 'e2e',
        });
        expect(c1.status).toBe(200);
        for (const id of ['comment:c2', 'comment:c3']) {
          const human = await execHttp({
            rel: id,
            action: 'approve',
            actor: 'human',
            principal: HUMAN_PRINCIPAL,
            channel: 'renderer',
          });
          expect(human.status).toBe(200);
        }

        // I6 味的拒绝留痕:offline 文章上的 unpublish 未声明 → 400(undeclared)留痕。
        const doomed = await execHttp({
          rel: 'post:post-welcome',
          action: 'unpublish',
          actor: 'agent',
          principal: 'user:i5-agent',
          channel: 'e2e',
        });
        expect(doomed.status).toBe(400);
        expect(doomed.json.layer).toBe('undeclared');

        // S1 挂起 + approve(agent 提议 first-post → human 裁决)。
        const suspend = await execHttp({
          rel: 'post:first-post',
          action: 'archive',
          actor: 'agent',
          principal: 'user:i5-agent',
          channel: 'e2e',
        });
        expect(suspend.status).toBe(202);
        const approve = await execHttp({
          rel: 'confirmation:c1',
          action: 'approve',
          actor: 'human',
          principal: HUMAN_PRINCIPAL,
          channel: 'renderer',
        });
        expect(approve.status).toBe(200);
        expect((await getEntity('post:first-post')).properties.node).toBe('archived');

        // S4 六步计划(agent 批量裁决:next×3 + publish + unpublish + republish)。
        const sitemap = await fetchSitemap();
        const proposal = planFor(
          {
            verb: '发布一篇文章',
            fields: {
              title: 'i5-plan-article',
              category: 'tech',
              tags: 'i5',
              body: 'I5 全量重放序列的 S4 批量裁决产物。',
            },
          },
          sitemap,
        );
        if (proposal === undefined) {
          throw new Error('planFor 未推出向导计划(I5 场景拼装失败)');
        }
        const planRel = 'post:i5-plan-article';
        const planSteps = proposal.steps
          .map((step) => ({ rel: step.rel, action: step.action, params: step.params ?? {} }))
          .concat([
            { rel: planRel, action: 'unpublish', params: {} },
            { rel: planRel, action: 'republish', params: {} },
          ]);
        expect(planSteps).toHaveLength(6);
        const planResponse = await fetch(`${SCENARIO_BASE}/api/exec-plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            steps: planSteps,
            actor: 'agent',
            principal: 'user:i5-agent',
            channel: 'http',
          }),
        });
        expect(planResponse.status).toBe(200);
        const planBody = (await planResponse.json()) as { plan: string };
        expect(planBody.plan).toBe('completed');

        // T16 Presentation events/Sidecars use an independent replay projection; this I5 sequence
        // remains the Business Snapshot replay gate. Presentation replay is covered by
        // apps/web/src/db/presentation.test.ts and the T16 Golden Story.

        // 场景收尾:静默(外部写者若存在)→ 日志/rel 枚举/世界态(在线轨道,
        // server A 仍存活时读取)。
        await waitForQuietLog(pool);
        rows = await saveLogRows(pool);
        rels = await enumerateEntityRels(pool);
        expect(rels, 'I5 世界必须包含 principal-scoped threads 集合').toContain('threads');
        onlineWorld = await readWorld(rels);
        expect(
          rows.length,
          '压缩序列应产生非平凡日志(≈26 行:定义/种子/业务/确认/计划/凝固)',
        ).toBeGreaterThan(20);
        // I5 扩展(T10/T18/T19):application 维度入重放输入——日志须含全部已安装应用
        // application-seeded(rel=meta/application:<name>,detail 持定义全文)。
        // 防空转守卫:缺了它们,重放相位的 applications 断言就没有意义。
        const appSeeds = rows.filter((row) => row.kind === 'application-seeded');
        expect(appSeeds.map((row) => row.rel)).toEqual([
          'meta/application:default',
          'meta/application:publishing',
          'meta/application:community',
          'meta/application:development',
          'meta/application:editorial',
          'meta/application:governance',
          // T35 S9/S10:bundle 扩容后 todo/ideas 随批次入重放输入(与
          // installedApplicationBundles 同源序,F-28 同口径)。
          'meta/application:todo',
          'meta/application:ideas',
        ]);
        // I5 扩展(T13/T18/T19):capability 维度入重放输入——日志须含全部已安装能力
        // capability-seeded(rel=meta/capability:<name>,detail 持定义全文)。
        // 防空转守卫与 application 维度同口径。
        const capabilitySeeds = rows.filter((row) => row.kind === 'capability-seeded');
        expect(capabilitySeeds.map((row) => row.rel)).toEqual([
          'meta/capability:draft',
          'meta/capability:notify',
          'meta/capability:clarify',
          'meta/capability:coding.execute',
          'meta/capability:writing.compose',
          'meta/capability:agent-definition.author',
        ]);
      }, UNUSED_LLM_PROFILE);
    } finally {
      await terminateStaleNotifyWorkflows(['c1']);
    }

    const onlineHash = contentVersion(onlineWorld);
    // applications 表(application 实体尚无 HTTP 投影面[Phase C 分组投影未落],
    // 经生产 fold 取,与 enumerateEntityRels 同口径):跨 TRUNCATE 边界的
    // 回灌保真 + 重放确定性断言锚。
    const onlineApplicationsHash = contentVersion(
      fold(await readLog(pool), { flows: businessFlows }).applications ?? {},
    );
    // capabilities 表(T13;与 applications 同口径,经生产 fold 取):
    // 跨 TRUNCATE 边界的回灌保真 + 重放确定性断言锚。
    const onlineCapabilitiesHash = contentVersion(
      fold(await readLog(pool), { flows: businessFlows }).capabilities ?? {},
    );
    const onlinePerRel: Record<string, string> = {};
    for (const [rel, entity] of Object.entries(onlineWorld)) {
      onlinePerRel[rel] = contentVersion(entity);
    }

    // ---- 相位间:TRUNCATE(空库)→ 原序回灌日志(重放的唯一输入)----------
    await restoreLogRows(pool, rows);

    // ---- 相位 2(重放轨道):fresh boot(生产 bootEngine 全量 fold 日志)----
    await withFreshServer(
      async () => {
        // 回灌保真:重放侧的日志枚举与在线侧完全一致。
        expect(await enumerateEntityRels(pool)).toEqual(rels);
        // applications 表与在线一致(I5 扩展到 application 维度:内容 hash 一致
        // = name/title/intent/entry 全文一致,不止键集)。
        expect(
          contentVersion(fold(await readLog(pool), { flows: businessFlows }).applications ?? {}),
          'applications 表:重放后内容 hash 应与在线一致(I5)',
        ).toBe(onlineApplicationsHash);
        // capabilities 表与在线一致(I5 扩展到 capability 维度:内容 hash 一致
        // = name/title/kind/intent/input/output 全文一致,不止键集)。
        expect(
          contentVersion(fold(await readLog(pool), { flows: businessFlows }).capabilities ?? {}),
          'capabilities 表:重放后内容 hash 应与在线一致(I5)',
        ).toBe(onlineCapabilitiesHash);

        const replayWorld = await readWorld(rels);
        // 逐实体一致(不只综合 hash:失败时可定位差异 rel)。
        for (const rel of rels) {
          expect(
            contentVersion(replayWorld[rel]),
            `实体 "${rel}" 重放后投影 hash 应与在线一致`,
          ).toBe(onlinePerRel[rel]);
        }
        const replayHash = contentVersion(replayWorld);
        expect(replayHash, '全实体综合 hash:重放前后必须一致(I5)').toBe(onlineHash);

        // 具体终态抽查(不只信 hash):业务/确认/定义各一。
        expect((await getEntity('articles')).properties.count).toBe(4);
        expect((await getEntity('post:post-welcome')).properties.node).toBe('offline');
        expect((await getEntity('post:first-post')).properties.node).toBe('archived');
        expect((await getEntity('post:i5-plan-article')).properties.node).toBe('published');
        expect((await getEntity('confirmation:c1')).properties).toMatchObject({
          status: 'approved',
        });
        // meta 面(跨站规则:须经 /api/meta/entity,readWorld 同口径)。
        const metaFlows = await fetch(`${SCENARIO_BASE}/api/meta/entity?rel=meta%2Fflows`);
        expect(metaFlows.status).toBe(200);
        expect(((await metaFlows.json()) as EntityShape).class).toContain('collection');
        const events = await getEvents();
        expect(events.length).toBe(rows.length);
        expect(events.some((event) => event.kind === 'plan-executed')).toBe(true);
        expect(events.some((event) => event.kind === 'confirmation-approved')).toBe(true);
        expect(
          events.some((event) => event.kind === 'action-rejected' && event.reason !== null),
        ).toBe(true);
      },
      {},
      // 重放相位:fresh 进程但不清库——boot 的 fold 即全量重放本身。
      { keepLog: true },
    );

    console.log(
      `[I5] 全量重放一致:在线 hash=${onlineHash} events=${rows.length} rels=${rels.length}`,
    );
  });
});
