/**
 * API 路由的错误映射(与 /api/entity 同口径,供 T5 的 delegations 端点复用):
 * - db 层故障(pg 连接类错误 code ECONNREFUSED/ETIMEDOUT 等)→ 503;
 * - 其余(如增量 fold 的日志完整性错误)如实 500 带原始信息,不伪装成基础设施
 *   故障(产品指南:如实,不粉饰)。
 */
export function apiErrorResponse(error: unknown, context: string): Response {
  const err = error as { code?: string };
  const dbFailure =
    typeof err.code === 'string' &&
    /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|28P01|3D000/.test(err.code);
  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    dbFailure ? { error: `${context} 数据库不可用` } : { error: `${context} 失败: ${message}` },
    { status: dbFailure ? 503 : 500 },
  );
}
