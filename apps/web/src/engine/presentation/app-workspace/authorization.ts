import type { AuthorizedRegion } from '../broker';
import { freezeCompositionDeclaration, type BuiltinCompositionDeclaration } from '../compositions';

function canonicalEntityRel(entity: unknown, fallback: string): string {
  const rel = (entity as { properties?: { rel?: unknown } }).properties?.rel;
  return typeof rel === 'string' && rel !== '' ? rel : fallback;
}

/** Every declared alias is authorized before this canonical projection is allowed to run. */
export function deduplicateApplicationRegions(
  declaration: BuiltinCompositionDeclaration,
  regions: readonly (AuthorizedRegion & { entity: unknown })[],
): {
  declaration: BuiltinCompositionDeclaration;
  regions: Array<AuthorizedRegion & { entity: unknown }>;
} {
  const seen = new Set<string>();
  const unique = regions.filter((region) => {
    const canonicalRel = canonicalEntityRel(region.entity, region.declaration.source);
    if (seen.has(canonicalRel)) return false;
    seen.add(canonicalRel);
    return true;
  });
  return {
    declaration: freezeCompositionDeclaration({
      ...declaration,
      regions: unique.map(({ declaration: region }) => ({ ...region })),
    }),
    regions: unique,
  };
}
