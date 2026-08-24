import { webLivePayload } from '../../release';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(webLivePayload());
}
