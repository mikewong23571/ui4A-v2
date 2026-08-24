import { getWebReadinessSnapshot } from '../../../readiness/readiness';

// 诊断端点始终 HTTP 200；部署 readiness 必须使用 /ready 的 200/503 语义。
// status/db 保留旧客户端兼容字段，完整 dependency snapshot 与 /ready 同源。

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const snapshot = await getWebReadinessSnapshot();
  const postgres = snapshot.dependencies.postgres;
  return Response.json(
    {
      ...snapshot,
      readiness: snapshot.status,
      status: snapshot.health === 'ok' ? 'ok' : 'degraded',
      db: postgres?.status === 'ok' ? 'ok' : 'error',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
