/**
 * Surface 规范化与序列化:依赖/绑定排序归一(canonical 形态)、
 * canonical JSON 序列化与 FNV-1a 稳定身份(非安全摘要)。
 */
import { canonicalJson, normalizedBindings, normalizedDependencies } from './internal';
import { SURFACE_SCHEMA_VERSION, type SurfaceNode, type SurfaceTree } from './types';

function normalizeNode(node: SurfaceNode): SurfaceNode {
  const base = {
    id: node.id,
    role: node.role,
    dependencies: normalizedDependencies(node.dependencies),
    provenance: node.provenance.map((entry) => ({ ...entry })),
  };
  switch (node.kind) {
    case 'layout':
      return {
        kind: 'layout',
        ...base,
        layout: node.layout,
        children: node.children.map(normalizeNode),
      };
    case 'slot':
      return { kind: 'slot', ...base, name: node.name, child: normalizeNode(node.child) };
    case 'repeat':
      return {
        kind: 'repeat',
        ...base,
        source: { ...node.source },
        ...(node.exclude === undefined ? {} : { exclude: [...node.exclude].sort() }),
        item: normalizeNode(node.item),
      };
    case 'word':
      return {
        kind: 'word',
        ...base,
        word: node.word,
        bindings: normalizedBindings(node.bindings),
      };
    case 'diagnostic':
      return {
        kind: 'diagnostic',
        ...base,
        code: node.code,
        ...(node.failedNodeId === undefined ? {} : { failedNodeId: node.failedNodeId }),
      };
  }
}

export function normalizeSurfaceTree(surface: SurfaceTree): SurfaceTree {
  return { schemaVersion: SURFACE_SCHEMA_VERSION, root: normalizeNode(surface.root) };
}

export function serializeSurfaceTree(surface: SurfaceTree): string {
  return canonicalJson(normalizeSurfaceTree(surface));
}

/** Stable cross-runtime identity; not a security digest. */
export function hashSurfaceTree(surface: SurfaceTree): string {
  const serialized = serializeSurfaceTree(surface);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}
