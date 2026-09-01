import { timingSafeEqual } from 'node:crypto';

import { NATIVE_FUNCTION_OUTPUT_BYTES_MAX, parseNativeFunctionCallbackClaim } from '@ui4a/shared';

import { finalizeNativeFunctionSource } from '../../../../engine/capability/finalize';
import { getDb } from '../../../../engine/service';

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
  if (!authorized(request)) {
    return Response.json({ error: 'native function callback unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'callback body must be JSON' }, { status: 400 });
  }
  let claim;
  try {
    claim = parseNativeFunctionCallbackClaim(body, NATIVE_FUNCTION_OUTPUT_BYTES_MAX);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
  const outcome = await finalizeNativeFunctionSource(getDb(), claim);
  return outcome.ok
    ? Response.json({ deduplicated: outcome.deduplicated, callback: outcome.callback })
    : Response.json({ error: outcome.reason, code: outcome.code }, { status: outcome.status });
}
