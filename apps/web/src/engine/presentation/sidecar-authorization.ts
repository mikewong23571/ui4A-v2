import type { SurfaceNode, UserSidecarAggregate } from '@ui4a/engine';

import { resolveBuiltinCompositionSubject } from './compositions';
import { getAuthorizedPresentationEntity } from './authorized-entity';

function collectNodeSources(node: SurfaceNode, sources: Set<string>): void {
  for (const dependency of node.dependencies) {
    if (dependency.kind === 'entity' && !dependency.subject.startsWith('$slot:')) {
      sources.add(dependency.subject);
    }
  }
  switch (node.kind) {
    case 'layout':
      node.children.forEach((child) => collectNodeSources(child, sources));
      break;
    case 'slot':
      collectNodeSources(node.child, sources);
      break;
    case 'repeat':
      if (!node.source.subject.startsWith('$slot:')) sources.add(node.source.subject);
      collectNodeSources(node.item, sources);
      break;
    case 'word':
      for (const binding of Object.values(node.bindings)) {
        if (binding.kind !== 'item' && !binding.subject.startsWith('$slot:')) {
          sources.add(binding.subject);
        }
      }
      break;
    case 'diagnostic':
      break;
  }
}

export function hasUnavailableRegion(node: SurfaceNode): boolean {
  if (node.kind === 'diagnostic') return node.code === 'region-unavailable';
  if (node.kind === 'layout') return node.children.some(hasUnavailableRegion);
  if (node.kind === 'slot') return hasUnavailableRegion(node.child);
  if (node.kind === 'repeat') return hasUnavailableRegion(node.item);
  return false;
}

function orderedSources(sidecar: UserSidecarAggregate, versionNumber: number): string[] {
  const version = sidecar.versions[versionNumber];
  if (version === undefined) return [];
  const discovered = new Set<string>();
  collectNodeSources(version.surface.root, discovered);
  for (const dependency of version.dependencies) {
    if (
      (dependency.kind === 'entity-contract' || dependency.kind === 'collection-membership') &&
      !dependency.ref.startsWith('$slot:')
    ) {
      discovered.add(dependency.ref);
    }
  }

  if (typeof sidecar.key.subject !== 'string') {
    const roots = sidecar.key.subject.selection;
    return [...roots, ...[...discovered].filter((source) => !roots.includes(source))];
  }
  const composition = resolveBuiltinCompositionSubject(sidecar.key.subject);
  if (composition.kind === 'composition') {
    const declared = composition.declaration.regions
      .map((region) => region.source)
      .filter((source) => discovered.has(source));
    return [...declared, ...[...discovered].filter((source) => !declared.includes(source))];
  }
  return [
    sidecar.key.subject,
    ...[...discovered].filter((source) => source !== sidecar.key.subject),
  ];
}

/** Reauthorize every real source used by a stored active/target Surface before disclosure/mutation. */
export async function authorizeStoredSidecar(
  sidecar: UserSidecarAggregate,
  trusted: { principal: string; policyScope: string },
  versionNumber = sidecar.activeVersion,
): Promise<boolean> {
  if (
    sidecar.key.principal !== trusted.principal ||
    sidecar.key.policyScope !== trusted.policyScope ||
    sidecar.versions[versionNumber] === undefined
  ) {
    return false;
  }
  try {
    for (const source of orderedSources(sidecar, versionNumber)) {
      if (
        (await getAuthorizedPresentationEntity(source, trusted.principal, trusted.policyScope)) ===
        undefined
      ) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}
