/**
 * T2 Phase D / Task D3 — E2E 基线场景 B1/B2/B3(arch-brief §5)。
 *
 * agent 走 HTTP 合同(request 级,无浏览器):runAgent + rule driver 直接驱动
 * 真实 dev server 的 /api/entity 与 /api/exec,断言业务结果与事件日志。
 *
 * seed-reset 方案(报告口径):
 * - Playwright webServer 先于 globalSetup 启动,3100 server 的引擎快照在
 *   TRUNCATE 后即告失效(内存态,外部无法重置)——故不依赖共享 server;
 * - 每个场景:直连 PG TRUNCATE events(复用 apps/web 的 getPool,相对导入,
 *   不新增依赖)→ 自起独立 dev server(端口 3110,进程组管理)→ 场景结束杀组;
 * - 不往生产合同加任何 reset 后门;3100 webServer 仅供 smoke(不触引擎)。
 * 场景间串行(共用 3110 端口);3100 与 3110 两个 next dev 实测共存。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { createRuleDriver, runAgent } from '@ui4a/agent';
import type { SirenEntity, TrailStep } from '@ui4a/agent';
import { expect, test } from '@playwright/test';

import { getPool } from '../apps/web/src/db/pool';

const REPO_ROOT = path.join(__dirname, '..');
const AGENT_PORT = 3110;
const AGENT_BASE = `http://localhost:${AGENT_PORT}`;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';

const PRINCIPAL = 'orchestrator';

// ---- 事件日志的读取形状(/api/events)--------------------------------------

interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  reason: string | null;
}

// ---- seed-reset 与独立 server 生命周期 -------------------------------------

async function truncateEvents(): Promise<void> {
  await getPool(DATABASE_URL).query('TRUNCATE events');
}

async function waitUntilHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '未开始探测';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const body = (await response.json()) as { status?: string; db?: string };
      if (body.status === 'ok' && body.db === 'ok') return;
      lastError = `health 返回 ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`dev server 未在 ${timeoutMs}ms 内就绪:${lastError}`);
}

/** 等端口释放(场景串行复用 3110,防止上一 server 尚未退场)。 */
async function waitUntilPortFree(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = await new Promise<boolean>((resolve) => {
      const probe = spawn('nc', ['-z', 'localhost', String(port)], { stdio: 'ignore' });
      probe.on('exit', (code) => resolve(code === 0));
      probe.on('error', () => resolve(false));
    });
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`端口 ${port} 在 ${timeoutMs}ms 内未释放`);
}

/** TRUNCATE + 独立 dev server(3110)→ 跑场景 → 杀进程组。 */
async function withFreshServer(scenario: () => Promise<void>): Promise<void> {
  await truncateEvents();
  const child: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(AGENT_PORT),
      // 独立 distDir:Next 16 的 next dev 对同目录持单实例锁,须与 3100 webServer 隔离
      UI4A_DIST_DIR: '.next-e2e',
    },
    detached: true,
    stdio: 'ignore',
  });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  try {
    await waitUntilHealthy(AGENT_BASE, 90_000);
    if (exited) {
      throw new Error('dev server 进程提前退出(检查端口 3110 是否被占用)');
    }
    await scenario();
  } finally {
    if (child.pid !== undefined && !exited) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // 进程组已消失,无需处理
      }
    }
    await waitUntilPortFree(AGENT_PORT, 15_000).catch(() => undefined);
  }
}

async function getEntity(rel: string): Promise<SirenEntity> {
  const response = await fetch(`${AGENT_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET ${rel} 应为 200`).toBe(200);
  return (await response.json()) as SirenEntity;
}

async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${AGENT_BASE}/api/events`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { events: LoggedEvent[] };
  return body.events;
}

function executedEvents(events: LoggedEvent[], action: string): LoggedEvent[] {
  return events.filter((event) => event.kind === 'action-executed' && event.action === action);
}

function opKinds(steps: TrailStep[]): string[] {
  return steps.map((step) => step.op.kind);
}

// ---- B1/B2/B3 ---------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

// 每场景自起一个 next dev(冷编译)+ TRUNCATE,30s 默认超时不够。
test.beforeEach(() => {
  test.setTimeout(180_000);
});

test('B1 委托发布:agent 三步向导发布文章,计数 2→3', async () => {
  await withFreshServer(async () => {
    const before = await getEntity('articles');
    expect(before.properties.count).toBe(2); // 幂等 seed 保证起点

    const result = await runAgent(
      createRuleDriver(),
      {
        verb: '发布',
        fields: {
          title: 'agent 的第三篇',
          category: 'tech',
          tags: 'agent',
          body: '第三篇正文:由 rule driver 经三步向导发布。',
        },
      },
      {
        baseUrl: AGENT_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        // 零特权起点:从 articles 集合出发,由决策器沿 flow 入口链接自行进入向导
        // (评审 Low #5:不再使用向导实例 rel 特权起步)。
        startRel: 'articles',
        actor: 'agent',
        principal: PRINCIPAL,
        channel: 'e2e',
      },
    );

    expect(result.outcome, `轨迹:${JSON.stringify(opKinds(result.steps))}`).toBe('done');
    expect(result.successes.map((entry) => entry.action)).toEqual([
      'next',
      'next',
      'next',
      'publish',
    ]);

    // 计数 2→3;新文章实体存在且 published
    const articles = await getEntity('articles');
    expect(articles.properties.count).toBe(3);
    const created = (articles.entities ?? []).find(
      (sub) =>
        sub.properties.fields !== undefined &&
        (sub.properties.fields as Record<string, unknown>).title === 'agent 的第三篇',
    );
    expect(created, '新文章应出现在 articles 子实体中').toBeDefined();
    expect(created!.properties.node).toBe('published');

    // 日志留痕:publish 由 agent 执行,带 principal
    const events = await getEvents();
    const publishes = executedEvents(events, 'publish');
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.actor).toBe('agent');
    expect(publishes[0]!.principal).toBe(PRINCIPAL);
    expect(publishes[0]!.rel).toBe('article-drafting:main');
  });
});

test('B2 点名下线:经子实体链接直达 post-welcome,只下线这一篇', async () => {
  await withFreshServer(async () => {
    const result = await runAgent(
      createRuleDriver(),
      { verb: '下线', resource: 'post-welcome' },
      {
        baseUrl: AGENT_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        startRel: 'articles',
        actor: 'agent',
        principal: PRINCIPAL,
        channel: 'e2e',
      },
    );

    expect(result.outcome, `轨迹:${JSON.stringify(opKinds(result.steps))}`).toBe('done');
    // 轨迹可断言:第一步即经子实体链接直达
    expect(result.steps[0]!.op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });
    expect(result.steps[1]!.op).toMatchObject({ kind: 'exec', action: 'unpublish' });

    // post-welcome offline;另一篇仍 published
    expect((await getEntity('post:post-welcome')).properties.node).toBe('offline');
    expect((await getEntity('post:first-post')).properties.node).toBe('published');

    const events = await getEvents();
    const unpublishes = executedEvents(events, 'unpublish');
    expect(unpublishes).toHaveLength(1);
    expect(unpublishes[0]!.rel).toBe('post:post-welcome');
    expect(unpublishes[0]!.actor).toBe('agent');
  });
});

test('B3 审核队列:approve 至 pending 清零,c4 未被重复处理', async () => {
  await withFreshServer(async () => {
    const result = await runAgent(
      createRuleDriver(),
      { verb: '审核' },
      {
        baseUrl: AGENT_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        startRel: 'comments',
        actor: 'agent',
        principal: PRINCIPAL,
        channel: 'e2e',
        maxSteps: 32,
      },
    );

    expect(result.outcome, `轨迹:${JSON.stringify(opKinds(result.steps))}`).toBe('done');

    // pending 清零:全部成员到达终态 approved
    const comments = await getEntity('comments');
    const nodes = (comments.entities ?? []).map((sub) => sub.properties.node);
    expect(nodes).toEqual(['approved', 'approved', 'approved', 'approved']);

    // 3 次 approve 留痕(c1/c2/c3),c4 无任何 agent 处理痕迹
    const events = await getEvents();
    const approves = executedEvents(events, 'approve');
    expect(approves).toHaveLength(3);
    expect(approves.map((event) => event.rel).sort()).toEqual([
      'comment:c1',
      'comment:c2',
      'comment:c3',
    ]);
    expect(approves.every((event) => event.actor === 'agent')).toBe(true);
    const c4Touches = events.filter(
      (event) =>
        event.rel === 'comment:c4' && (event.action === 'approve' || event.action === 'reject'),
    );
    expect(c4Touches, 'c4(已 approved)不得被重复处理').toEqual([]);
  });
});
