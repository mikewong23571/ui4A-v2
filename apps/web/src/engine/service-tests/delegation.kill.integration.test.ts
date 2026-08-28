import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Client, Connection } from '@temporalio/client';
import type { WorkflowExecutionStatusName } from '@temporalio/client';

import { ensureEventsTable, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { getEngine, resetEngineForTests } from '../service';

// S3-续跑 真链路集成(T5 Phase A / Task 3;真 Temporal + 真 worker + 真 PG + 真引擎):
// dispatch delegationWorkflow(发布文章,多步)→ 中途 SIGKILL worker →
// 断言 workflow 仍 RUNNING(Temporal 可查)→ 重启 worker → workflow 从最后
// 完成的 activity 续跑(durable execution)→ completed →
// 断言:delegation-step 事件序列连续无缺口(detail.step = 1..N,无重复无乱序)、
// 目标业务结果成立(文章落库 articles)、delegations 投影 status=completed。
//
// 引擎侧真身:测试进程内起最小 HTTP 适配器(/api/entity + /api/exec +
// /.well-known/ui4a.json → in-process engine runtime + 真 PG)——agent 走
// HTTP 合同字面成立;适配器对 /api/exec 人为延迟(拉开 kill 窗口)。
// T36 E2:本测试与组合根同宿 web 服务测试层(worker 由子进程驱动,语义不变),
// 消除 worker→web 跨应用 import。
// 依赖:temporal server start-dev(gRPC 7233)+ docker PG(5433);
// 7233 不可达(如 CI)→ 整个 describe 跳过并说明(与 notify 集成测试同口径)。
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const WORKER_DIR = path.join(
  // 本文件在 apps/web/src/engine/service-tests/(五层 '..' 回仓库根)。
  fileURLToPath(new URL('../../../../..', import.meta.url)),
  'apps/worker',
);

/**
 * /api/exec 的放慢步调(ms):延迟放在**引擎执行之前**——观察到第 N 步事件落库后
 * 立即 SIGKILL,杀点大概率落在第 N+1 步的 pace 等待中(exec 尚未到达引擎),
 * 重试即在未前进的状态上干净重执行(避免"引擎已应用而步事件未记"的窄窗)。
 */
const EXEC_PACE_MS = 500;
const TASK_QUEUE = `ui4a-delegation-kill-${process.pid}`;

function llmToolResponse(toolName: string, args: unknown): string {
  const chunk = {
    id: 'chatcmpl-delegation-kill-test',
    object: 'chat.completion.chunk',
    created: 1_755_700_000,
    model: 'delegation-protocol-test',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
  const finish = {
    ...chunk,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  };
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** TCP 探活(短超时):判断 Temporal dev server 是否可达。 */
function isPortOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (up: boolean): void => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function temporalHostPort(): { host: string; port: number } {
  const [host = 'localhost', port = '7233'] = TEMPORAL_ADDRESS.split(':');
  return { host, port: Number(port) };
}

const { host: temporalHost, port: temporalPort } = temporalHostPort();
const temporalUp = await isPortOpen(temporalHost, temporalPort);
if (!temporalUp) {
  console.warn(
    `[ui4a] Temporal dev server 不可达(${TEMPORAL_ADDRESS}),delegation kill 续跑集成测试跳过`,
  );
}

interface RecordedStep {
  seq: number;
  step: number;
}

describe.skipIf(!temporalUp)('S3-续跑:SIGKILL worker → 重启 → 委托续跑无缺口', () => {
  const pool = getPool(CONNECTION_STRING);
  let connection: Connection | null = null;
  let client: Client | null = null;
  let server: Server | null = null;
  let baseUrl = '';
  let worker: ChildProcess | null = null;
  const articleTitle = `kill-resume-${Date.now()}`;
  const workflowId = `delegation-kill-${Date.now()}`;

  /** 起真 worker(独立进程组;测试内可整组 SIGKILL/SIGTERM)。 */
  function spawnWorker(): ChildProcess {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/delegation-test-worker.fixture.ts'], {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        TEMPORAL_ADDRESS,
        DATABASE_URL: CONNECTION_STRING,
        DELEGATION_TEST_TASK_QUEUE: TASK_QUEUE,
        LLM_API_KEY: 'delegation-protocol-test-key',
        LLM_BASE_URL: `${baseUrl}/v1`,
        LLM_MODEL: 'delegation-protocol-test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text.length > 0) console.error('[worker stderr]', text);
    });
    return child;
  }

  /** 等待 worker 启动横幅(Worker.create 成功、即将 run;超时/早退即失败)。 */
  async function waitForWorkerBanner(child: ChildProcess, timeoutMs: number): Promise<void> {
    const started = new Date();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (Date.now() - started.getTime() > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`worker 启动横幅超时(${timeoutMs}ms)`));
        }
      }, 200);
      const check = (chunk: Buffer): void => {
        if (chunk.toString('utf8').includes('started (taskQueue=')) {
          clearInterval(timer);
          resolve();
        }
      };
      child.stdout?.on('data', check);
      child.once('exit', (code) => {
        clearInterval(timer);
        reject(new Error(`worker 进程提前退出(code=${code})`));
      });
    });
  }

  /** 整组杀进程:SIGTERM 优雅 / SIGKILL 立即(参数选择);容忍已退出。 */
  function killGroup(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // 进程组已不在(提前退出)——无需清理。
    }
  }

  async function stopWorker(child: ChildProcess): Promise<void> {
    if (child.pid === undefined) return;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    killGroup(child, 'SIGTERM');
    await Promise.race([exited, sleep(5000)]);
    killGroup(child, 'SIGKILL');
  }

  /** workflow 状态轮询(describe().status.name)。 */
  async function workflowStatus(): Promise<WorkflowExecutionStatusName> {
    const describe = await client!.workflow.getHandle(workflowId).describe();
    return describe.status.name;
  }

  /** 读该委托的事件族(kind → 有序列表;步事件提取 seq + detail.step)。 */
  async function delegationEvents(): Promise<{
    kinds: string[];
    steps: RecordedStep[];
  }> {
    const events = (await readLog(pool)).filter(
      (event) => event.rel === `delegation:${workflowId}`,
    );
    const steps: RecordedStep[] = [];
    for (const event of events) {
      if (event.kind !== 'delegation-step') continue;
      const detail = event.detail as { step?: unknown } | null;
      steps.push({ seq: event.seq, step: typeof detail?.step === 'number' ? detail.step : -1 });
    }
    return { kinds: events.map((event) => event.kind), steps };
  }

  beforeAll(async () => {
    connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
    client = new Client({ connection });

    // 清理上一轮可能的残留实例(同 workflowId 重跑安全;本测试用时间戳 id,防御性)。
    await client.workflow
      .getHandle(workflowId)
      .terminate('stale cleanup')
      .catch(() => undefined);

    // 测试进程内引擎真身:boot(幂等 seed)后挂最小 HTTP 适配器。
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    const engine = await getEngine(pool);

    server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        try {
          if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              messages?: { role?: string; content?: string }[];
            };
            const prompt =
              [...(body.messages ?? [])].reverse().find((message) => message.role === 'user')
                ?.content ?? '';
            const ledgerText = prompt
              .split('## 授权合同观察账本(有界，按最近访问顺序；entity 为完整 Siren 快照)\n')[1]
              ?.split('\n\n## 轨迹(至今)')[0];
            let currentNode: string | undefined;
            if (ledgerText !== undefined) {
              const ledger = JSON.parse(ledgerText) as {
                entity?: { properties?: { node?: unknown } };
              }[];
              const node = ledger.at(-1)?.entity?.properties?.node;
              if (typeof node === 'string') currentNode = node;
            }
            const authorizedExec = (
              action: string,
              params: Record<string, unknown>,
            ): [string, Record<string, unknown>] => [
              'exec',
              {
                action,
                params,
                authorization: {
                  sourceMessageId: `delegation:${workflowId}:goal`,
                  quote: '发布',
                },
              },
            ];
            const operation = prompt.includes(':: publish')
              ? ['done', { summary: '文章已发布' }]
              : currentNode === 'ready'
                ? authorizedExec('publish', { title: articleTitle })
                : currentNode === 'content'
                  ? authorizedExec('next', { body: 'kill 续跑验证正文' })
                  : currentNode === 'classification'
                    ? authorizedExec('next', { category: 'tech', tags: 't5' })
                    : currentNode === 'basic-info'
                      ? authorizedExec('next', { title: articleTitle })
                      : ['navigate', { rel: 'flow:article-drafting' }];
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.end(llmToolResponse(operation[0] as string, operation[1]));
            return;
          }
          if (req.method === 'GET' && url.pathname === '/.well-known/ui4a.json') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(engine.getSitemap()));
            return;
          }
          if (req.method === 'GET' && url.pathname === '/api/entity') {
            const entity = await engine.getEntity(url.searchParams.get('rel') ?? '');
            if (entity === undefined) {
              res.writeHead(404, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ error: '实体不存在' }));
              return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(entity));
            return;
          }
          if (req.method === 'POST' && url.pathname === '/api/exec') {
            // 放慢步调:拉开多步目标的执行时间,保证 kill 窗口足够宽。
            await sleep(EXEC_PACE_MS);
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(chunk as Buffer);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              rel: string;
              action: string;
              params?: Record<string, unknown>;
              actor?: 'human' | 'agent';
              principal?: string;
              channel?: string;
            };
            const outcome = await engine.exec({
              rel: body.rel,
              action: body.action,
              params: body.params ?? {},
              actor: body.actor ?? 'agent',
              principal: body.principal,
              channel: body.channel,
            });
            const respond = (status: number, payload: unknown): void => {
              res.writeHead(status, { 'content-type': 'application/json' });
              res.end(JSON.stringify(payload));
            };
            if (outcome.kind === 'accepted') {
              respond(200, { entity: outcome.entity });
            } else if (outcome.kind === 'suspended') {
              respond(202, { layer: 'confirmation', reason: '动作挂起待确认' });
            } else {
              respond(400, {
                layer: outcome.layer,
                reason: outcome.reason,
                ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
              });
            }
            return;
          }
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: `未知路径 ${url.pathname}` }));
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        }
      })();
    });
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server!.address();
    if (typeof address !== 'object' || address === null) throw new Error('HTTP 适配器未取得端口');
    baseUrl = `http://127.0.0.1:${address.port}`;

    worker = spawnWorker();
    await waitForWorkerBanner(worker, 30_000);
    await sleep(400); // 轮询启动余量
  }, 60_000);

  afterAll(async () => {
    if (worker !== null) {
      await stopWorker(worker);
    }
    await client?.workflow
      .getHandle(workflowId)
      .terminate('test cleanup')
      .catch(() => undefined);
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
    await connection?.close().catch(() => undefined);
    await pool.query('TRUNCATE events').catch(() => undefined);
  }, 30_000);

  it(
    'kill 中途 worker → workflow 仍 RUNNING → 重启续跑 → completed,事件序列无缺口,文章落库',
    { timeout: 150_000 },
    async () => {
      const engine = await getEngine(pool);
      const goal = {
        verb: '发布',
        fields: { title: articleTitle, category: 'tech', tags: 't5', body: 'kill 续跑验证正文' },
      };

      // dispatch 多步委托(B1 发布向导:navigate + 3×next + publish,共约 5-7 步)。
      await client!.workflow.start('delegationWorkflow', {
        args: [
          {
            goal,
            driverKind: 'llm',
            scope: 'publishing',
            startRel: 'articles',
            principal: 'user:kill-test',
            maxSteps: 24,
            baseUrl,
          },
        ],
        taskQueue: TASK_QUEUE,
        workflowId,
      });

      // 等 ≥2 个步事件落库再杀(保证确实杀在"执行中"而非起步前)。
      const killDeadline = Date.now() + 30_000;
      for (;;) {
        const { steps } = await delegationEvents();
        if (steps.length >= 2) break;
        if (Date.now() > killDeadline) {
          throw new Error(`30s 内未见 ≥2 个 delegation-step 事件(当前 ${steps.length})`);
        }
        await sleep(150);
      }

      // SIGKILL 整组(模拟进程崩溃,无优雅退出)。
      killGroup(worker!, 'SIGKILL');
      await sleep(1000);
      expect(await workflowStatus()).toBe('RUNNING');

      // 重启 worker:同一 workflow 由新 worker 续跑(最后完成的 activity 之后)。
      worker = spawnWorker();
      await waitForWorkerBanner(worker, 30_000);

      // 轮询至 completed(被杀 activity 的 StartToClose 到期后重试,≤30s + 余量)。
      const doneDeadline = Date.now() + 90_000;
      for (;;) {
        const status = await workflowStatus();
        if (status === 'COMPLETED') break;
        if (status !== 'RUNNING') {
          throw new Error(`续跑后 workflow 状态异常: ${status}`);
        }
        if (Date.now() > doneDeadline) {
          throw new Error(`90s 内 workflow 未 completed(当前 ${status})`);
        }
        await sleep(500);
      }

      // 事件序列:started 首、终态尾;delegation-step 的 detail.step 连续无缺口。
      const { kinds, steps } = await delegationEvents();
      expect(kinds[0]).toBe('delegation-started');
      expect(kinds[kinds.length - 1]).toBe('delegation-completed');
      const ordered = [...steps].sort((a, b) => a.seq - b.seq);
      expect(ordered.map((entry) => entry.step)).toEqual(
        Array.from({ length: ordered.length }, (_, index) => index + 1),
      );
      expect(ordered.length).toBeGreaterThanOrEqual(4); // 至少 navigate + 3×next + publish

      // 目标业务结果成立:文章落库(标题 slug 直达,节点 published)。
      const articles = await engine.getEntity('articles');
      expect(articles?.properties).toMatchObject({ count: 3 });
      const slug = articleTitle; // slugify 对纯小写连字符标题原样保留
      const post = await engine.getEntity(`post:${slug}`);
      expect(post?.properties).toMatchObject({ flow: 'post-status', node: 'published' });

      // delegations 投影:status=completed,steps 与步事件数一致(免重启增量 fold)。
      const delegations = await engine.getEntity('delegations');
      expect(delegations?.properties).toMatchObject({ rel: 'delegations', count: 1 });
      const sub = delegations?.entities?.[0];
      expect(sub?.properties).toMatchObject({
        id: workflowId,
        status: 'completed',
        steps: ordered.length,
        successes: 4, // 3×next + 1×publish
        goal: { verb: '发布' },
      });
    },
  );
});
