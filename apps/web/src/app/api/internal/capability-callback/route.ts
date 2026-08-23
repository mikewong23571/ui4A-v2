import { timingSafeEqual } from 'node:crypto';

import { getDb } from '../../../../engine/service';
import { finalizeCapabilitySource } from '../../../../engine/capability-source-callback';

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
  const outcome = await finalizeCapabilitySource(db, runId);
  return outcome.ok
    ? Response.json({ entity: outcome.entity, deduplicated: outcome.deduplicated })
    : Response.json(
        { error: outcome.reason, ...(outcome.layer === undefined ? {} : { layer: outcome.layer }) },
        { status: outcome.status },
      );
}
