import type { SirenEntity } from '@ui4a/engine';

import type { MetaNavigationContext } from '../../meta-navigation';

export interface GenericRelationship {
  href: string;
  label: string;
  rawRel: string;
  hasDeclaredTitle: boolean;
}

export interface GenericRelationshipProjection {
  task: GenericRelationship[];
  mechanical: GenericRelationship[];
}

/** `self` is the sole protocol-level relation classification; all other labels stay declared. */
export function projectGenericRelationships(
  entity: SirenEntity,
  navigation: MetaNavigationContext,
  resolveHref: (href: string, navigation: MetaNavigationContext) => string | null,
): GenericRelationshipProjection {
  const projection: GenericRelationshipProjection = { task: [], mechanical: [] };
  for (const link of entity.links) {
    const href = resolveHref(link.href, navigation);
    if (href === null) continue;
    const rawRel = link.rel.join(' · ');
    const relationship = {
      href,
      label: link.title ?? rawRel,
      rawRel,
      hasDeclaredTitle: link.title !== undefined,
    };
    (link.rel.includes('self') ? projection.mechanical : projection.task).push(relationship);
  }
  return projection;
}
