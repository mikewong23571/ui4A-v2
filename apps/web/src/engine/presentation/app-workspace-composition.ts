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
} from './compositions';

export const APP_WORKSPACE_SUBJECT_PREFIX = 'workspace:app:';

/** Structural views of the sitemap inputs the derivation consumes (engine Sitemap satisfies both). */
export interface AppWorkspaceSurfaceView {
  rel: string;
  title?: string;
  collection?: boolean;
  app?: string;
  scope?: 'application' | 'principal';
}

export interface AppWorkspaceSitemapView {
  surfaces?: readonly AppWorkspaceSurfaceView[];
  applications?: ReadonlyArray<{
    name: string;
    title?: string;
    intent?: string;
    entry?: string;
    flows?: ReadonlyArray<{ name: string; app?: string }>;
  }>;
}

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
 * is the honest empty answer (unknown scope, or an app without any product surface).
 */
export function deriveAppWorkspaceComposition(
  scope: string,
  sitemap: AppWorkspaceSitemapView,
): BuiltinCompositionDeclaration | undefined {
  const application = (sitemap.applications ?? []).find((entry) => entry.name === scope);
  const title = application?.title ?? scope;
  const surfaces = sitemap.surfaces ?? [];
  const appSurfaces = surfaces.filter(
    (surface) =>
      surface.app === scope && surface.collection === true && surface.scope !== 'principal',
  );
  const surfaceOf = (rel: string): AppWorkspaceSurfaceView | undefined =>
    surfaces.find((surface) => surface.rel === rel);
  const entry =
    application?.entry ??
    surfaces.find((surface) => surface.app === scope && surface.collection !== true)?.rel;

  const regions: Array<{
    region: string;
    source: string;
    intent: string;
    mode: 'invalidate';
    shape: 'entity' | 'collection';
    density?: 'table';
  }> = [];
  const taken = new Set<string>();
  const usedSources = new Set<string>();
  for (const surface of appSurfaces) {
    regions.push({
      region: regionIdOf(surface.rel, taken),
      source: surface.rel,
      intent: `浏览 ${title} 的产物`,
      mode: 'invalidate',
      shape: 'collection',
      // 产物集合区域以表格密度呈现成员(通用词汇 member-table,声明驱动零特判);
      // 入口 region 不受影响,维持缺省 card。
      density: 'table',
    });
    usedSources.add(surface.rel);
  }
  if (entry !== undefined && !usedSources.has(entry)) {
    const entryIsCollection = surfaceOf(entry)?.collection === true;
    regions.push({
      region: regionIdOf(entry, taken),
      source: entry,
      intent: entryIsCollection ? `浏览 ${title} 的产物` : `发起 ${title} 的流程`,
      mode: 'invalidate',
      shape: entryIsCollection ? 'collection' : 'entity',
      // 集合形态的入口(如 community 的 comments)同为查询面,与产物集合一致走
      // 表格密度;实体形态的入口维持缺省 card。
      ...(entryIsCollection ? { density: 'table' as const } : {}),
    });
  }
  if (regions.length === 0) return undefined;

  return freezeCompositionDeclaration({
    id: parseCompositionId(`app-${scope.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-') || 'app'}`),
    version: '1',
    regions: regions.map(({ region, source, intent, mode, shape, density }) => ({
      region,
      source,
      intent,
      mode,
      shape,
      ...(density === undefined ? {} : { density }),
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
