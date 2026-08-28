import { isCompositionRegionId, parseCompositionId } from '@ui4a/shared';

import type {
  ApplicationRecipeSlot,
  ApplicationRenderRecipeCandidate,
  RecipeDependency,
} from './recipe';
import type { PresentationSnapshot, UserSidecarAggregate } from '../sidecar/sidecar';
import type {
  SurfaceBinding,
  SurfaceCatalog,
  SurfaceDependency,
  SurfaceNode,
  SurfaceTree,
} from '../surface/index';

export interface SidecarPromotionOptions {
  application: string;
  applicationVersion: string;
  scenario: string;
  subjectShape: string;
  intent: string;
  catalog: SurfaceCatalog;
  slots: Array<ApplicationRecipeSlot & { subject: string }>;
  dependencies: RecipeDependency[];
}

export interface SidecarPromotionResult {
  candidate: ApplicationRenderRecipeCandidate;
  diff: {
    sidecarId: string;
    fromSidecarVersion: number;
    parameterized: true;
    subjectSlots: string[];
  };
}

function parameterizedSubject(
  subject: string,
  slotsBySubject: ReadonlyMap<string, string>,
): string {
  const slot = slotsBySubject.get(subject);
  if (slot === undefined) throw new Error(`Surface subject "${subject}" has no mapped Recipe slot`);
  return `$slot:${slot}`;
}

function parameterizeBinding(
  binding: SurfaceBinding,
  slotsBySubject: ReadonlyMap<string, string>,
): SurfaceBinding {
  if (binding.kind === 'item') return { ...binding };
  return { ...binding, subject: parameterizedSubject(binding.subject, slotsBySubject) };
}

function parameterizeDependency(
  dependency: SurfaceDependency,
  slotsBySubject: ReadonlyMap<string, string>,
): SurfaceDependency {
  if (dependency.kind !== 'entity' && dependency.subject.startsWith('$slot:')) {
    throw new Error('Surface dependency contains an unresolved Recipe slot subject');
  }
  return dependency.kind === 'entity'
    ? {
        ...dependency,
        subject: parameterizedSubject(dependency.subject, slotsBySubject),
        version: '$runtime',
      }
    : { ...dependency };
}

function parameterizeNode(
  node: SurfaceNode,
  slotsBySubject: ReadonlyMap<string, string>,
): SurfaceNode {
  const base = {
    id: node.id,
    role: node.role,
    dependencies: node.dependencies.map((dependency) =>
      parameterizeDependency(dependency, slotsBySubject),
    ),
    provenance: node.provenance.map((entry) => ({ ...entry })),
  };
  switch (node.kind) {
    case 'layout':
      return {
        kind: 'layout',
        ...base,
        layout: node.layout,
        children: node.children.map((child) => parameterizeNode(child, slotsBySubject)),
      };
    case 'slot':
      return {
        kind: 'slot',
        ...base,
        name: node.name,
        child: parameterizeNode(node.child, slotsBySubject),
      };
    case 'repeat':
      return {
        kind: 'repeat',
        ...base,
        source: {
          kind: 'entities',
          subject: parameterizedSubject(node.source.subject, slotsBySubject),
        },
        item: parameterizeNode(node.item, slotsBySubject),
      };
    case 'word':
      return {
        kind: 'word',
        ...base,
        word: node.word,
        bindings: Object.fromEntries(
          Object.entries(node.bindings).map(([name, binding]) => [
            name,
            parameterizeBinding(binding, slotsBySubject),
          ]),
        ),
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

function parameterizeSurface(
  surface: SurfaceTree,
  slots: ReadonlyArray<ApplicationRecipeSlot & { subject: string }>,
): SurfaceTree {
  if (surface.root.kind !== 'layout') {
    throw new Error('Surface root must be a canonical layout of Recipe region slots');
  }
  const rootDependencies = surface.root.dependencies.map((dependency) =>
    parameterizeDependency(dependency, new Map()),
  );
  return {
    schemaVersion: 1,
    root: {
      ...surface.root,
      dependencies: rootDependencies,
      provenance: surface.root.provenance.map((entry) => ({ ...entry })),
      children: surface.root.children.map((child, index) => {
        const slot = slots[index]!;
        return parameterizeNode(child, new Map([[slot.subject, slot.name]]));
      }),
    },
  };
}

function promotionSlots(options: SidecarPromotionOptions, surface: SurfaceTree) {
  if (options.slots.length === 0) throw new Error('Recipe promotion slots must not be empty');
  const names = new Set<string>();
  for (const slot of options.slots) {
    if (
      !isCompositionRegionId(slot.name) ||
      !['entity', 'collection', 'flow', 'selection'].includes(slot.kind) ||
      slot.subject.trim() === '' ||
      slot.subject.startsWith('$slot:') ||
      names.has(slot.name)
    ) {
      throw new Error('Recipe promotion contains an invalid or duplicate slot name');
    }
    names.add(slot.name);
  }
  if (
    surface.root.kind !== 'layout' ||
    surface.root.children.some((child) => child.kind !== 'slot')
  ) {
    throw new Error('Surface root must be a canonical layout of Recipe region slots');
  }
  const surfaceNames = surface.root.children.map((child) =>
    child.kind === 'slot' ? child.name : '',
  );
  if (
    surfaceNames.length !== options.slots.length ||
    surfaceNames.some((name, index) => name !== options.slots[index]?.name)
  ) {
    throw new Error('Surface slot shape does not match Recipe promotion slots');
  }
  return options.slots;
}

/** Strip user/entity identity and produce an unpromoted, mechanically diffable Recipe candidate. */
export function promoteUserSidecarCandidate(
  sidecar: UserSidecarAggregate,
  options: SidecarPromotionOptions,
): SidecarPromotionResult {
  const active = sidecar.versions[sidecar.activeVersion];
  if (active === undefined) throw new Error('Sidecar active provenance is unavailable');
  const slots = promotionSlots(options, active.surface);
  const candidate: ApplicationRenderRecipeCandidate = {
    key: {
      application: options.application,
      applicationVersion: options.applicationVersion,
      scenario: options.scenario,
      subjectShape: options.subjectShape,
      intent: options.intent,
      catalogVersion: options.catalog.version,
    },
    slots: options.slots.map(({ name, kind }) => ({ name, kind })),
    surfaceTemplate: parameterizeSurface(active.surface, slots),
    dependencies: options.dependencies.map((dependency) => ({ ...dependency })),
    provenance: { model: 'human-promotion', generatedAt: 'human-approved-candidate' },
  };
  return {
    candidate,
    diff: {
      sidecarId: sidecar.id,
      fromSidecarVersion: sidecar.activeVersion,
      parameterized: true,
      subjectSlots: options.slots.map(({ name }) => name),
    },
  };
}

export interface SidecarPresentationExplanation {
  sidecarId: string;
  version: number;
  subject: UserSidecarAggregate['key']['subject'];
  intent: string;
  retention: 'cache' | 'pinned';
  provenance: UserSidecarAggregate['versions'][number]['provenance'];
  dependencyIds: string[];
  staleReason: string | null;
  composition?: {
    id: string;
    version: string;
    regions: Array<{
      region: string;
      availability: 'available' | 'unavailable';
      diagnosticCode?: 'region-unavailable';
    }>;
    declarationProvenance: {
      kind: 'composition-declaration';
      ref: string;
    };
  };
}

function explainComposition(
  active: UserSidecarAggregate['versions'][number],
): SidecarPresentationExplanation['composition'] {
  if (active.surface.root.kind !== 'layout') return undefined;
  const declaration = active.surface.root.provenance.flatMap((entry) => {
    if (entry.kind !== 'composition-declaration' || !entry.ref.startsWith('composition:')) {
      return [];
    }
    const identity = entry.ref.slice('composition:'.length);
    const separator = identity.indexOf('@');
    if (separator < 1) return [];
    const id = identity.slice(0, separator);
    const version = identity.slice(separator + 1);
    if (version === '') return [];
    try {
      return [{ id: parseCompositionId(id), version, provenance: entry }];
    } catch {
      return [];
    }
  })[0];
  if (
    declaration === undefined ||
    active.surface.root.children.some((node) => node.kind !== 'slot')
  ) {
    return undefined;
  }
  return {
    id: declaration.id,
    version: declaration.version,
    regions: active.surface.root.children.map((node) => {
      if (node.kind !== 'slot') throw new Error('Composition region slot is unavailable');
      return node.child.kind === 'diagnostic' && node.child.code === 'region-unavailable'
        ? {
            region: node.name,
            availability: 'unavailable' as const,
            diagnosticCode: 'region-unavailable' as const,
          }
        : { region: node.name, availability: 'available' as const };
    }),
    declarationProvenance: {
      ...declaration.provenance,
      kind: 'composition-declaration',
    },
  };
}

export function explainSidecarPresentation(
  snapshot: PresentationSnapshot,
  sidecarId: string,
): SidecarPresentationExplanation {
  const sidecar = snapshot.sidecars[sidecarId];
  const active = sidecar?.versions[sidecar.activeVersion];
  if (sidecar === undefined || active === undefined || active.provenance.ref === '') {
    throw new Error('Presentation provenance is unavailable');
  }
  const composition = explainComposition(active);
  return {
    sidecarId,
    version: sidecar.activeVersion,
    subject: sidecar.key.subject,
    intent: sidecar.key.intent,
    retention: active.retention,
    provenance: { ...active.provenance },
    dependencyIds: active.dependencies.map(({ id }) => id),
    staleReason: sidecar.stale?.reason ?? null,
    ...(composition === undefined ? {} : { composition }),
  };
}
