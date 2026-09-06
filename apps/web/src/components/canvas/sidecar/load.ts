import { withPolicyScope } from '../../exec-client';

/** The existing Presentation request, shared by initial discovery and one bounded stale repair. */
export async function requestPresentationSidecar(
  subject: string,
  scope: string | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await fetch(withPolicyScope('/api/presentation', scope), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      principal: 'local-user',
      subject,
      intent: 'read',
      delivery: 'canvas',
      sourceMessageIds: [],
    }),
    signal,
  });
  if (!response.ok) return undefined;
  const receipt = (await response.json()) as { sidecar?: { id?: unknown } };
  return typeof receipt.sidecar?.id === 'string' ? receipt.sidecar.id : undefined;
}

/** A failed second read propagates to the existing host failure UI; there is no retry loop. */
export async function loadPresentationSidecar(
  sidecarId: string,
  subject: string,
  scope: string | undefined,
  signal: AbortSignal,
): Promise<{ sidecarId: string; response: Response }> {
  const read = (id: string) =>
    fetch(withPolicyScope(`/api/presentation/sidecar?sidecarId=${encodeURIComponent(id)}`, scope), {
      signal,
      cache: 'no-store',
    });
  const response = await read(sidecarId);
  if (response.status !== 409) return { sidecarId, response };
  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { error?: { code?: unknown } } | undefined;
  if (body?.error?.code !== 'presentation-responsibility-stale') return { sidecarId, response };
  const repairedId = await requestPresentationSidecar(subject, scope, signal);
  if (repairedId === undefined) throw new Error('Presentation responsibility replan failed');
  return { sidecarId: repairedId, response: await read(repairedId) };
}
