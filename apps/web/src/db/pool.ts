import { Pool } from 'pg';

// pg Pool 单例管理:按连接串复用(生产中连接串不变 → 恒为单例;
// 测试切换 DATABASE_URL 时按 key 隔离,避免交叉污染)。
// closeAllPools 供测试收尾关闭真实连接。
const pools = new Map<string, Pool>();

export function getPool(connectionString: string): Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({ connectionString, connectionTimeoutMillis: 2000 });
    // 空闲连接的后台错误(如数据库重启断连)不应打崩进程。
    pool.on('error', () => {});
    pools.set(connectionString, pool);
  }
  return pool;
}

export async function closeAllPools(): Promise<void> {
  const closing = [...pools.values()].map((p) => p.end());
  pools.clear();
  await Promise.all(closing);
}
