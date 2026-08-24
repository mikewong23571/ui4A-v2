import { listEvents } from '../../../db/events';
import { getDb } from '../../../engine/service';

// GET /api/events — 事件日志只读审计端点(spec FR2 / I6):
// - seq 升序返回原始事件(kind/reason 原样,拒绝即数据);
// - ?afterSeq=<非负整数> 分页(返回 seq 严格大于 afterSeq 的事件);
// - 非法 afterSeq → 400 结构化错误;db 不可达 → 503(不抛 500)。
// CORS 无所谓(spec:T7 才做 timeline 渲染)。

export const dynamic = 'force-dynamic';

function parseAfterSeq(raw: string | null): number | null {
  if (raw === null) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) return null;
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const afterSeq = parseAfterSeq(url.searchParams.get('afterSeq'));
  if (afterSeq === null) {
    return Response.json({ error: 'afterSeq 必须是非负整数' }, { status: 400 });
  }
  const limit = parseLimit(url.searchParams.get('limit'));
  if (limit === null) {
    return Response.json({ error: 'limit 必须是 1..100 的整数' }, { status: 400 });
  }
  const domain = url.searchParams.get('domain');
  if (domain !== null && !['core', 'presentation', 'draft'].includes(domain)) {
    return Response.json({ error: 'domain 必须是 core|presentation|draft' }, { status: 400 });
  }
  const headerPrincipal = request.headers.get('x-ui4a-principal');
  const queryPrincipal = url.searchParams.get('principal');
  if (headerPrincipal !== null && queryPrincipal !== null && headerPrincipal !== queryPrincipal) {
    return Response.json(
      { error: 'principal filter cannot exceed credential scope' },
      { status: 403 },
    );
  }
  const principal = headerPrincipal ?? queryPrincipal;

  try {
    const rows = await listEvents(getDb(), afterSeq, {
      ...(domain === null ? {} : { domain: domain as 'core' | 'presentation' | 'draft' }),
      ...(url.searchParams.get('rel') === null ? {} : { rel: url.searchParams.get('rel')! }),
      ...(url.searchParams.get('kind') === null ? {} : { kind: url.searchParams.get('kind')! }),
      ...(principal === null ? {} : { principal }),
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    return Response.json({
      events,
      page: {
        limit,
        hasMore,
        nextAfterSeq: hasMore ? (events.at(-1)?.seq ?? afterSeq) : null,
      },
    });
  } catch {
    return Response.json({ error: 'events 数据库不可用' }, { status: 503 });
  }
}
