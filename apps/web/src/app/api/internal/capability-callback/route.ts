import { timingSafeEqual } from 'node:crypto';

import { getCapabilityRunInternal } from '../../../../db/capability-runs';
import { getDb, getEngine } from '../../../../engine/service';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = process.env.UI4A_CAPABILITY_CALLBACK_TOKEN;
  const actual = request.headers.get('x-ui4a-capability-token');
  if (expected === undefined || expected === '' || actual === null) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!authorized(request))
    return Response.json({ error: 'capability callback unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'callback body must be JSON' }, { status: 400 });
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { runId?: unknown }).runId !== 'string'
  ) {
    return Response.json({ error: 'runId is required' }, { status: 400 });
  }
  const runId = (body as { runId: string }).runId;
  const db = getDb();
  const run = await getCapabilityRunInternal(db, runId);
  if (run === undefined)
    return Response.json({ error: 'capability run not found' }, { status: 404 });
  const engine = await getEngine(db);
  const existing = await engine.getEntity(run.source.rel);
  const fields = existing?.properties.fields as Record<string, unknown> | undefined;
  if (
    fields?.runId === runId &&
    ['review-ready', 'implementation-failed'].includes(String(existing?.properties.node))
  ) {
    return Response.json({ entity: existing, deduplicated: true });
  }
  const succeeded = run.status === 'succeeded' && run.result !== undefined;
  const terminalFailure =
    run.status === 'failed' || run.status === 'cancelled' || run.status === 'stale';
  if (!succeeded && !terminalFailure) {
    return Response.json(
      { error: `capability run is not callback-terminal (${run.status})` },
      { status: 409 },
    );
  }
  const action = succeeded ? run.source.onDoneAction : run.source.onErrorAction;
  if (action === undefined)
    return Response.json({ error: 'declared callback action is missing' }, { status: 409 });
  const outcome = await engine.exec({
    rel: run.source.rel,
    action,
    actor: 'agent',
    principal: `system:capability:${runId}`,
    channel: 'capability-callback',
    params: succeeded
      ? { runId, resultId: run.result!.resultId }
      : {
          runId,
          reason: run.failure?.reason ?? run.terminalReason ?? `capability run ${run.status}`,
        },
  });
  if (outcome.kind !== 'accepted') {
    return Response.json(
      {
        layer: outcome.kind === 'rejected' ? outcome.layer : 'guard-failed',
        reason: outcome.kind === 'rejected' ? outcome.reason : 'callback suspended',
      },
      { status: 422 },
    );
  }
  return Response.json({ entity: outcome.entity, deduplicated: false });
}
