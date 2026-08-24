import { webReleaseMetadata } from '../../release';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(webReleaseMetadata());
}
