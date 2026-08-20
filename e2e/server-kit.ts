/**
 * E2E 共用 server 装置(Phase E 起 chat/llm-smoke 复用;baseline.spec.ts 保持自含)。
 *
 * 与 baseline 相同的 seed-reset 方案:每场景直连 PG TRUNCATE events → 自起独立
 * dev server(端口 3110,独立 distDir)→ 结束杀进程组。差异:支持向 spawned
 * server 注入额外 env(B4 的坏 key、I1 的显式空 key、冒烟的真实 key)。
 * 注意:apps/web/.env.local 若存在会被 Next 加载,但进程 env 优先——
 * 显式注入 GLM_API_KEY=''(空串)即可实现"无 key"环境(I1)。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { getPool } from '../apps/web/src/db/pool';

const REPO_ROOT = path.join(__dirname, '..');
export const SCENARIO_PORT = 3110;
export const SCENARIO_BASE = `http://localhost:${SCENARIO_PORT}`;
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';

export type ScenarioEnv = Record<string, string>;

export async function truncateEvents(): Promise<void> {
  await getPool(DATABASE_URL).query('TRUNCATE events');
}

export async function waitUntilHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
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

/** TRUNCATE + 独立 dev server(3110,注入 env)→ 跑场景 → 杀进程组。 */
export async function withFreshServer(
  scenario: () => Promise<void>,
  extraEnv: ScenarioEnv = {},
): Promise<void> {
  await truncateEvents();
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
