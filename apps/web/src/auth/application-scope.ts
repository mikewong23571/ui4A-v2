import type { SirenEntity, Sitemap } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import { ProductionIdentityError } from './production/request-identity';
import {
  businessApplications,
  flowApplication,
  UNRESOLVED_APPLICATION,
} from './audience/business-applications';

type Plane = 'business' | 'meta';

/**
 * D51 受众谓词上下文:授权的唯一输入是凭证授予的应用集合 × 事实的归属应用
 * (归属证据来自 snapshot/sitemap,不来自会话状态)。
 */
export interface AudienceContext {
  snapshot: EngineSnapshot;
  sitemap: Sitemap;
  plane: Plane;
}

function metaApplications(snapshot: EngineSnapshot, sitemap: Sitemap, rel: string): string[] {
  if (rel.startsWith('meta/application:')) {
    const name = rel.slice('meta/application:'.length);
    return snapshot.applications?.[name] === undefined ? [] : [name];
  }
  if (rel.startsWith('meta/flow:')) {
    const application = flowApplication(snapshot, rel.slice('meta/flow:'.length));
    return application === undefined ? [] : [application];
  }
  if (rel.startsWith('meta/activation:')) {
    const activation = snapshot.activations?.[rel];
    if (activation === undefined) return [];
    const flow = activation.flow;
    const application = flow === undefined ? undefined : flowApplication(snapshot, flow);
    return application === undefined ? [UNRESOLVED_APPLICATION] : [application];
  }
  if (rel.startsWith('meta/capability:')) {
    const capability = snapshot.capabilities?.[rel.slice('meta/capability:'.length)];
    if (capability === undefined) return [];
    const applications =
      sitemap.capabilities.find(
        (capability) => capability.name === rel.slice('meta/capability:'.length),
      )?.scope.applications ?? [];
    return applications.length === 0 ? [UNRESOLVED_APPLICATION] : applications;
  }
  return [];
}

function applicationsForRel(context: AudienceContext, rel: string): string[] {
  return context.plane === 'business'
    ? businessApplications(context.snapshot, context.sitemap, rel)
    : metaApplications(context.snapshot, context.sitemap, rel);
}

function reachableForGranted(
  context: AudienceContext,
  rel: string,
  grantedApplications: readonly string[],
): boolean {
  if (context.plane === 'business' && (rel.startsWith('meta/') || rel.startsWith('_meta'))) {
    return false;
  }
  // 归属应用为空的 rel 不在受众谓词管辖内(fail-open),交由既有三段裁决兜底。
  const applications = applicationsForRel(context, rel);
  if (applications.length === 0) return true;
  return applications.some((application) => grantedApplications.includes(application));
}

/**
 * 咽喉守卫(D51):目标 rel 的归属应用与凭证授予的应用集合无交集 → 结构化拒绝。
 * 未知 rel(无可判定归属)直接放行,扩大边界由 declaration→guard→schema 裁决兜底。
 */
export function assertReachable(
  context: AudienceContext,
  rel: string,
  grantedApplications: readonly string[],
): void {
  if (!reachableForGranted(context, rel, grantedApplications)) {
    throw new ProductionIdentityError('scope_insufficient');
  }
}

/** Return the business discovery contract visible within one verified Application scope. */
export function filterSitemapForPolicyScope(sitemap: Sitemap, policyScope: string): Sitemap {
  const flows = sitemap.flows.filter((flow) => flow.app === policyScope);
  return {
    ...sitemap,
    version: `${sitemap.version}:${policyScope}`,
    surfaces: sitemap.surfaces.filter(
      (surface) => surface.scope === 'principal' || surface.app === policyScope,
    ),
    flows,
    applications: sitemap.applications
      .filter((application) => application.name === policyScope)
      .map((application) => ({
        ...application,
        flows: application.flows.filter((flow) => flow.app === policyScope),
      })),
    capabilities: sitemap.capabilities.filter((capability) =>
      capability.scope.applications.includes(policyScope),
    ),
  };
}

function relFromHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  try {
    return new URL(href, 'https://ui4a.invalid').searchParams.get('rel') ?? undefined;
  } catch {
    return undefined;
  }
}

function filterReferenceProperty(
  value: unknown,
  context: AudienceContext & { grantedApplications: readonly string[] },
): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((item) => {
    const rel = typeof item === 'string' ? item : (item as { rel?: unknown })?.rel;
    return (
      typeof rel !== 'string' || reachableForGranted(context, rel, context.grantedApplications)
    );
  });
}

/** Exact thread reads and writes are always constrained by the trusted request principal. */
export function assertThreadOwner(snapshot: EngineSnapshot, rel: string, principal: string): void {
  if (!rel.startsWith('thread:')) return;
  const thread = snapshot.threads?.[rel.slice('thread:'.length)];
  if (thread !== undefined && thread.owner !== principal) {
    throw new ProductionIdentityError('scope_insufficient');
  }
}

/** Filter the principal-scoped threads collection without trusting projected owner fields. */
export function filterThreadEntityForPrincipal(
  entity: SirenEntity,
  snapshot: EngineSnapshot,
  rel: string,
  principal: string,
): SirenEntity {
  if (rel !== 'threads' || entity.entities === undefined) return entity;
  const entities = entity.entities.filter((child) => {
    const id = child.properties.id;
    return typeof id === 'string' && snapshot.threads?.[id]?.owner === principal;
  });
  return {
    ...entity,
    properties: { ...entity.properties, count: entities.length },
    entities,
  };
}

/**
 * 声明式判定(R7):实体是否属于某个以 scope='principal' + memberRelPrefix 声明
 * 成员族的 sitemap 面(如 threads → thread:*)。这类面的成员是 Application 中立、
 * principal 持有的引用承载实体,其 context/active/approval 引用属性需按当前授予
 * 集合逐成员重审。判定依据 sitemap 声明元数据与实体自身 self rel,不绑定任何
 * per-class 字面量;未参与该声明的实体保持原样。
 */
function governedByPrincipalMemberFamily(sitemap: Sitemap, entity: SirenEntity): boolean {
  const rel = relFromHref(entity.links.find((link) => link.rel.includes('self'))?.href);
  return (
    rel !== undefined &&
    sitemap.surfaces.some(
      (surface) =>
        surface.scope === 'principal' &&
        surface.memberRelPrefix !== undefined &&
        rel.startsWith(surface.memberRelPrefix),
    )
  );
}

/** Strip granted-application-external children and links from a collection-style Siren projection. */
export function filterEntityForGrantedApplications(
  entity: SirenEntity,
  context: AudienceContext & { grantedApplications: readonly string[] },
): SirenEntity {
  const entities = entity.entities?.filter((child) => {
    const rel = relFromHref(child.href);
    if (rel === undefined) return true;
    return reachableForGranted(context, rel, context.grantedApplications);
  });
  const links = entity.links.filter((link) => {
    const rel = relFromHref(link.href);
    if (rel === undefined) return true;
    return reachableForGranted(context, rel, context.grantedApplications);
  });
  const referenceProperties = governedByPrincipalMemberFamily(context.sitemap, entity)
    ? {
        ...entity.properties,
        context: filterReferenceProperty(entity.properties.context, context),
        active: filterReferenceProperty(entity.properties.active, context),
        approval: filterReferenceProperty(entity.properties.approval, context),
      }
    : entity.properties;
  return {
    ...entity,
    properties:
      entities !== undefined && typeof entity.properties.count === 'number'
        ? { ...referenceProperties, count: entities.length }
        : referenceProperties,
    links,
    ...(entities === undefined ? {} : { entities }),
  };
}
