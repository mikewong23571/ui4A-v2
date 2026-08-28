import type { SurfaceNode, UserSidecarAggregate } from '@ui4a/engine';

import {
  resolveBuiltinCompositionSubject,
  type BuiltinCompositionSubjectResolution,
} from './compositions';
import { getAuthorizedPresentationResult } from './authorized-entity';

/** Stored 工件重审失败的最小归因(D51/B3):grants-shrunk | sources-unreachable。 */
export type StoredSidecarDenialReason = 'grants-shrunk' | 'sources-unreachable';

export type StoredSidecarAuthorization =
  { ok: true } | { ok: false; reason: StoredSidecarDenialReason };

/** Subject resolution hook; async so derived namespaces (T37 app workspaces) can resolve. */
export type CompositionSubjectResolver = (
  subject: string,
) => BuiltinCompositionSubjectResolution | Promise<BuiltinCompositionSubjectResolution>;

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

async function orderedSources(
  sidecar: UserSidecarAggregate,
  versionNumber: number,
  resolveCompositionSubject: CompositionSubjectResolver = resolveBuiltinCompositionSubject,
): Promise<string[]> {
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
  const composition = await resolveCompositionSubject(sidecar.key.subject);
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

/**
 * Reauthorize every real source used by a stored active/target Surface before
 * disclosure/mutation. D51:stored key 无 scope 维度,命中重审口径 =
 * principal 严格相等 + 全部真实 sources 按当前授予集合逐项重审(授予集合变化
 * 由依赖指纹失效触发自动重规划);跨 principal 的存在性隐藏由调用方 404 承担。
 * B3:返回值携带最小归因——受众越界(grants-shrunk)与不可读/不存在
 * (sources-unreachable)分流,供路由表达结构化 denied;首个失败源决定 reason。
 */
export async function authorizeStoredSidecar(
  sidecar: UserSidecarAggregate,
  trusted: { principal: string; grantedApplications: readonly string[] },
  versionNumber = sidecar.activeVersion,
  resolveCompositionSubject?: CompositionSubjectResolver,
): Promise<StoredSidecarAuthorization> {
  if (
    sidecar.key.principal !== trusted.principal ||
    sidecar.versions[versionNumber] === undefined
  ) {
    // 路由已按 principal 过滤读取;此处不区分原因,统一按不可读处理。
    return { ok: false, reason: 'sources-unreachable' };
  }
  try {
    const sources = await orderedSources(sidecar, versionNumber, resolveCompositionSubject);
    for (const source of sources) {
      const outcome = await getAuthorizedPresentationResult(
        source,
        trusted.principal,
        trusted.grantedApplications,
      );
      if (outcome.kind === 'authorized') continue;
      return {
        ok: false,
        reason: outcome.kind === 'audience-unreachable' ? 'grants-shrunk' : 'sources-unreachable',
      };
    }
  } catch {
    return { ok: false, reason: 'sources-unreachable' };
  }
  return { ok: true };
}
