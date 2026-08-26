import {
  contentVersion,
  dependencyDecision,
  planGenericSurface,
  sidecarKeyFingerprint,
  validateSurfaceTree,
  type SidecarDependency,
  type ApplicationRenderRecipeCandidate,
  type UserSidecarKey,
} from '@ui4a/engine';
import type { PresentationRequest } from '@ui4a/shared';

import { appendEvent, listEvents } from '../../db/events';
import {
  appendSidecarCommand,
  findActiveSidecar,
  loadPresentationSnapshot,
} from '../../db/presentation';
import { PRESENTATION_SURFACE_CATALOG } from './catalog';
import {
  createWebPresentationBroker,
  type AuthorizedRoot,
  type WebPresentationBroker,
} from './broker';
import { getDb, getEngine } from '../service';
import { RENDER_WORDS } from '../../render/registry';
import { semanticHintsOf } from './situation';
import { currentRecipeCoordinator } from './recipes-runtime';
import { selectAndInstantiateRecipe } from './recipe-selection';
import { singleSubjectRecipeContext } from './recipe-context';

const runtimeKey = Symbol.for('ui4a.presentation-broker');

interface PresentationGlobal {
  [runtimeKey]?: WebPresentationBroker;
}

function durableKey(request: PresentationRequest): UserSidecarKey {
  return {
    principal: request.principal,
    policyScope: 'local-demo',
    subject: request.subject,
    intent: request.intent,
    deviceClass: 'any',
  };
}

function currentDependencies(root: AuthorizedRoot): SidecarDependency[] {
  const entity = root.entities[0] as {
    class?: unknown;
    properties?: Record<string, unknown>;
    actions?: unknown;
    links?: unknown;
    entities?: Array<{ properties?: Record<string, unknown> }>;
  };
  const rel = root.rels[0]!;
  const contract = contentVersion({
    class: entity.class,
    presentation: entity.properties?.presentation,
    actions: entity.actions,
    links: entity.links,
  });
  const dependencies: SidecarDependency[] = [
    {
      id: `entity:${rel}`,
      subtreeId: 'root',
      kind: 'entity-contract',
      ref: rel,
      pointers: ['$contract'],
      mode: 'invalidate',
      fingerprint: contract,
      optional: false,
    },
    {
      id: 'catalog:semantic',
      subtreeId: 'root',
      kind: 'catalog',
      ref: PRESENTATION_SURFACE_CATALOG.id,
      pointers: ['$catalog'],
      mode: 'invalidate',
      fingerprint: PRESENTATION_SURFACE_CATALOG.version,
      optional: false,
    },
    {
      id: 'policy:local-demo',
      subtreeId: 'root',
      kind: 'policy',
      ref: 'local-demo',
      pointers: ['$policy'],
      mode: 'invalidate',
      fingerprint: 'local-demo',
      optional: false,
    },
  ];
  if (Array.isArray(entity.entities)) {
    dependencies.push({
      id: `members:${rel}`,
      subtreeId: 'members',
      kind: 'collection-membership',
      ref: rel,
      pointers: ['$entities'],
      mode: 'rehydrate',
      fingerprint: contentVersion(entity.entities.map((member) => member.properties?.rel)),
      optional: false,
    });
  }
  return dependencies;
}

function surfaceUrl(sidecarId: string, request: PresentationRequest): string {
  const reference = `sidecar=${encodeURIComponent(sidecarId)}`;
  return typeof request.subject === 'string'
    ? `/canvas?${reference}&focus=${encodeURIComponent(request.subject)}`
    : `/canvas?${reference}&roots=${encodeURIComponent(request.subject.selection.join(','))}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function hydratePromotedRecipes(): Promise<void> {
  const coordinator = currentRecipeCoordinator();
  for (const event of await listEvents(getDb())) {
    if (event.domain !== 'presentation' || event.kind !== 'render-recipe-promoted') continue;
    const detail = record(event.detail);
    if (typeof detail?.commandId !== 'string' || record(detail.candidate) === undefined) continue;
    try {
      coordinator.promote(
        detail.candidate as unknown as ApplicationRenderRecipeCandidate,
        detail.commandId,
        'human',
      );
    } catch {
      // An invalid durable candidate remains auditable but is never available as a fastpath.
    }
  }
}

async function appendLifecycle(
  kind: 'presentation-requested' | 'presentation-resolved' | 'presentation-failed',
  request: PresentationRequest,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await appendEvent(getDb(), {
      domain: 'presentation',
      kind,
      rel: `presentation:${request.requestId}`,
      principal: request.principal,
      channel: 'presentation',
      detail: {
        eventId: `${request.requestId}:${kind}`,
        requestId: request.requestId,
        ...detail,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
  }
}

/** Process adapter; the Broker store becomes durable/rebuildable in T16 Phase G. */
export function getPresentationBroker(): WebPresentationBroker {
  const scope = globalThis as typeof globalThis & PresentationGlobal;
  if (scope[runtimeKey] !== undefined) return scope[runtimeKey];
  const delegate = createWebPresentationBroker({
    getEntity: async (rel) => (await getEngine(getDb())).getEntity(rel),
    resolve: async (request, situation) => {
      const key = durableKey(request);
      const sidecar = await findActiveSidecar(getDb(), key);
      if (sidecar === undefined) {
        await hydratePromotedRecipes();
        if (typeof request.subject !== 'string') return { kind: 'miss' };
        const recipeContext = singleSubjectRecipeContext(situation);
        if (recipeContext === undefined) return { kind: 'miss' };
        const selected = selectAndInstantiateRecipe(
          Object.values(currentRecipeCoordinator().registry().recipes),
          {
            subjectShape: recipeContext.subjectShape,
            intent: request.intent,
            catalogVersion: PRESENTATION_SURFACE_CATALOG.version,
            slots: recipeContext.slots,
          },
        );
        if (selected === undefined) return { kind: 'miss' };
        const { recipe, surface } = selected;
        const validation = validateSurfaceTree(surface, PRESENTATION_SURFACE_CATALOG);
        if (!validation.valid) return { kind: 'miss' };
        const sidecarId = `sidecar:${sidecarKeyFingerprint(key).replace(/^fnv1a64:/, '')}`;
        const previous = (await loadPresentationSnapshot(getDb())).sidecars[sidecarId];
        const version = {
          surface: validation.surface,
          dependencies: currentDependencies(situation),
          provenance: { kind: 'application-recipe' as const, ref: recipe.id },
          changedPaths: [] as string[],
          recipeRef: { id: recipe.id, version: recipe.version },
        };
        const persisted = await appendSidecarCommand(
          getDb(),
          previous === undefined
            ? {
                kind: 'instantiate',
                eventId: `${request.requestId}:recipe:event`,
                commandId: `${request.requestId}:recipe`,
                sidecarId,
                key,
                version,
              }
            : {
                kind: 'revise',
                eventId: `${request.requestId}:recipe-repair:event`,
                commandId: `${request.requestId}:recipe-repair`,
                sidecarId,
                baseVersion: previous.activeVersion,
                version,
              },
        );
        return {
          kind: 'ready',
          sidecar: { id: sidecarId, version: persisted.aggregate.activeVersion },
          surfaceUrl: surfaceUrl(sidecarId, request),
        };
      }
      const active = sidecar.versions[sidecar.activeVersion]!;
      const validation = validateSurfaceTree(active.surface, PRESENTATION_SURFACE_CATALOG);
      if (!validation.valid) {
        await appendSidecarCommand(getDb(), {
          kind: 'stale',
          eventId: `${request.requestId}:surface-invalid:event`,
          commandId: `${request.requestId}:surface-invalid`,
          sidecarId: sidecar.id,
          activeVersion: sidecar.activeVersion,
          dependencyIds: ['catalog:semantic'],
          reason: 'surface-invalid',
        }).catch(() => undefined);
        return { kind: 'miss' };
      }
      const decision = dependencyDecision(active.dependencies, currentDependencies(situation));
      if (!decision.valid) {
        await appendSidecarCommand(getDb(), {
          kind: 'stale',
          eventId: `${request.requestId}:stale:event`,
          commandId: `${request.requestId}:stale`,
          sidecarId: sidecar.id,
          activeVersion: sidecar.activeVersion,
          dependencyIds: decision.replanned,
          reason: 'dependency-changed',
        }).catch(() => undefined);
        return { kind: 'miss' };
      }
      return {
        kind: 'ready',
        sidecar: { id: sidecar.id, version: sidecar.activeVersion },
        surfaceUrl: surfaceUrl(sidecar.id, request),
      };
    },
    plan: async (request, situation) => {
      if (typeof request.subject !== 'string') throw new Error('selection planning unavailable');
      const entity = situation.entities[0] as Parameters<typeof planGenericSurface>[1];
      const key = durableKey(request);
      const sidecarId = `sidecar:${sidecarKeyFingerprint(key).replace(/^fnv1a64:/, '')}`;
      const surface = planGenericSurface(request.subject, entity, PRESENTATION_SURFACE_CATALOG, {
        entityVersion: currentDependencies(situation)[0]!.fingerprint,
        semanticHints: semanticHintsOf(entity),
        provenanceRef: `request:${request.requestId}`,
      });
      const version = {
        surface,
        dependencies: currentDependencies(situation),
        provenance: { kind: 'generic-fallback' as const, ref: `request:${request.requestId}` },
        changedPaths: [] as string[],
      };
      const previous = (await loadPresentationSnapshot(getDb())).sidecars[sidecarId];
      const persisted = await appendSidecarCommand(
        getDb(),
        previous === undefined
          ? {
              kind: 'instantiate',
              eventId: `${request.requestId}:instantiate:event`,
              commandId: `${request.requestId}:instantiate`,
              sidecarId,
              key,
              version,
            }
          : {
              kind: 'revise',
              eventId: `${request.requestId}:repair:event`,
              commandId: `${request.requestId}:repair`,
              sidecarId,
              baseVersion: previous.activeVersion,
              version,
            },
      );
      return {
        kind: 'ready',
        sidecar: { id: sidecarId, version: persisted.aggregate.activeVersion },
        surfaceUrl: surfaceUrl(sidecarId, request),
      };
    },
  });
  scope[runtimeKey] = {
    async present(request) {
      await appendLifecycle('presentation-requested', request, {
        subject: request.subject,
        intent: request.intent,
        delivery: request.delivery,
        sourceMessageIds: request.sourceMessageIds,
      });
      const receipt = await delegate.present(request);
      await appendLifecycle(
        receipt.status === 'failed' ? 'presentation-failed' : 'presentation-resolved',
        request,
        { receipt },
      );
      return receipt;
    },
  };
  return scope[runtimeKey];
}

export function resetPresentationBrokerForTests(): void {
  const scope = globalThis as typeof globalThis & PresentationGlobal;
  delete scope[runtimeKey];
}

/** Thin live capability summary safe for Chat; schemas and the full catalog stay in Presentation. */
export function getPresentationCapabilities(): { markdownWord: boolean } {
  return { markdownWord: RENDER_WORDS.some((word) => word.name === 'markdown') };
}
