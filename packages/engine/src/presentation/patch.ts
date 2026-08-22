import {
  normalizeSurfaceTree,
  type SurfaceCatalog,
  type SurfaceNode,
  type SurfaceTree,
  validateSurfaceTree,
} from './surface';

export const RENDER_PATCH_SCHEMA_VERSION = 1 as const;
const MAX_PATCH_OPERATIONS = 64;

export interface RevisionRequest {
  sidecarId: string;
  baseVersion: number;
  messageId: string;
  instruction: string;
}

export type RenderDensity = 'compact' | 'comfortable' | 'spacious';
export type RenderPatchOperation =
  | { kind: 'move'; nodeId: string; toParentId: string; toIndex: number }
  | { kind: 'collapse'; nodeId: string; collapsed: boolean }
  | { kind: 'density'; nodeId: string; density: RenderDensity }
  | { kind: 'compatible-word'; nodeId: string; word: string }
  | { kind: 'pin'; retention: 'cache' | 'pinned' };

export interface RenderPatch {
  schemaVersion: typeof RENDER_PATCH_SCHEMA_VERSION;
  sidecarId: string;
  baseVersion: number;
  source: { kind: 'revision'; ref: string } | { kind: 'direct-manipulation'; ref: string };
  operations: RenderPatchOperation[];
}

export interface RenderPatchTarget {
  surface: SurfaceTree;
  collapsedNodeIds: string[];
  densityByNodeId: Record<string, RenderDensity>;
  retention: 'cache' | 'pinned';
}

export type RenderPatchResult =
  | {
      ok: true;
      target: RenderPatchTarget;
      changedPaths: string[];
      inverseOperations: RenderPatchOperation[];
    }
  | {
      ok: false;
      code: 'version-conflict' | 'invalid-operation' | 'catalog-incompatible';
      reason: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field "${key}"`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function version(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error('baseVersion must be a positive integer');
  }
  return value as number;
}

export function parseRevisionRequest(value: unknown): RevisionRequest {
  const input = exactRecord(
    value,
    ['sidecarId', 'baseVersion', 'messageId', 'instruction'],
    'Revision request',
  );
  return {
    sidecarId: text(input.sidecarId, 'sidecarId'),
    baseVersion: version(input.baseVersion),
    messageId: text(input.messageId, 'messageId'),
    instruction: text(input.instruction, 'instruction'),
  };
}

function parseOperation(value: unknown): RenderPatchOperation {
  if (!isRecord(value)) throw new Error('Render patch operation must be an object');
  switch (value.kind) {
    case 'move': {
      const input = exactRecord(
        value,
        ['kind', 'nodeId', 'toParentId', 'toIndex'],
        'move operation',
      );
      if (!Number.isInteger(input.toIndex) || (input.toIndex as number) < 0) {
        throw new Error('move operation toIndex must be a non-negative integer');
      }
      return {
        kind: 'move',
        nodeId: text(input.nodeId, 'move nodeId'),
        toParentId: text(input.toParentId, 'move toParentId'),
        toIndex: input.toIndex as number,
      };
    }
    case 'collapse': {
      const input = exactRecord(value, ['kind', 'nodeId', 'collapsed'], 'collapse operation');
      if (typeof input.collapsed !== 'boolean') throw new Error('collapsed must be boolean');
      return {
        kind: 'collapse',
        nodeId: text(input.nodeId, 'collapse nodeId'),
        collapsed: input.collapsed,
      };
    }
    case 'density': {
      const input = exactRecord(value, ['kind', 'nodeId', 'density'], 'density operation');
      if (!['compact', 'comfortable', 'spacious'].includes(String(input.density))) {
        throw new Error('density is invalid');
      }
      return {
        kind: 'density',
        nodeId: text(input.nodeId, 'density nodeId'),
        density: input.density as RenderDensity,
      };
    }
    case 'compatible-word': {
      const input = exactRecord(value, ['kind', 'nodeId', 'word'], 'compatible-word operation');
      return {
        kind: 'compatible-word',
        nodeId: text(input.nodeId, 'compatible-word nodeId'),
        word: text(input.word, 'compatible word'),
      };
    }
    case 'pin': {
      const input = exactRecord(value, ['kind', 'retention'], 'pin operation');
      if (input.retention !== 'cache' && input.retention !== 'pinned') {
        throw new Error('pin retention is invalid');
      }
      return { kind: 'pin', retention: input.retention };
    }
    default:
      throw new Error(`Render patch operation kind "${String(value.kind)}" is invalid`);
  }
}

function operationKey(operation: RenderPatchOperation): string {
  return operation.kind === 'pin' ? 'pin' : `${operation.kind}:${operation.nodeId}`;
}

function normalizeOperations(value: unknown): RenderPatchOperation[] {
  if (!Array.isArray(value) || value.length > MAX_PATCH_OPERATIONS) {
    throw new Error(`Render patch operations must be an array of at most ${MAX_PATCH_OPERATIONS}`);
  }
  const byKey = new Map<string, RenderPatchOperation>();
  for (const entry of value) {
    const operation = parseOperation(entry);
    byKey.set(operationKey(operation), operation);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, operation]) => operation);
}

function patchOf(
  sidecarId: string,
  baseVersion: number,
  source: RenderPatch['source'],
  operations: unknown,
): RenderPatch {
  return {
    schemaVersion: RENDER_PATCH_SCHEMA_VERSION,
    sidecarId: text(sidecarId, 'sidecarId'),
    baseVersion: version(baseVersion),
    source,
    operations: normalizeOperations(operations),
  };
}

export function normalizeRevisionRenderPatch(
  requestValue: unknown,
  operations: unknown,
): RenderPatch {
  const request = parseRevisionRequest(requestValue);
  return patchOf(
    request.sidecarId,
    request.baseVersion,
    { kind: 'revision', ref: request.messageId },
    operations,
  );
}

export function normalizeDirectRenderPatch(value: unknown): RenderPatch {
  const input = exactRecord(
    value,
    ['sidecarId', 'baseVersion', 'interactionId', 'operations'],
    'Direct render patch',
  );
  return patchOf(
    text(input.sidecarId, 'sidecarId'),
    version(input.baseVersion),
    { kind: 'direct-manipulation', ref: text(input.interactionId, 'interactionId') },
    input.operations,
  );
}

export function createRenderPatchTarget(surface: SurfaceTree): RenderPatchTarget {
  return {
    surface: normalizeSurfaceTree(surface),
    collapsedNodeIds: [],
    densityByNodeId: {},
    retention: 'cache',
  };
}

function childNodes(node: SurfaceNode): SurfaceNode[] {
  if (node.kind === 'layout') return node.children;
  if (node.kind === 'slot') return [node.child];
  if (node.kind === 'repeat') return [node.item];
  return [];
}

function findNode(root: SurfaceNode, id: string): SurfaceNode | undefined {
  if (root.id === id) return root;
  for (const child of childNodes(root)) {
    const found = findNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function layoutParentOf(
  root: SurfaceNode,
  id: string,
): { parent: Extract<SurfaceNode, { kind: 'layout' }>; index: number } | undefined {
  if (root.kind === 'layout') {
    const index = root.children.findIndex((child) => child.id === id);
    if (index >= 0) return { parent: root, index };
  }
  for (const child of childNodes(root)) {
    const found = layoutParentOf(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function wordCompatible(
  node: Extract<SurfaceNode, { kind: 'word' }>,
  word: string,
  catalog: SurfaceCatalog,
): boolean {
  const definition = catalog.words[word];
  if (definition === undefined || !definition.roles.includes(node.role)) return false;
  for (const [name, binding] of Object.entries(node.bindings)) {
    if (!definition.bindings[name]?.sources.includes(binding.kind)) return false;
  }
  return Object.entries(definition.bindings).every(
    ([name, binding]) => binding.required !== true || node.bindings[name] !== undefined,
  );
}

function changedPathsOf(operation: RenderPatchOperation): string[] {
  switch (operation.kind) {
    case 'move':
      return [
        `/surface/nodes/${operation.nodeId}/parent`,
        `/surface/nodes/${operation.toParentId}/children`,
      ];
    case 'collapse':
      return [`/view/collapsed/${operation.nodeId}`];
    case 'density':
      return [`/view/density/${operation.nodeId}`];
    case 'compatible-word':
      return [`/surface/nodes/${operation.nodeId}/word`];
    case 'pin':
      return ['/retention'];
  }
}

export function renderPatchChangedPaths(patch: RenderPatch): string[] {
  return [...new Set(patch.operations.flatMap(changedPathsOf))].sort();
}

function pathsConflict(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function renderPatchesConflict(left: RenderPatch, right: RenderPatch): boolean {
  const rightPaths = renderPatchChangedPaths(right);
  return renderPatchChangedPaths(left).some((leftPath) =>
    rightPaths.some((rightPath) => pathsConflict(leftPath, rightPath)),
  );
}

function failure(
  code: Extract<RenderPatchResult, { ok: false }>['code'],
  reason: string,
): RenderPatchResult {
  return { ok: false, code, reason };
}

export function applyRenderPatch(
  current: RenderPatchTarget,
  patch: RenderPatch,
  catalog: SurfaceCatalog,
  activeVersion: number,
): RenderPatchResult {
  if (patch.baseVersion !== activeVersion) {
    return failure(
      'version-conflict',
      `Render patch baseVersion ${patch.baseVersion} does not match active version ${activeVersion}`,
    );
  }
  const target: RenderPatchTarget = {
    surface: normalizeSurfaceTree(current.surface),
    collapsedNodeIds: [...current.collapsedNodeIds],
    densityByNodeId: { ...current.densityByNodeId },
    retention: current.retention,
  };
  const inverseOperations: RenderPatchOperation[] = [];

  for (const operation of patch.operations) {
    if (operation.kind === 'move') {
      const moving = findNode(target.surface.root, operation.nodeId);
      const source = layoutParentOf(target.surface.root, operation.nodeId);
      const destination = findNode(target.surface.root, operation.toParentId);
      if (
        moving === undefined ||
        source === undefined ||
        destination?.kind !== 'layout' ||
        findNode(moving, operation.toParentId) !== undefined
      ) {
        return failure('invalid-operation', 'move target must be an acyclic layout child');
      }
      const [removed] = source.parent.children.splice(source.index, 1);
      if (removed === undefined || operation.toIndex > destination.children.length) {
        return failure('invalid-operation', 'move index is outside the destination layout');
      }
      destination.children.splice(operation.toIndex, 0, removed);
      inverseOperations.unshift({
        kind: 'move',
        nodeId: operation.nodeId,
        toParentId: source.parent.id,
        toIndex: source.index,
      });
    } else if (operation.kind === 'collapse') {
      if (findNode(target.surface.root, operation.nodeId) === undefined) {
        return failure('invalid-operation', `collapse node "${operation.nodeId}" does not exist`);
      }
      const wasCollapsed = target.collapsedNodeIds.includes(operation.nodeId);
      target.collapsedNodeIds = operation.collapsed
        ? [...new Set([...target.collapsedNodeIds, operation.nodeId])].sort()
        : target.collapsedNodeIds.filter((id) => id !== operation.nodeId);
      inverseOperations.unshift({
        kind: 'collapse',
        nodeId: operation.nodeId,
        collapsed: wasCollapsed,
      });
    } else if (operation.kind === 'density') {
      if (findNode(target.surface.root, operation.nodeId) === undefined) {
        return failure('invalid-operation', `density node "${operation.nodeId}" does not exist`);
      }
      const previous = target.densityByNodeId[operation.nodeId] ?? 'comfortable';
      if (operation.density === 'comfortable') delete target.densityByNodeId[operation.nodeId];
      else target.densityByNodeId[operation.nodeId] = operation.density;
      target.densityByNodeId = Object.fromEntries(
        Object.entries(target.densityByNodeId).sort(([left], [right]) => left.localeCompare(right)),
      );
      inverseOperations.unshift({ kind: 'density', nodeId: operation.nodeId, density: previous });
    } else if (operation.kind === 'compatible-word') {
      const node = findNode(target.surface.root, operation.nodeId);
      if (node?.kind !== 'word' || !wordCompatible(node, operation.word, catalog)) {
        return failure('catalog-incompatible', 'replacement word is not catalog-compatible');
      }
      inverseOperations.unshift({
        kind: 'compatible-word',
        nodeId: operation.nodeId,
        word: node.word,
      });
      node.word = operation.word;
    } else {
      inverseOperations.unshift({ kind: 'pin', retention: target.retention });
      target.retention = operation.retention;
    }
  }

  const validated = validateSurfaceTree(target.surface, catalog);
  if (!validated.valid) {
    return failure(
      'catalog-incompatible',
      validated.issues.map((issue) => issue.message).join('; '),
    );
  }
  target.surface = validated.surface;
  return {
    ok: true,
    target,
    changedPaths: renderPatchChangedPaths(patch),
    inverseOperations,
  };
}
