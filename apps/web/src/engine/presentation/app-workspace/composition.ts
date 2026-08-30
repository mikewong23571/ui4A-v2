/**
 * T37 FR3:应用工作区组合 subject(`workspace:app:<scope>`)的运行时声明推导。
 *
 * 给定 scope,从 sitemap surfaces 按 app 归属推导组合 regions——产物集合表面各一
 * collection region,应用声明的默认入口表面一个 region(entry 缺省回退该 app 的
 * 首个 flow 面)。推导是通用代码:同一函数吃任何应用的 sitemap 数据,零 per-app
 * 分支(北极星 §六);组合不产生真相——虚主体不进业务 sitemap、不可 exec,区域
 * 数据仍由 Broker 逐源重授权(D51,授权 = grantedApplications × 事实归属)。
 */
import { parseCompositionId } from '@ui4a/shared';

import {
  freezeCompositionDeclaration,
  resolveBuiltinCompositionSubject,
  type BuiltinCompositionDeclaration,
  type BuiltinCompositionSubjectResolution,
} from '../compositions';
import { cognitivePresentationRole, genericRegionIntent } from '../generic-intent-policy';
import {
  resolveAppWorkspaceMembership,
  type AppWorkspaceSitemapView,
  type AppWorkspaceSurfaceView,
} from './membership';

export type { AppWorkspaceSitemapView, AppWorkspaceSurfaceView } from './membership';

export const APP_WORKSPACE_SUBJECT_PREFIX = 'workspace:app:';

export const APP_WORKSPACE_HEADER_REGION = 'application-header';

/**
 * The scope carried by an `workspace:app:<scope>` subject; undefined for every other
 * subject shape (empty scope stays undefined so resolution keeps rejecting it).
 */
export function appWorkspaceScopeOf(subject: string): string | undefined {
  if (!subject.startsWith(APP_WORKSPACE_SUBJECT_PREFIX)) return undefined;
  const scope = subject.slice(APP_WORKSPACE_SUBJECT_PREFIX.length);
  return scope === '' ? undefined : scope;
}

/** Region ids follow the shared bounded grammar; invalid characters collapse to '-'. */
function regionIdOf(rel: string, taken: Set<string>): string {
  const base = (rel.startsWith('flow:') ? rel.slice('flow:'.length) : rel)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .slice(0, 63);
  let id = base === '' ? 'region' : base;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(id);
  return id;
}

/**
 * Derive the app workspace declaration for one scope from sitemap topology; undefined
 * is the honest empty answer for an unknown or explicitly non-discoverable Application.
 */
export function deriveAppWorkspaceComposition(
  scope: string,
  sitemap: AppWorkspaceSitemapView,
): BuiltinCompositionDeclaration | undefined {
  const membership = resolveAppWorkspaceMembership(scope, sitemap);
  if (membership === undefined) return undefined;
  const { application, applicationRel, applicationSurfaces, entryTarget } = membership;
  if (
    Array.isArray((application.presentation as { traits?: unknown } | undefined)?.traits) &&
    ((application.presentation as { traits: unknown[] }).traits as unknown[]).includes(
      'system-fallback',
    )
  ) {
    return undefined;
  }
  const surfaces = sitemap.surfaces ?? [];
  // 产物集合区域只收「组合机器可呈现」的集合面:成员集合(合同分页判定同源,
  // sitemap pageable)——路由特判读模型(如 agent-runs,service 投影不可达)
  // 不进组合,避免整块「区域暂不可用」上屏(T38 Phase C 横扫实测)。
  const appSurfaces = applicationSurfaces.filter(
    (surface) =>
      surface.collection === true && surface.pageable === true && surface.scope !== 'principal',
  );
  const surfaceOf = (rel: string): AppWorkspaceSurfaceView | undefined =>
    surfaces.find((surface) => surface.rel === rel);
  const entry = entryTarget;

  const regions: Array<{
    region: string;
    source: string;
    intent: string;
    mode: 'invalidate';
    shape: 'entity' | 'collection';
  }> = [];
  const taken = new Set<string>();
  const usedSources = new Set<string>();
  regions.push({
    region: APP_WORKSPACE_HEADER_REGION,
    source: applicationRel,
    intent: genericRegionIntent('entity', 'identity'),
    mode: 'invalidate',
    shape: 'entity',
  });
  taken.add(APP_WORKSPACE_HEADER_REGION);
  usedSources.add(applicationRel);
  for (const surface of appSurfaces) {
    const shape = 'collection' as const;
    const semanticRole =
      surface.rel === entry
        ? application.entry?.role
        : cognitivePresentationRole(surface.presentation);
    regions.push({
      region: regionIdOf(surface.rel, taken),
      source: surface.rel,
      intent: genericRegionIntent(shape, semanticRole),
      mode: 'invalidate',
      shape,
    });
    usedSources.add(surface.rel);
  }
  if (entry !== undefined && !usedSources.has(entry)) {
    const entryIsCollection = surfaceOf(entry)?.collection === true;
    const shape = entryIsCollection ? ('collection' as const) : ('entity' as const);
    regions.push({
      region: regionIdOf(entry, taken),
      source: entry,
      intent: genericRegionIntent(shape, application.entry?.role),
      mode: 'invalidate',
      shape,
    });
  }
  return freezeCompositionDeclaration({
    id: parseCompositionId(`app-${scope.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-') || 'app'}`),
    version: membership.version,
    regions: regions.map(({ region, source, intent, mode, shape }) => ({
      region,
      source,
      intent,
      mode,
      shape,
    })),
  });
}

export type DynamicCompositionSubjectResolver = (
  subject: string,
) => Promise<BuiltinCompositionSubjectResolution>;

/**
 * Composition subject resolution with the derived app workspace namespace layered over
 * the static registry: registered `workspace:*` subjects keep winning, ordinary contract
 * rels stay `not-workspace`, and `workspace:app:<scope>` derives from the current
 * sitemap at request time. Unknown scopes remain honestly rejected.
 */
export function createDynamicCompositionSubjectResolver(
  loadSitemap: () => Promise<AppWorkspaceSitemapView | undefined>,
): DynamicCompositionSubjectResolver {
  return async (subject) => {
    const staticResolution = resolveBuiltinCompositionSubject(subject);
    if (staticResolution.kind !== 'rejected-workspace') return staticResolution;
    const scope = appWorkspaceScopeOf(subject);
    if (scope === undefined) return staticResolution;
    const sitemap = await loadSitemap();
    const declaration =
      sitemap === undefined ? undefined : deriveAppWorkspaceComposition(scope, sitemap);
    return declaration === undefined
      ? { kind: 'rejected-workspace' }
      : { kind: 'composition', declaration };
  };
}
