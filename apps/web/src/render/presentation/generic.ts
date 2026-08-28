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
  if (binding.kind === 'actions') return entity;
  if (binding.kind === 'links') return entity.links;
  return entity.entities;
}

export function planGenericPresentationSurface(
  subject: string,
  entity: SirenEntity,
  entityVersion: string,
  intent: string,
): GenericPresentationPlan {
  const entities = presentationEntityMap(entity);
  const boundSubject = relOf(entity) ?? subject;
  const surface = planGenericSurface(boundSubject, entity, PRESENTATION_SURFACE_CATALOG, {
    entityVersion,
    intent,
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
  requestedRels?: readonly string[],
): GenericPresentationPlan {
  const entities = new Map<string, SirenEntity>();
  const rootList = Array.isArray(roots) ? roots : [roots];
  for (const root of rootList) {
    for (const [rel, entity] of presentationEntityMap(root)) entities.set(rel, entity);
  }
  // T35 F-03:sidecar 按注视 subject(flow:<name>)规划绑定,但服务端 flow
  // 别名会以实例 rel(<name>:main)返回依赖实体——单根时把注视 subject 映射
  // 到该根,绑定 deref 不因规范 rel 漂移而集体落空。零新事实:同一实体两个键。
  if (!entities.has(subject) && rootList.length === 1) {
    const only = relOf(rootList[0]!);
    if (only !== undefined && only !== subject) entities.set(subject, rootList[0]!);
  }
  // T37:组合面多根 hydrate 时,依赖按声明源 rel 请求(flow:<name>),服务端
  // flow 别名让对应根的实际 rel 变成实例 rel——已持久化 sidecar 的绑定仍指向
  // 声明源。逐根按「依赖请求 rel」补别名键(T35 F-03 的多根推广);同一实体
  // 两个键,零新事实。
  if (requestedRels !== undefined) {
    const paired = Math.min(requestedRels.length, rootList.length);
    for (let index = 0; index < paired; index += 1) {
      const requested = requestedRels[index]!;
      if (entities.has(requested)) continue;
      const actual = relOf(rootList[index]!);
      if (actual !== undefined && actual !== requested) entities.set(requested, rootList[index]!);
    }
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
