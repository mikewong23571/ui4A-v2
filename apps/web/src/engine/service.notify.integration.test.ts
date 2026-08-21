import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Client, Connection } from '@temporalio/client';

import { ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';

import { getEngine, resetEngineForTests } from './service';

// S1 notify 真链路集成(T3 Phase C / Task 2;真 PG + 真 Temporal dev server):
// agent archive → web exec 挂起(202)→ dispatchNotify(Temporal client)
// → notifyWorkflow(worker 进程)→ notify activity(worker 直接 appendEvent 同一 PG)
// → web 读路径增量 fold(getEntity('inbox') 立即可见)。
//
// 依赖:temporal server start-dev(DECISIONS.md D4,gRPC 7233)+ docker PG(5433)。
// 7233 不可达(如 CI)→ 整个 describe 跳过并说明,不挂 CI;编排者环境已运行。
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const WORKER_DIR = path.join(
  fileURLToPath(new URL('../../../..', import.meta.url)),
  'apps/worker',
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** TCP 探活(短超时):判断 Temporal dev server 是否可达(与 TEMPORAL_ADDRESS 同源)。 */
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
    `[ui4a] Temporal dev server 不可达(${TEMPORAL_ADDRESS}),notify 集成测试跳过`,
  );
}

const agentArchive = {
  rel: 'post:post-welcome',
  action: 'archive',
  params: {},
  actor: 'agent' as const,
  principal: 'user:mike',
  channel: 'http',
};

describe.skipIf(!temporalUp)('S1 notify 真链路(web→Temporal→worker→PG→web 增量读)', () => {
  const pool = getPool(CONNECTION_STRING);
  let worker: ChildProcess | null = null;
  let prevDispatchFlag: string | undefined;

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

  beforeAll(async () => {
    // 测试进程内开启派发(缺省 VITEST 下关闭)。
    prevDispatchFlag = process.env.UI4A_NOTIFY_DISPATCH;
    process.env.UI4A_NOTIFY_DISPATCH = 'on';

    // 清理上一轮可能残留的 stuck workflow(同 workflowId 的在跑实例会让 start 报
    // already-started——终止后 completed/terminated 状态可安全重用 workflowId)。
    const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
    const client = new Client({ connection });
    for (const id of ['c1', 'c2', 'c3']) {
      await client.workflow.getHandle(`notify-${id}`).terminate('stale cleanup').catch(() => undefined);
    }

    // 起真 worker(独立进程组;afterAll 整组 SIGTERM 优雅回收)。
    worker = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
      cwd: WORKER_DIR,
      env: { ...process.env, TEMPORAL_ADDRESS },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    worker.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text.length > 0) console.error('[worker stderr]', text);
    });
    await waitForWorkerBanner(worker, 30_000);
    await sleep(400); // 轮询启动余量
  }, 45_000);

  beforeEach(async () => {
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
  });

  afterAll(async () => {
    // 恢复派发开关(避免泄漏到同 worker 的后续测试文件)。
    if (prevDispatchFlag === undefined) {
      delete process.env.UI4A_NOTIFY_DISPATCH;
    } else {
      process.env.UI4A_NOTIFY_DISPATCH = prevDispatchFlag;
    }
    // 杀掉测试 spawn 的 worker(整组 SIGTERM;5s 未退 SIGKILL 兜底)。
    if (worker !== null && worker.pid !== undefined) {
      const exited = new Promise<void>((resolve) => {
        worker!.once('exit', () => resolve());
      });
      try {
        process.kill(-worker.pid, 'SIGTERM');
      } catch {
        // 进程组已不在(提前退出)——无需清理。
      }
      await Promise.race([exited, sleep(5000)]);
      try {
        if (worker.pid !== undefined) process.kill(-worker.pid, 'SIGKILL');
      } catch {
        // 已退出。
      }
    }
    await pool.query('TRUNCATE events').catch(() => undefined);
  }, 30_000);

  it(
    'agent archive → 挂起 → ≤15s notification-delivered 落库,inbox 可见且 delivered=1(不需重启)',
    { timeout: 20_000 },
    async () => {
      const engine = await getEngine(pool);
      const outcome = await engine.exec(agentArchive);
      expect(outcome.kind).toBe('suspended');

      // 轮询事件日志:worker(独立进程)写入 notification-delivered。
      const deadline = Date.now() + 15_000;
      let delivered = false;
      while (Date.now() < deadline) {
        const events = await readLog(pool);
        if (
          events.some(
            (event) => event.kind === 'notification-delivered' && event.rel === 'confirmation:c1',
          )
        ) {
          delivered = true;
          break;
        }
        await sleep(200);
      }
      expect(delivered).toBe(true);

      // web 读路径增量 fold:inbox 实体可见该确认且已送达;动作未生效。
      const inbox = await engine.getEntity('inbox');
      expect(inbox?.properties).toMatchObject({ count: 1, delivered: 1 });
      expect(inbox?.entities?.[0]?.properties).toMatchObject({
        id: 'c1',
        'target-action': 'archive',
        notified: true,
      });
      const post = await engine.getEntity('post:post-welcome');
      expect(post?.properties).toMatchObject({ node: 'published' });
    },
  );
});
