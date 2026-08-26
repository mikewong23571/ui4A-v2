import {
  composeSurfaceRegions,
  contentVersion,
  planGenericSurface,
  type ApplicationRecipeSlotBinding,
  type CompositionRegionSurfaceInput,
  type SidecarDependency,
  type SurfaceTree,
} from '@ui4a/engine';

import { PRESENTATION_SURFACE_CATALOG } from './catalog';
import type { AuthorizedRegion, AuthorizedRoot } from './broker';
import { singleSubjectRecipeContext } from './recipe-context';
import { selectAndInstantiateRecipe } from './recipe-selection';
import { currentRecipeCoordinator } from './recipes-runtime';
import { semanticHintsOf } from './situation';
import { genericIntentPolicyDependency } from './generic-intent-policy';

function diagnosticSurface(): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'diagnostic',
      id: 'unavailable',
      role: 'diagnostic',
      code: 'region-unavailable',
      dependencies: [],
      provenance: [{ kind: 'validator', ref: 'region-unavailable' }],
    },
  };
}

function contractFingerprint(entity: unknown): string {
  const value = entity as {
    class?: unknown;
    properties?: Record<string, unknown>;
    actions?: unknown;
    links?: unknown;
  };
  return contentVersion({
    class: value.class,
    presentation: value.properties?.presentation,
    actions: value.actions,
    links: value.links,
  });
}

function membershipFingerprint(entity: unknown): string | undefined {
  const members = (entity as { entities?: Array<{ properties?: Record<string, unknown> }> })
    .entities;
  return Array.isArray(members)
    ? contentVersion(members.map((member) => member.properties?.rel))
    : undefined;
}

function regionSlot(region: AuthorizedRegion): ApplicationRecipeSlotBinding {
  if (region.entity === undefined)
    return { name: region.declaration.region, kind: 'entity', subject: '' };
  const context = singleSubjectRecipeContext({
    rels: [region.declaration.source],
    entities: [region.entity],
    policyScope: '',
  });
  if (context === undefined) throw new Error('authorized region has no structural contract shape');
  return { ...context.slots[0]!, name: region.declaration.region };
}

export function compositionRecipeContext(
  root: AuthorizedRoot,
): { subjectShape: string; slots: ApplicationRecipeSlotBinding[] } | undefined {
  if (root.declaration === undefined || root.regions === undefined) return undefined;
  const slots = root.regions.map(regionSlot);
  if (root.regions.some((region) => region.entity === undefined)) return undefined;
  return {
    subjectShape: `composition:${root.declaration.id}@${root.declaration.version}[${slots
      .map((slot) => `${slot.name}:${slot.kind}`)
      .join(',')}]`,
    slots,
  };
}

function planRegion(region: AuthorizedRegion): CompositionRegionSurfaceInput {
  const slot = regionSlot(region);
  if (region.entity === undefined) {
    return {
      region: region.declaration.region,
      source: region.declaration.source,
      sourceKind: slot.kind,
      surface: diagnosticSurface(),
      available: false,
    };
  }
  const context = singleSubjectRecipeContext({
    rels: [region.declaration.source],
    entities: [region.entity],
    policyScope: '',
  })!;
  const selected = selectAndInstantiateRecipe(
    Object.values(currentRecipeCoordinator().registry().recipes),
    {
      subjectShape: context.subjectShape,
      intent: region.declaration.intent,
      catalogVersion: PRESENTATION_SURFACE_CATALOG.version,
      slots: context.slots,
    },
  );
  const fingerprint = contractFingerprint(region.entity);
  const surface =
    selected?.surface ??
    planGenericSurface(
      region.declaration.source,
      region.entity as Parameters<typeof planGenericSurface>[1],
      PRESENTATION_SURFACE_CATALOG,
      {
        entityVersion: fingerprint,
        intent: region.declaration.intent,
        semanticHints: semanticHintsOf(region.entity as Parameters<typeof planGenericSurface>[1]),
        provenanceRef: `composition-region:${region.declaration.region}`,
      },
    );
  return {
    region: region.declaration.region,
    source: region.declaration.source,
    sourceKind: slot.kind,
    surface,
    entityFingerprint: fingerprint,
    ...(slot.kind === 'collection'
      ? { membershipFingerprint: membershipFingerprint(region.entity)! }
      : {}),
  };
}

export function planWorkspaceComposition(root: AuthorizedRoot): {
  surface: SurfaceTree;
  dependencies: SidecarDependency[];
  partial: boolean;
} {
  if (root.declaration === undefined || root.regions === undefined) {
    throw new Error('workspace declaration is unavailable');
  }
  const inputs = root.regions.map(planRegion);
  const planned = composeSurfaceRegions(
    { ...root.declaration, regions: root.declaration.regions.map((region) => ({ ...region })) },
    inputs,
    {
      declarationFingerprint: contentVersion(root.declaration),
      catalog: PRESENTATION_SURFACE_CATALOG,
      catalogFingerprint: PRESENTATION_SURFACE_CATALOG.version,
      policyRef: root.policyScope,
      policyFingerprint: root.policyScope,
    },
  );
  return {
    surface: planned.surface,
    dependencies: [...planned.dependencies, genericIntentPolicyDependency()],
    partial: root.regions.some((region) => region.entity === undefined),
  };
}
