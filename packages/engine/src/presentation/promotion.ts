import type { ApplicationRenderRecipeCandidate, RecipeDependency } from './recipe/recipe';
import type { PresentationSnapshot, UserSidecarAggregate } from './sidecar';
import type {
  SurfaceBinding,
  SurfaceCatalog,
  SurfaceDependency,
  SurfaceNode,
  SurfaceTree,
} from './surface/index';

export interface SidecarPromotionOptions {
  application: string;
  applicationVersion: string;
  scenario: string;
  subjectShape: string;
  intent: string;
  catalog: SurfaceCatalog;
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

function parameterizeBinding(binding: SurfaceBinding): SurfaceBinding {
  if (binding.kind === 'item') return { ...binding };
  return { ...binding, subject: '$slot:subject' };
}

function parameterizeDependency(dependency: SurfaceDependency): SurfaceDependency {
  return dependency.kind === 'entity'
    ? { ...dependency, subject: '$slot:subject', version: '$runtime' }
    : { ...dependency };
}

function parameterizeNode(node: SurfaceNode): SurfaceNode {
  const base = {
    id: node.id,
    role: node.role,
    dependencies: node.dependencies.map(parameterizeDependency),
    provenance: node.provenance.map((entry) => ({ ...entry })),
  };
  switch (node.kind) {
    case 'layout':
      return {
        kind: 'layout',
        ...base,
        layout: node.layout,
        children: node.children.map(parameterizeNode),
      };
    case 'slot':
      return { kind: 'slot', ...base, name: node.name, child: parameterizeNode(node.child) };
    case 'repeat':
      return {
        kind: 'repeat',
        ...base,
        source: { kind: 'entities', subject: '$slot:subject' },
        item: parameterizeNode(node.item),
      };
    case 'word':
      return {
        kind: 'word',
        ...base,
        word: node.word,
        bindings: Object.fromEntries(
          Object.entries(node.bindings).map(([name, binding]) => [
            name,
            parameterizeBinding(binding),
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

function parameterizeSurface(surface: SurfaceTree): SurfaceTree {
  return { schemaVersion: 1, root: parameterizeNode(surface.root) };
}

/** Strip user/entity identity and produce an unpromoted, mechanically diffable Recipe candidate. */
export function promoteUserSidecarCandidate(
  sidecar: UserSidecarAggregate,
  options: SidecarPromotionOptions,
): SidecarPromotionResult {
  const active = sidecar.versions[sidecar.activeVersion];
  if (active === undefined) throw new Error('Sidecar active provenance is unavailable');
  const candidate: ApplicationRenderRecipeCandidate = {
    key: {
      application: options.application,
      applicationVersion: options.applicationVersion,
      scenario: options.scenario,
      subjectShape: options.subjectShape,
      intent: options.intent,
      catalogVersion: options.catalog.version,
    },
    slots: [{ name: 'subject', kind: 'entity' }],
    surfaceTemplate: parameterizeSurface(active.surface),
    dependencies: options.dependencies.map((dependency) => ({ ...dependency })),
    provenance: { model: 'human-promotion', generatedAt: 'human-approved-candidate' },
  };
  return {
    candidate,
    diff: {
      sidecarId: sidecar.id,
      fromSidecarVersion: sidecar.activeVersion,
      parameterized: true,
      subjectSlots: ['subject'],
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
  return {
    sidecarId,
    version: sidecar.activeVersion,
    subject: sidecar.key.subject,
    intent: sidecar.key.intent,
    retention: active.retention,
    provenance: { ...active.provenance },
    dependencyIds: active.dependencies.map(({ id }) => id),
    staleReason: sidecar.stale?.reason ?? null,
  };
}
