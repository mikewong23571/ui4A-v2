import {
  planGenericSurface,
  type SirenEntity,
  type SurfaceBinding,
  type SurfaceTree,
} from '@ui4a/engine';

import { PRESENTATION_SURFACE_CATALOG } from '../../engine/presentation/catalog';
import { semanticHintsOf } from '../../engine/presentation/situation';
import { UI4A_A2UI_CATALOG_ADAPTER } from './catalog-adapter';
import { compileSurfaceTree, type A2uiMessageBundle } from './compiler';

export interface GenericPresentationPlan {
  surface: SurfaceTree;
  bundle: A2uiMessageBundle;
  entities: Map<string, SirenEntity>;
}

function relOf(entity: SirenEntity): string | undefined {
  const rel = entity.properties.rel;
  return typeof rel === 'string' ? rel : undefined;
}

export function presentationEntityMap(root: SirenEntity): Map<string, SirenEntity> {
  const result = new Map<string, SirenEntity>();
  const visit = (entity: SirenEntity): void => {
    const rel = relOf(entity);
    if (rel !== undefined) result.set(rel, entity);
    entity.entities?.forEach(visit);
  };
  visit(root);
  return result;
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function derefFrom(entities: ReadonlyMap<string, SirenEntity>, binding: SurfaceBinding): unknown {
  if (binding.kind === 'item') return undefined;
  const entity = entities.get(binding.subject);
  if (entity === undefined) return undefined;
  if (binding.kind === 'property') return readPath(entity, binding.path);
  if (binding.kind === 'actions') return entity.actions;
  if (binding.kind === 'links') return entity.links;
  return entity.entities;
}

export function planGenericPresentationSurface(
  subject: string,
  entity: SirenEntity,
  entityVersion: string,
): GenericPresentationPlan {
  const entities = presentationEntityMap(entity);
  const boundSubject = relOf(entity) ?? subject;
  const surface = planGenericSurface(boundSubject, entity, PRESENTATION_SURFACE_CATALOG, {
    entityVersion,
    semanticHints: semanticHintsOf(entity),
    provenanceRef: `generic:${subject}`,
  });
  const bundle = compileSurfaceTree(surface, {
    surfaceId: `presentation-${encodeURIComponent(boundSubject)}`,
    catalog: PRESENTATION_SURFACE_CATALOG,
    catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
    expectedCatalogFingerprint: UI4A_A2UI_CATALOG_ADAPTER.fingerprint,
    deref: (binding) => derefFrom(entities, binding),
  });
  return { surface, bundle, entities };
}

export function hydratePresentationSurface(
  subject: string,
  surface: SurfaceTree,
  roots: SirenEntity | readonly SirenEntity[],
): GenericPresentationPlan {
  const entities = new Map<string, SirenEntity>();
  for (const root of Array.isArray(roots) ? roots : [roots]) {
    for (const [rel, entity] of presentationEntityMap(root)) entities.set(rel, entity);
  }
  const bundle = compileSurfaceTree(surface, {
    surfaceId: `presentation-${encodeURIComponent(subject)}`,
    catalog: PRESENTATION_SURFACE_CATALOG,
    catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
    expectedCatalogFingerprint: UI4A_A2UI_CATALOG_ADAPTER.fingerprint,
    deref: (binding) => derefFrom(entities, binding),
  });
  return { surface, bundle, entities };
}
