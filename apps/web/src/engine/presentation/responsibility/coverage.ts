import {
  validateResponsibilityCoverage,
  type SurfaceTree,
  type UserSidecarAggregate,
} from '@ui4a/engine';

import type { AuthorizedRoot } from '../broker';
import { PRESENTATION_SURFACE_CATALOG } from '../catalog';
import { getAuthorizedPresentationResult } from '../authorized-entity';
import { resolveBuiltinCompositionSubject } from '../compositions';
import type { CompositionSubjectResolver } from '../sidecar-authorization';

/** Root contents have already passed principal/audience authorization; this adds no authority. */
export function hasResponsibilityCoverage(
  surface: SurfaceTree,
  root: Pick<AuthorizedRoot, 'rels' | 'entities'>,
  view?: { collapsedNodeIds: readonly string[] },
): boolean {
  return validateResponsibilityCoverage(
    surface,
    root.rels.map((subject, index) => ({
      subject,
      entity: root.entities[index],
    })),
    PRESENTATION_SURFACE_CATALOG,
    view,
  ).valid;
}

/**
 * Direct stored-Surface reads also need fresh responsibility coverage. Discover roots from the
 * current composition declaration, never from a saved Surface that may have omitted a region.
 * Unavailable declared regions remain partial authorization, as in the existing Broker.
 */
export async function storedResponsibilityCoverage(
  sidecar: UserSidecarAggregate,
  trusted: { principal: string; grantedApplications: readonly string[] },
  resolveComposition: CompositionSubjectResolver = resolveBuiltinCompositionSubject,
  candidate?: { surface: SurfaceTree; view?: { collapsedNodeIds: readonly string[] } },
): Promise<boolean> {
  if (sidecar.key.principal !== trusted.principal) return false;
  const active = candidate ?? sidecar.versions[sidecar.activeVersion];
  if (active === undefined) return false;
  try {
    const subject = sidecar.key.subject;
    const composition = typeof subject === 'string' ? await resolveComposition(subject) : undefined;
    if (composition?.kind === 'rejected-workspace') return false;
    const roots =
      typeof subject !== 'string'
        ? subject.selection
        : composition?.kind === 'composition'
          ? composition.declaration.regions.map((region) => region.source)
          : [subject];
    const authorized = await Promise.all(
      [...new Set(roots)].map(async (rel) => ({
        rel,
        result: await getAuthorizedPresentationResult(
          rel,
          trusted.principal,
          trusted.grantedApplications,
        ),
      })),
    );
    const visible = authorized.filter(
      ({ result }) => result.kind === 'authorized' && result.entity !== undefined,
    );
    return hasResponsibilityCoverage(
      active.surface,
      {
        rels: visible.map(({ rel }) => rel),
        entities: visible.map(({ result }) => result.entity),
      },
      active.view,
    );
  } catch {
    return false;
  }
}
