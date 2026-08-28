import { describe, expect, it } from 'vitest';

import pg from 'pg';

// T1 Phase 2 连通性测试:验证 docker compose 提供的 PostgreSQL 可达。
// 连接串集中来自 DATABASE_URL(见 .env.example),代码不硬编码。
// 前置:`docker compose up -d --wait`(postgres:17-alpine,宿主端口 5433)。
const connectionString = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';

describe('docker compose PostgreSQL 连通性', () => {
  it('SELECT 1 返回 ok=1', async () => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query<{ ok: number }>('SELECT 1 as ok');
      expect(result.rows[0]?.ok).toBe(1);
    } finally {
      await client.end();
    }
  });
});
