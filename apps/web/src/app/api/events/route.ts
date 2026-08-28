import { listEvents } from '@ui4a/db/events';
import { getDb, getEngine } from '../../../engine/service';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';

// GET /api/events — 事件日志只读审计端点(spec FR2 / I6):
// - 默认 seq 升序返回原始事件(kind/reason 原样,拒绝即数据);
// - ?afterSeq=<非负整数> 分页(返回 seq 严格大于 afterSeq 的事件);
// - 人类审计 feed 可用 ?order=desc&beforeSeq=<正整数> 从最新向更早翻页;
// - 非法 afterSeq → 400 结构化错误;db 不可达 → 503(不抛 500)。
// - production profile(T22 验证修复):接入 application credential(Browser Session
//   或 Bearer,ui4a:read);principal 过滤不得超出 credential(不等 → 403),无过滤时
//   保持审计端点语义返回全部;local profile 行为不变。
// CORS 无所谓(spec:T7 才做 timeline 渲染)。

export const dynamic = 'force-dynamic';

function parseAfterSeq(raw: string | null): number | null {
  if (raw === null) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function parseBeforeSeq(raw: string | null): number | undefined | null {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
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
  const order = url.searchParams.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') {
    return Response.json({ error: 'order 必须是 asc|desc' }, { status: 400 });
  }
  const rawAfterSeq = url.searchParams.get('afterSeq');
  const rawBeforeSeq = url.searchParams.get('beforeSeq');
  if ((order === 'desc' && rawAfterSeq !== null) || (order === 'asc' && rawBeforeSeq !== null)) {
    return Response.json(
      { error: 'asc 只能使用 afterSeq，desc 只能使用 beforeSeq' },
      { status: 400 },
    );
  }
  const afterSeq = parseAfterSeq(rawAfterSeq);
  if (afterSeq === null) {
    return Response.json({ error: 'afterSeq 必须是非负整数' }, { status: 400 });
  }
  const beforeSeq = parseBeforeSeq(rawBeforeSeq);
  if (beforeSeq === null) {
    return Response.json({ error: 'beforeSeq 必须是正整数' }, { status: 400 });
  }
  const limit = parseLimit(url.searchParams.get('limit'));
  if (limit === null) {
    return Response.json({ error: 'limit 必须是 1..100 的整数' }, { status: 400 });
  }
  const domain = url.searchParams.get('domain');
  if (
    domain !== null &&
    !['core', 'presence', 'presentation', 'draft', 'capability', 'agent-definition'].includes(
      domain,
    )
  ) {
    return Response.json(
      { error: 'domain 必须是 core|presence|presentation|draft|capability|agent-definition' },
      { status: 400 },
    );
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
    // production:不信任 header/query 身份,先建立 credential identity;principal 过滤
    // 只允许收窄到 credential 自身(审计读,无过滤时返回全部,不做 rel scope 断言)。
    if (requestIdentityProfile() === 'production') {
      const engine = await getEngine(getDb());
      const identity = await resolveTrustedRequestIdentity(request, {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
      });
      if (principal !== null && principal !== identity.principal) {
        return Response.json(
          { error: 'principal filter cannot exceed credential scope' },
          { status: 403 },
        );
      }
    }
    const rows = await listEvents(getDb(), afterSeq, {
      ...(domain === null
        ? {}
        : {
            domain: domain as
              'core' | 'presence' | 'presentation' | 'draft' | 'capability' | 'agent-definition',
          }),
      ...(url.searchParams.get('rel') === null ? {} : { rel: url.searchParams.get('rel')! }),
      ...(url.searchParams.get('kind') === null ? {} : { kind: url.searchParams.get('kind')! }),
      ...(principal === null ? {} : { principal }),
      limit: limit + 1,
      order,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    });
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    return Response.json(
      order === 'asc'
        ? {
            events,
            page: {
              limit,
              hasMore,
              nextAfterSeq: hasMore ? (events.at(-1)?.seq ?? afterSeq) : null,
            },
          }
        : {
            events,
            page: {
              limit,
              hasMore,
              nextBeforeSeq: hasMore ? (events.at(-1)?.seq ?? beforeSeq ?? null) : null,
            },
          },
    );
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    return Response.json({ error: 'events 数据库不可用' }, { status: 503 });
  }
}
