import { afterEach, describe, expect, it } from 'vitest';

import { closeAllPools } from '../../../db/pool';

import { GET } from './route';

// /api/health 契约测试(TDD 红→绿):
// (a) db 可达:HTTP 200 + {status:"ok", db:"ok"};
// (b) db 不可达(坏连接串):HTTP 200 + {status:"degraded", db:"error"},绝不抛 500。
// 降级语义(文档化选择):db 故障时 status 取 "degraded" 而非 "ok" ——
// 端点与 web 进程本身存活,但依赖的子系统故障,不应谎报 "ok";
// HTTP 保持 200,让只看状态码的 LB/探活不会把整个服务判死。
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const BAD_URL = 'postgres://ui4a:ui4a@localhost:5999/ui4a'; // 无监听端口,ECONNREFUSED

afterEach(async () => {
  if (REAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = REAL_DATABASE_URL;
  }
  // 关闭单例池的真实连接,避免测试进程留下悬挂 socket。
  await closeAllPools();
});

describe('GET /api/health', () => {
  it('db 可达 → HTTP 200,JSON {status:"ok", db:"ok"}', async () => {
    delete process.env.DATABASE_URL; // 走默认 compose 连接串(与 src/db/pg.test.ts 同源)

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok', db: 'ok' });
  });

  it('db 不可达 → HTTP 200,JSON {status:"degraded", db:"error"},不抛 500', async () => {
    process.env.DATABASE_URL = BAD_URL;

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'degraded', db: 'error' });
  });
});
