import { getDb } from '../../../../engine/service';
import { ensurePresentationTables, getSidecarById } from '../../../../db/presentation';

export const dynamic = 'force-dynamic';

const LOCAL_PRESENTATION_PRINCIPAL = 'user:local';

export async function GET(request: Request): Promise<Response> {
  const sidecarId = new URL(request.url).searchParams.get('sidecarId');
  if (sidecarId === null || sidecarId === '') {
    return Response.json({ error: 'sidecarId is required' }, { status: 400 });
  }
  await ensurePresentationTables(getDb());
  const sidecar = await getSidecarById(getDb(), sidecarId, LOCAL_PRESENTATION_PRINCIPAL);
  if (sidecar === undefined) return Response.json({ error: 'Sidecar not found' }, { status: 404 });
  const active = sidecar.versions[sidecar.activeVersion]!;
  return Response.json({
    sidecar: {
      id: sidecar.id,
      version: sidecar.activeVersion,
      key: sidecar.key,
      surface: active.surface,
      dependencies: active.dependencies,
      retention: active.retention,
      provenance: active.provenance,
    },
  });
}
