/**
 * E2E 共用 server 装置(Phase E 起 chat/llm-smoke 复用;baseline.spec.ts 保持自含;
 * T3 Phase D 增 withWorkerServer:web + Temporal worker 双进程栈,S1/I4 用)。
 *
 * 与 baseline 相同的 seed-reset 方案:每场景直连 PG TRUNCATE events → 自起独立
 * dev server(端口 3110,独立 distDir)→ 结束杀进程组。差异:支持向 spawned
 * server 注入额外 env(B4 的坏 key、I1 的显式空 key、冒烟的真实 key)。
 * 注意:apps/web/.env.local 若存在会被 Next 加载,但进程 env 优先——
 * 显式清空 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 即可实现"无 LLM 配置"环境(I1)。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { getPool } from '../../packages/db/src/pool';
import { prepareDatabaseForApplication } from '../../packages/db/src/migrations';
import { bootstrapAndVerifyApplication } from '../../apps/web/src/engine/bootstrap';

// 本文件在 e2e/kits/ 下(T23 Phase D 迁移;750340a 修 import 时 __dirname 层级
// 漏改一层——REPO_ROOT 曾解析到 e2e/,WORKER_DIR=e2e/apps/worker 不存在导致
// worker 栈 spawn 同步 ENOENT);两级上行才是仓库根。
const REPO_ROOT = path.join(__dirname, '..', '..');
export const SCENARIO_PORT = 3110;
export const SCENARIO_BASE = `http://localhost:${SCENARIO_PORT}`;
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';

export type ScenarioEnv = Record<string, string>;

export async function truncateEvents(): Promise<void> {
  const pool = getPool(DATABASE_URL);
  await pool.query('TRUNCATE events').catch((error: unknown) => {
    if ((error as { code?: string }).code !== '42P01') throw error;
  });
  await pool.query('TRUNCATE presentation_user_sidecars').catch((error: unknown) => {
    if ((error as { code?: string }).code !== '42P01') throw error;
  });
  // T29 起 schema 变更入版本化迁移注册表,readiness 只读探测不再兜底应用,引擎
  // boot 也只在首个业务请求懒触发——场景重置时把 bootEngine 的非生产序列做完
  // (迁移就绪 + 应用自举回执),库从 v0/v1 起步的新环境与 TRUNCATE 后的旧库
  // 都能直接通过 waitUntilHealthy,不依赖懒 boot。
  await prepareDatabaseForApplication(pool);
  await bootstrapAndVerifyApplication(pool);
}

/** Empty persisted logs for a caller-controlled replay without reseeding between truncate and append. */
export async function truncateLogsForReplay(): Promise<void> {
  const pool = getPool(DATABASE_URL);
  await pool.query('TRUNCATE events RESTART IDENTITY');
  await pool.query('TRUNCATE presentation_user_sidecars');
}

export async function waitUntilHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '未开始探测';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      // T22 readiness 口径:health.status 只在全部(含 optional)依赖 ok 时为 "ok",dev/e2e
      // 环境不接 temporal/keycloak/llm/runtime 探针,恒为 degraded;serving 判据是
      // readiness === 'ready'(required 依赖全 ok)。
      const body = (await response.json()) as { readiness?: string; db?: string };
      if (body.readiness === 'ready' && body.db === 'ok') return;
      lastError = `health 返回 ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`dev server 未在 ${timeoutMs}ms 内就绪:${lastError}`);
}

export async function waitUntilPortFree(port: number, timeoutMs: number): Promise<void> {
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

/** withFreshServer 的启动选项。 */
export interface FreshServerOptions {
  /**
   * true = 起 server 前不 TRUNCATE(I5 全量重放的"重新 boot"相位:日志已由
   * 调用方回灌,boot 的 fold 即全量重放;fresh 语义只保留"独立进程")。
   */
  keepLog?: boolean;
}

/** TRUNCATE + 独立 dev server(3110,注入 env)→ 跑场景 → 杀进程组。 */
export async function withFreshServer(
  scenario: () => Promise<void>,
  extraEnv: ScenarioEnv = {},
  options: FreshServerOptions = {},
): Promise<void> {
  if (options.keepLog !== true) {
    await truncateEvents();
  }
  const child: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(SCENARIO_PORT),
      // 独立 distDir:Next 16 的 next dev 对同目录持单实例锁,须与 3100 webServer 隔离
      UI4A_DIST_DIR: '.next-e2e',
      ...extraEnv,
    },
    detached: true,
    stdio: 'ignore',
  });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  try {
    await waitUntilHealthy(SCENARIO_BASE, 90_000);
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
    await waitUntilPortFree(SCENARIO_PORT, 15_000).catch(() => undefined);
  }
}

// ---- 确认门栈(T3 Phase D:web + Temporal worker 双进程)----------------------

/** worker 侧 taskQueue 会合点与 Temporal 地址(与 apps/worker、apps/web 同源)。 */
const WORKER_DIR = path.join(REPO_ROOT, 'apps', 'worker');
export const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
// 场景 worker 不复用本机 dev:all worker 的默认 3101。CI 单 worker 串行复用
// 3199；调用方仍可用 UI4A_WORKER_HEALTH_PORT 显式指定其他隔离端口。
export const SCENARIO_WORKER_HEALTH_PORT = process.env.UI4A_WORKER_HEALTH_PORT ?? '3199';

/**
 * 等待 worker 启动横幅(startupBanner:Worker.create 成功、即将 run)。
 * 超时或进程提前退出即失败(worker 不在,notify 链路无从谈起)。
 */
async function waitForWorkerBanner(worker: ChildProcess, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() - startedAt > timeoutMs) {
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
    worker.stdout?.on('data', check);
    worker.once('exit', (code) => {
      clearInterval(timer);
      reject(new Error(`worker 进程提前退出(code=${code})`));
    });
  });
}

/** 杀进程组并等退出:SIGTERM 优雅 → 5s 未退 SIGKILL 兜底 → 再等 3s。
 *  (实测 Next 16 dev 的 render 子进程偶发不随组内 SIGTERM 退出——SIGKILL 兜底
 *  后由 waitUntilPortFree 复核;残留 server 会顶掉下一场景的 3110,状态污染
 *  整个串行管线,必须杀干净。) */
async function killProcessGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return; // 进程组已不在
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // 已退出。
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

/**
 * TRUNCATE + 独立 dev server(3110,UI4A_NOTIFY_DISPATCH=on)+ 真 Temporal worker
 * (taskQueue ui4a;与 apps/web/src/engine/service.notify.integration.test.ts 同一
 * spawn 模式)→ 跑场景 → 杀两个进程组。S1/I4 确认门全链路用(worker 送达
 * notification-delivered 后 web 读路径增量 fold 可见)。
 * 前置:Temporal dev server(TEMPORAL_ADDRESS)可达——调用方负责探活 skip-if;
 * 场景前调用 terminateStaleNotifyWorkflows 清理跨轮次残留(s1.spec.ts)。
 */
export async function withWorkerServer(
  scenario: () => Promise<void>,
  extraEnv: ScenarioEnv = {},
): Promise<void> {
  await withWorkerStack(() => scenario(), extraEnv);
}

/**
 * S3 委托栈(T5 Phase C):与 withWorkerServer 同一双进程栈,但把 worker 的
 * 生杀交给场景(S3-续跑:SIGKILL 崩溃注入 → 断言 Temporal 侧仍 running →
 * 重启续跑)。杀/起在场景内自洽:句柄只暴露整组 SIGKILL 与重起(等启动横幅),
 * 场景结束 finally 无条件杀净当前 worker 与 web 组——重启过的 worker 同样被
 * 收尾,不污染后续场景(串行管线的 3110 与 taskQueue 干净交接)。
 */
export interface WorkerStackHandle {
  /** SIGKILL worker 进程组并等退出(模拟进程崩溃,无优雅退出)。 */
  killWorkerHard(): Promise<void>;
  /** 重起 worker 并等启动横幅(Temporal 把在途任务重新投给新 worker 续跑)。 */
  respawnWorker(): Promise<void>;
}

/** 起 worker 进程组(detached;stderr 转发便于排障;与 withWorkerServer 同参)。 */
function spawnWorkerProcess(extraEnv: ScenarioEnv): ChildProcess {
  const worker: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: WORKER_DIR,
    env: { ...process.env, TEMPORAL_ADDRESS, DATABASE_URL, ...extraEnv },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text.length > 0) console.error('[e2e worker stderr]', text);
  });
  return worker;
}

export async function withWorkerStack(
  scenario: (stack: WorkerStackHandle) => Promise<void>,
  extraEnv: ScenarioEnv = {},
): Promise<void> {
  // 起栈前确认 3110 空闲:上一场景若泄漏,waitUntilHealthy 会误连残留 server
  //(其内存快照携带旧确认状态),整个串行管线被污染——宁可直接失败。
  await waitUntilPortFree(SCENARIO_PORT, 15_000);
  await truncateEvents();
  const child: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(SCENARIO_PORT),
      UI4A_DIST_DIR: '.next-e2e',
      TEMPORAL_ADDRESS,
      // 显式开启 notify 派发(dev server 缺省即开,显式便于阅读)
      UI4A_NOTIFY_DISPATCH: 'on',
      ...extraEnv,
    },
    detached: true,
    stdio: 'ignore',
  });
  const workerEnv = {
    UI4A_WORKER_HEALTH_PORT: SCENARIO_WORKER_HEALTH_PORT,
    ...extraEnv,
  };
  let worker: ChildProcess = spawnWorkerProcess(workerEnv);
  let webExited = false;
  child.on('exit', () => {
    webExited = true;
  });
  try {
    await waitUntilHealthy(SCENARIO_BASE, 90_000);
    if (webExited) {
      throw new Error('dev server 进程提前退出(检查端口 3110 是否被占用)');
    }
    await waitForWorkerBanner(worker, 30_000);
    await scenario({
      killWorkerHard: async () => {
        if (worker.pid === undefined) return;
        const exited = new Promise<void>((resolve) => {
          worker.once('exit', () => resolve());
        });
        try {
          process.kill(-worker.pid, 'SIGKILL');
        } catch {
          return; // 进程组已不在
        }
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      },
      respawnWorker: async () => {
        // 防御:若上一个 worker 仍在(未先杀),先杀净再起——finally 只收尾最新组。
        if (worker.pid !== undefined) {
          try {
            process.kill(-worker.pid, 'SIGKILL');
          } catch {
            // 已退出。
          }
        }
        worker = spawnWorkerProcess(workerEnv);
        await waitForWorkerBanner(worker, 30_000);
      },
    });
  } finally {
    await killProcessGroup(worker).catch(() => undefined);
    // 无条件杀 web 组(webExited 只反映 pnpm 外壳退出,不代表 next-server 已退);
    // SIGKILL 兜底见 killProcessGroup。
    await killProcessGroup(child).catch(() => undefined);
    await waitUntilPortFree(SCENARIO_PORT, 15_000).catch(() => {
      console.error('[e2e] 警告:场景结束后 3110 未释放(残留 server 将污染后续场景)');
    });
  }
}
