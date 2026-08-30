import type { AuthorizedRegion } from '../broker';
import { freezeCompositionDeclaration, type BuiltinCompositionDeclaration } from '../compositions';

function canonicalEntityRel(entity: unknown, fallback: string): string {
  const rel = (entity as { properties?: { rel?: unknown } }).properties?.rel;
  return typeof rel === 'string' && rel !== '' ? rel : fallback;
}

function isCollection(entity: unknown): boolean {
  const classes = (entity as { class?: unknown }).class;
  return Array.isArray(classes) && classes.includes('collection');
}

function embeddedCanonicalRels(entity: unknown): string[] {
  const members = (entity as { entities?: unknown }).entities;
  if (!Array.isArray(members)) return [];
  return members.map((member) => canonicalEntityRel(member, '')).filter((rel) => rel !== '');
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
  const exact = new Set(
    unique.flatMap((region) =>
      isCollection(region.entity)
        ? []
        : [canonicalEntityRel(region.entity, region.declaration.source)],
    ),
  );
  const projected = unique.map((region) => {
    if (!isCollection(region.entity)) return region;
    const excludedMemberRels = embeddedCanonicalRels(region.entity).filter((rel) => exact.has(rel));
    return excludedMemberRels.length === 0 ? region : { ...region, excludedMemberRels };
  });
  return {
    declaration: freezeCompositionDeclaration({
      ...declaration,
      regions: projected.map(({ declaration: region }) => ({ ...region })),
    }),
    regions: projected,
  };
}
