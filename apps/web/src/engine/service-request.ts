import type { ExecRequest } from '@ui4a/engine';
import type { EngineSnapshot, FieldValue } from '@ui4a/shared';

import { selectAuthorizedCapabilityArtifacts } from './capability/dispatch';

/** Definition-plane rel discriminator shared by entity and exec routes. */
export function isMetaRel(rel: string): boolean {
  return rel === 'meta/self' || rel.startsWith('meta/') || rel.startsWith('draft:');
}

/** Request parameters with the exact provenance recorded by core events. */
export function paramsWithOrigins(request: ExecRequest): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(request.params ?? {}).map(([name, value]) => [
      name,
      { value, origin: request.paramOrigins?.[name] ?? 'intent' },
    ]),
  );
}

/** Project the request's same-source artifact references into the sealed Function binder port. */
export function capabilityArtifactsForRequest(
  request: ExecRequest,
  snapshot: EngineSnapshot,
  sourceRel: string,
) {
  return selectAuthorizedCapabilityArtifacts(
    request.params ?? {},
    snapshot.artifacts ?? {},
    sourceRel,
  );
}

export const CONFIRMATION_REL_PREFIX = 'confirmation:';
