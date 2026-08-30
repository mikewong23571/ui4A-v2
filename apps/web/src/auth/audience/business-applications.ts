import { activeDefinitionOf, type Sitemap } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

export const UNRESOLVED_APPLICATION = '\u0000unresolved';

export function flowApplication(snapshot: EngineSnapshot, flowName: string): string | undefined {
  const definition =
    activeDefinitionOf(snapshot, flowName) ?? snapshot.definitions?.[flowName]?.definition;
  return definition === undefined ? undefined : (definition.app ?? 'default');
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
    return snapshot.applications?.[name] === undefined ? [] : [name];
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
