import { getPool } from '../../../db/pool';

// 降级语义(文档化):db 不可达时返回 HTTP 200 + { status: "degraded", db: "error" }。
// - status 描述 web 进程自身:端点能应答即非 500;db 故障标 "degraded" 而非 "ok",
//   不谎报健康;
// - db 字段定位子系统:"ok" | "error";
// - HTTP 恒为 200:只看状态码的 LB/探活不会因 db 抖动把整个服务判死。

export const dynamic = 'force-dynamic';

const DEFAULT_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a';

export async function GET() {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  try {
    const result = await getPool(connectionString).query<{ ok: number }>('SELECT 1 as ok');
    if (result.rows[0]?.ok !== 1) {
      throw new Error(`unexpected SELECT 1 result: ${JSON.stringify(result.rows[0])}`);
    }
    return Response.json({ status: 'ok', db: 'ok' });
  } catch {
    return Response.json({ status: 'degraded', db: 'error' });
  }
}
