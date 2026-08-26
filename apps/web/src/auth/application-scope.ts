import { activeDefinitionOf, type SirenEntity, type Sitemap } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import { ProductionIdentityError } from './production/request-identity';

type Plane = 'business' | 'meta';
const UNRESOLVED_APPLICATION = '\u0000unresolved';

interface ScopeContext {
  snapshot: EngineSnapshot;
  sitemap: Sitemap;
  policyScope: string;
  plane: Plane;
}

function flowApplication(snapshot: EngineSnapshot, flowName: string): string | undefined {
  const definition =
    activeDefinitionOf(snapshot, flowName) ?? snapshot.definitions?.[flowName]?.definition;
  return definition === undefined ? undefined : (definition.app ?? 'default');
}

function businessApplications(
  snapshot: EngineSnapshot,
  sitemap: Sitemap,
  rel: string,
  visited = new Set<string>(),
): string[] {
  if (visited.has(rel)) return [];
  visited.add(rel);
  if (rel.startsWith('confirmation:')) {
    const confirmation = snapshot.confirmations?.[rel];
    if (confirmation === undefined) return [];
    const applications = businessApplications(snapshot, sitemap, confirmation.targetRel, visited);
    return applications.length === 0 ? [UNRESOLVED_APPLICATION] : applications;
  }
  if (rel.startsWith('flow:')) {
    const application = flowApplication(snapshot, rel.slice('flow:'.length));
    return application === undefined ? [] : [application];
  }
  const instance = snapshot.instances[rel];
  if (instance !== undefined) {
    const application = flowApplication(snapshot, instance.flow);
    return application === undefined ? [UNRESOLVED_APPLICATION] : [application];
  }
  const surface =
    sitemap.surfaces.find((candidate) => candidate.rel === rel) ??
    sitemap.surfaces.find(
      (candidate) =>
        candidate.memberRelPrefix !== undefined && rel.startsWith(candidate.memberRelPrefix),
    );
  if (surface === undefined || surface.scope === 'principal') return [];
  return [surface.app ?? 'default'];
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

function applicationsForRel(context: Omit<ScopeContext, 'policyScope'>, rel: string): string[] {
  return context.plane === 'business'
    ? businessApplications(context.snapshot, context.sitemap, rel)
    : metaApplications(context.snapshot, context.sitemap, rel);
}

/**
 * 判定一个已授予 policy scope 是否覆盖目标 rel(T22 验证修复:未显式请求 scope 时
 * 服务端按 rel 归属在已授予 scope 中确定性选择)。未知 rel 视为被任意 scope 覆盖,
 * 交由下游照常裁决,不扩大授权。
 */
export function relCoveredByPolicyScope(
  context: Omit<ScopeContext, 'policyScope'>,
  rel: string,
  policyScope: string,
): boolean {
  const applications = applicationsForRel(context, rel);
  return applications.length === 0 || applications.includes(policyScope);
}

/** Reject a known rel whose server-owned Application differs from the credential policy scope. */
export function assertRelInPolicyScope(context: ScopeContext & { rel: string }): void {
  const applications = applicationsForRel(context, context.rel);
  if (applications.length > 0 && !applications.includes(context.policyScope)) {
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

function visibleInPolicyScope(context: ScopeContext, rel: string): boolean {
  if (context.plane === 'business' && (rel.startsWith('meta/') || rel.startsWith('_meta'))) {
    return false;
  }
  const applications = applicationsForRel(context, rel);
  return applications.length === 0 || applications.includes(context.policyScope);
}

function filterReferenceProperty(value: unknown, context: ScopeContext): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((item) => {
    const rel = typeof item === 'string' ? item : (item as { rel?: unknown })?.rel;
    return typeof rel !== 'string' || visibleInPolicyScope(context, rel);
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

/** Strip cross-Application children and links from a collection-style Siren projection. */
export function filterEntityForPolicyScope(
  entity: SirenEntity,
  context: ScopeContext,
): SirenEntity {
  const entities = entity.entities?.filter((child) => {
    const rel = relFromHref(child.href);
    if (rel === undefined) return true;
    return visibleInPolicyScope(context, rel);
  });
  const links = entity.links.filter((link) => {
    const rel = relFromHref(link.href);
    if (rel === undefined) return true;
    return visibleInPolicyScope(context, rel);
  });
  const threadProperties = entity.class.includes('work-thread')
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
        ? { ...threadProperties, count: entities.length }
        : threadProperties,
    links,
    ...(entities === undefined ? {} : { entities }),
  };
}
