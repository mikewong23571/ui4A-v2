import {
  THREAD_INPUT_REL_PREFIX,
  THREAD_REL_PREFIX,
  type SirenEntity,
  type Sitemap,
} from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import { ProductionIdentityError } from './production/request-identity';
import { entityRel, filterEntityTree } from './audience/entity-projection';
import {
  applicationDeprecated,
  businessApplications,
  metaApplications,
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

function applicationsForRel(context: AudienceContext, rel: string): string[] {
  return context.plane === 'business'
    ? businessApplications(context.snapshot, context.sitemap, rel)
    : metaApplications(context.snapshot, context.sitemap, rel);
}

/** 与咽喉同谓词的受众判定(business/meta 两平面共用;start-chain 复用同一权威)。 */
export function reachableForGranted(
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
 *
 * D73 拒绝码分型:归属全集全部位于停用审计表 → `application_deprecated`
 * (「不可再访问:应用已停用」——停用是全局终态而非权限事实);否则
 * `scope_insufficient`(存在活跃归属,真正无权限)。两码同 403 族,不泄露
 * 跨 principal 存在性,不把所有 403 粗暴改 404。
 */
export function assertReachable(
  context: AudienceContext,
  rel: string,
  grantedApplications: readonly string[],
): void {
  if (!reachableForGranted(context, rel, grantedApplications)) {
    const applications = applicationsForRel(context, rel);
    const onlyDeprecated =
      applications.length > 0 &&
      applications.every((application) => applicationDeprecated(context.snapshot, application));
    throw new ProductionIdentityError(
      onlyDeprecated ? 'application_deprecated' : 'scope_insufficient',
    );
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

function threadResourceId(rel: string): string | undefined {
  const prefix = [THREAD_REL_PREFIX, THREAD_INPUT_REL_PREFIX].find((candidate) =>
    rel.startsWith(candidate),
  );
  return prefix === undefined ? undefined : rel.slice(prefix.length);
}

function ownedThreadReference(snapshot: EngineSnapshot, rel: string, principal: string): boolean {
  const id = threadResourceId(rel);
  return id === undefined || snapshot.threads?.[id]?.owner === principal;
}

function sourceRel(snapshot: EngineSnapshot, rel: string): string {
  return snapshot.threads?.[rel] === undefined ? rel : `thread:${rel}`;
}

/** Exact thread reads and writes are always constrained by the trusted request principal. */
export function assertThreadOwner(snapshot: EngineSnapshot, rel: string, principal: string): void {
  const id = threadResourceId(rel);
  if (id === undefined) return;
  const thread = snapshot.threads?.[id];
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
  const entities =
    rel === 'threads'
      ? entity.entities?.filter((child) => {
          const id = child.properties.id;
          return typeof id === 'string' && snapshot.threads?.[id]?.owner === principal;
        })
      : entity.entities;
  return filterEntityTree(
    { ...entity, ...(entities === undefined ? {} : { entities }) },
    {
      readable: (reference) => ownedThreadReference(snapshot, reference, principal),
      referenceHolder: (child) => entityRel(child)?.startsWith('thread:') === true,
      sourceRel: (reference) => sourceRel(snapshot, reference),
    },
  );
}

/**
 * 声明式判定(R7):实体是否属于某个以 scope='principal' + memberRelPrefix 声明
 * 成员族的 sitemap 面(如 threads → thread:*)。这类面的成员是 Application 中立、
 * principal 持有的引用承载实体,其 context/active/approval 引用属性需按当前授予
 * 集合逐成员重审。判定依据 sitemap 声明元数据与实体自身 self rel,不绑定任何
 * per-class 字面量;未参与该声明的实体保持原样。
 */
function governedByPrincipalMemberFamily(sitemap: Sitemap, entity: SirenEntity): boolean {
  const rel = entityRel(entity);
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
  context: AudienceContext & { grantedApplications: readonly string[]; principal: string },
): SirenEntity {
  return filterEntityTree(entity, {
    readable: (rel) =>
      ownedThreadReference(context.snapshot, rel, context.principal) &&
      reachableForGranted(context, rel, context.grantedApplications),
    referenceHolder: (child) => governedByPrincipalMemberFamily(context.sitemap, child),
    sourceRel: (rel) => sourceRel(context.snapshot, rel),
  });
}
