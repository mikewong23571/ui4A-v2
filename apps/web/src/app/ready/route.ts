import { getWebReadinessSnapshot } from '../../readiness/readiness';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const snapshot = await getWebReadinessSnapshot();
  return Response.json(snapshot, {
    status: snapshot.status === 'ready' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
