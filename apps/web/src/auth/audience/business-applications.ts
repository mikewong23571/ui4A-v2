import { activeDefinitionOf, type FoldSnapshot, type Sitemap } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

export const UNRESOLVED_APPLICATION = '\u0000unresolved';

export function flowApplication(snapshot: EngineSnapshot, flowName: string): string | undefined {
  const definition =
    activeDefinitionOf(snapshot, flowName) ?? snapshot.definitions?.[flowName]?.definition;
  return definition === undefined ? undefined : (definition.app ?? 'default');
}

/**
 * 应用名归属的双集查询(T52 Phase 3 / D71.3):active(applications 键)∪
 * deprecated(deprecatedApplications 审计表键)。停用的 fold 级联会删
 * applications 键,但归属仍可判定——受众谓词据此对停用面给出确定性
 * 「授予集合无交集」拒绝,不落入空受众 fail-open;后者只保留给从未
 * 安装/无法归属的 rel(D51 语义本身不变)。
 *
 * 运行时快照是 fold 产物(FoldSnapshot,审计表在场时随行);接口按
 * shared EngineSnapshot 收窄,读 deprecatedApplications 在此单点下探
 * (与 engine/drafts/application-bundle.ts 的 applicationNameBurned 同惯例)。
 */
export function applicationOwned(snapshot: EngineSnapshot, name: string): boolean {
  return (
    snapshot.applications?.[name] !== undefined ||
    (snapshot as FoldSnapshot).deprecatedApplications?.[name] !== undefined
  );
}

export function businessApplications(
  snapshot: EngineSnapshot,
  sitemap: Sitemap,
  rel: string,
  visited = new Set<string>(),
): string[] {
  if (visited.has(rel)) return [];
  visited.add(rel);
  if (rel.startsWith('application:')) {
    const name = rel.slice('application:'.length);
    return applicationOwned(snapshot, name) ? [name] : [];
  }
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
