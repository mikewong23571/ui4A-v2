import type { CompositionDeclaration, CompositionMode } from '@ui4a/shared';

import type { SidecarDependency } from './sidecar';
import { normalizeSurfaceTree } from './surface/normalize';
import type {
  SurfaceCatalog,
  SurfaceDependency,
  SurfaceNode,
  SurfaceProvenance,
  SurfaceTree,
} from './surface/types';
import { validateSurfaceTree } from './surface/validate';

export type CompositionSourceKind = 'entity' | 'collection' | 'flow' | 'selection';

const COMPOSITION_SOURCE_KINDS = new Set<CompositionSourceKind>([
  'entity',
  'collection',
  'flow',
  'selection',
]);

export interface SurfaceRegionAssemblyInput {
  region: string;
  surface: SurfaceTree;
  dependencies?: readonly SurfaceDependency[];
  provenance?: readonly SurfaceProvenance[];
  nodeProvenance?: readonly SurfaceProvenance[];
}

export interface SurfaceRegionAssemblyOptions {
  dependencies?: readonly SurfaceDependency[];
  provenance?: readonly SurfaceProvenance[];
}

export interface CompositionRegionSurfaceInput {
  region: string;
  source: string;
  sourceKind: CompositionSourceKind;
  surface: SurfaceTree;
  entityFingerprint?: string;
  membershipFingerprint?: string;
  available?: boolean;
}

export interface CompositionPlanContext {
  declarationFingerprint: string;
  catalog: SurfaceCatalog;
  catalogFingerprint: string;
  policyRef: string;
  policyFingerprint: string;
}

export interface CompositionPlannedRegion {
  region: string;
  sourceKind: CompositionSourceKind;
  mode: CompositionMode;
}

export interface CompositionPlan {
  surface: SurfaceTree;
  dependencies: SidecarDependency[];
  subjectShape: string;
  regions: CompositionPlannedRegion[];
}

function requiredText(value: string, label: string): void {
  if (value.trim() === '') throw new Error(`${label} must be a non-empty string`);
}

function declarationRef(declaration: CompositionDeclaration): string {
  return `composition:${declaration.id}@${declaration.version}`;
}

function declarationDependency(
  declaration: CompositionDeclaration,
  context: CompositionPlanContext,
): SurfaceDependency {
  return {
    kind: 'definition',
    subject: declarationRef(declaration),
    version: context.declarationFingerprint,
  };
}

function regionProvenance(declaration: CompositionDeclaration, region?: string): SurfaceProvenance {
  return {
    kind: 'composition-declaration',
    ref:
      region === undefined
        ? declarationRef(declaration)
        : `${declarationRef(declaration)}#${region}`,
  };
}

function appendProvenance(
  provenance: readonly SurfaceProvenance[],
  entries: readonly SurfaceProvenance[],
): SurfaceProvenance[] {
  return [
    ...provenance.map((candidate) => ({ ...candidate })),
    ...entries.map((entry) => ({ ...entry })),
  ];
}

function regionSlotId(region: string): string {
  return `region-slot:${region}`;
}

function regionNodeId(region: string, nodeId: string): string {
  return `region-node:${region}:${nodeId}`;
}

function namespaceNode(
  node: SurfaceNode,
  region: string,
  provenance: readonly SurfaceProvenance[],
): SurfaceNode {
  const base = {
    id: regionNodeId(region, node.id),
    role: node.role,
    dependencies: node.dependencies.map((dependency) => ({
      ...dependency,
      ...(dependency.paths === undefined ? {} : { paths: [...dependency.paths] }),
    })),
    provenance: appendProvenance(node.provenance, provenance),
  };

  switch (node.kind) {
    case 'layout':
      return {
        kind: 'layout',
        ...base,
        layout: node.layout,
        children: node.children.map((child) => namespaceNode(child, region, provenance)),
      };
    case 'slot':
      return {
        kind: 'slot',
        ...base,
        name: node.name,
        child: namespaceNode(node.child, region, provenance),
      };
    case 'repeat':
      return {
        kind: 'repeat',
        ...base,
        source: { ...node.source },
        item: namespaceNode(node.item, region, provenance),
      };
    case 'word':
      return {
        kind: 'word',
        ...base,
        word: node.word,
        bindings: Object.fromEntries(
          Object.entries(node.bindings).map(([name, binding]) => [name, { ...binding }]),
        ),
      };
    case 'diagnostic':
      return {
        kind: 'diagnostic',
        ...base,
        code: node.code,
        ...(node.failedNodeId === undefined
          ? {}
          : { failedNodeId: regionNodeId(region, node.failedNodeId) }),
      };
  }
}

function cloneDependencies(dependencies: readonly SurfaceDependency[] = []): SurfaceDependency[] {
  return dependencies.map((dependency) => ({
    ...dependency,
    ...(dependency.paths === undefined ? {} : { paths: [...dependency.paths] }),
  }));
}

function cloneProvenance(provenance: readonly SurfaceProvenance[] = []): SurfaceProvenance[] {
  return provenance.map((entry) => ({ ...entry }));
}

/**
 * Assemble planned subtrees through the canonical layout/region-slot machine.
 * Callers own region ordering; node ids are deterministically namespaced by region.
 */
export function assembleSurfaceRegions(
  regions: readonly SurfaceRegionAssemblyInput[],
  options: SurfaceRegionAssemblyOptions = {},
): SurfaceTree {
  if (regions.length === 0) throw new Error('Surface regions must not be empty');
  const seen = new Set<string>();
  const children = regions.map((region) => {
    requiredText(region.region, 'Surface region name');
    if (seen.has(region.region)) throw new Error(`Surface region "${region.region}" is duplicated`);
    seen.add(region.region);
    return {
      kind: 'slot' as const,
      id: regionSlotId(region.region),
      role: 'primary-content' as const,
      name: region.region,
      child: namespaceNode(region.surface.root, region.region, region.nodeProvenance ?? []),
      dependencies: cloneDependencies(region.dependencies),
      provenance: cloneProvenance(region.provenance),
    };
  });

  return normalizeSurfaceTree({
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      children,
      dependencies: cloneDependencies(options.dependencies),
      provenance: cloneProvenance(options.provenance),
    },
  });
}

function dependency(
  id: string,
  subtreeId: string,
  kind: SidecarDependency['kind'],
  ref: string,
  pointers: string[],
  mode: SidecarDependency['mode'],
  fingerprint: string,
): SidecarDependency {
  return { id, subtreeId, kind, ref, pointers, mode, fingerprint, optional: false };
}

function stableUniqueDependencies(dependencies: readonly SidecarDependency[]): SidecarDependency[] {
  const seen = new Set<string>();
  return dependencies.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function dependenciesForRegion(
  declaration: CompositionDeclaration,
  input: CompositionRegionSurfaceInput,
): SidecarDependency[] {
  if (input.available === false) return [];
  const subtreeId = regionSlotId(input.region);
  const prefix = `${declarationRef(declaration)}:${input.region}`;
  const dependencies = [
    dependency(
      `${prefix}:entity-contract`,
      subtreeId,
      'entity-contract',
      input.source,
      ['$contract'],
      'invalidate',
      input.entityFingerprint!,
    ),
  ];
  if (input.sourceKind === 'collection') {
    dependencies.push(
      dependency(
        `${prefix}:collection-membership`,
        subtreeId,
        'collection-membership',
        input.source,
        ['$entities'],
        'rehydrate',
        input.membershipFingerprint!,
      ),
    );
  }
  return dependencies;
}

function validateContext(context: CompositionPlanContext): void {
  requiredText(context.declarationFingerprint, 'Composition declaration fingerprint');
  requiredText(context.catalogFingerprint, 'Composition catalog fingerprint');
  requiredText(context.policyRef, 'Composition policy reference');
  requiredText(context.policyFingerprint, 'Composition policy fingerprint');
}

/**
 * Assemble already-planned region surfaces into one canonical binding-only Surface Tree.
 * This function performs no entity lookup, authorization, I/O or environment access.
 */
export function composeSurfaceRegions(
  declaration: CompositionDeclaration,
  inputs: readonly CompositionRegionSurfaceInput[],
  context: CompositionPlanContext,
): CompositionPlan {
  validateContext(context);
  const declarationsByRegion = new Map(
    declaration.regions.map((region) => [region.region, region]),
  );
  const inputsByRegion = new Map<string, CompositionRegionSurfaceInput>();

  for (const input of inputs) {
    if (!declarationsByRegion.has(input.region)) {
      throw new Error(`Composition region input "${input.region}" is unknown`);
    }
    if (inputsByRegion.has(input.region)) {
      throw new Error(`Composition region input "${input.region}" is duplicated`);
    }
    if (!COMPOSITION_SOURCE_KINDS.has(input.sourceKind)) {
      throw new Error(`Composition region input "${input.region}" source kind is invalid`);
    }
    if (input.available !== false) {
      requiredText(
        input.entityFingerprint ?? '',
        `Composition region input "${input.region}" fingerprint`,
      );
    }
    if (input.sourceKind === 'collection' && input.membershipFingerprint === undefined) {
      if (input.available !== false) {
        throw new Error(
          `Composition region input "${input.region}" requires membership fingerprint`,
        );
      }
    }
    if (input.membershipFingerprint !== undefined) {
      requiredText(
        input.membershipFingerprint,
        `Composition region input "${input.region}" membership fingerprint`,
      );
    }
    inputsByRegion.set(input.region, input);
  }

  const definitionDependency = declarationDependency(declaration, context);
  const sidecarDependencies: SidecarDependency[] = [];
  const plannedRegions: CompositionPlannedRegion[] = [];
  const assemblyRegions = declaration.regions.map((region) => {
    const input = inputsByRegion.get(region.region);
    if (input === undefined) {
      throw new Error(`Composition region input "${region.region}" is missing`);
    }
    if (input.source !== region.source) {
      throw new Error(
        `Composition region input "${region.region}" source does not match declaration`,
      );
    }
    if (input.sourceKind !== 'collection' && input.membershipFingerprint !== undefined) {
      throw new Error(`Composition region input "${region.region}" membership is not a collection`);
    }
    const validation = validateSurfaceTree(input.surface, context.catalog);
    if (!validation.valid) {
      throw new Error(`Composition region input "${region.region}" surface is invalid`);
    }

    const provenance = regionProvenance(declaration, region.region);
    sidecarDependencies.push(...dependenciesForRegion(declaration, input));
    plannedRegions.push({ region: region.region, sourceKind: input.sourceKind, mode: region.mode });
    return {
      region: region.region,
      surface: validation.surface,
      dependencies: [definitionDependency],
      provenance: [provenance],
      nodeProvenance: [provenance],
    };
  });

  const surface = assembleSurfaceRegions(assemblyRegions, {
    dependencies: [definitionDependency],
    provenance: [regionProvenance(declaration)],
  });
  const assembledValidation = validateSurfaceTree(surface, context.catalog);
  if (!assembledValidation.valid) {
    throw new Error('Composed Surface Tree is invalid');
  }

  sidecarDependencies.push(
    dependency(
      `${declarationRef(declaration)}:definition`,
      'root',
      'definition',
      declarationRef(declaration),
      ['$definition'],
      'invalidate',
      context.declarationFingerprint,
    ),
    dependency(
      `${declarationRef(declaration)}:catalog`,
      'root',
      'catalog',
      context.catalog.id,
      ['$catalog'],
      'invalidate',
      context.catalogFingerprint,
    ),
    dependency(
      `${declarationRef(declaration)}:policy`,
      'root',
      'policy',
      context.policyRef,
      ['$policy'],
      'invalidate',
      context.policyFingerprint,
    ),
  );

  return {
    surface: assembledValidation.surface,
    dependencies: stableUniqueDependencies(sidecarDependencies),
    subjectShape: `${declarationRef(declaration)}[${plannedRegions
      .map(({ region, sourceKind }) => `${region}:${sourceKind}`)
      .join(',')}]`,
    regions: plannedRegions,
  };
}
