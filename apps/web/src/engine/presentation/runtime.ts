import {
  contentVersion,
  dependencyDecision,
  planGenericSurface,
  sidecarKeyFingerprint,
  validateSurfaceTree,
  type SidecarDependency,
  type ApplicationRenderRecipeCandidate,
  type UserSidecarKey,
  type SurfaceTree,
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
import { getDb } from '../service';
import { RENDER_WORDS } from '../../render/registry';
import { semanticHintsOf } from './situation';
import { currentRecipeCoordinator } from './recipes-runtime';
import { selectAndInstantiateRecipe } from './recipe-selection';
import { singleSubjectRecipeContext } from './recipe-context';
import {
  getAuthorizedPresentationEntity,
  getAuthorizedPresentationResult,
} from './authorized-entity';
import {
  compositionRecipeContext,
  grantedPolicyRef,
  planWorkspaceComposition,
} from './runtime-composition';
import { genericIntentPolicyDependency } from './generic-intent-policy';

const runtimeKey = Symbol.for('ui4a.presentation-broker');

interface PresentationGlobal {
  [runtimeKey]?: WebPresentationBroker;
}

/** D51:durable Sidecar 键回归 principal/subject/intent/device 四元组,无 scope 维度。 */
function durableKey(request: PresentationRequest): UserSidecarKey {
  return {
    principal: request.principal,
    subject: request.subject,
    intent: request.intent,
    deviceClass: 'any',
  };
}

/**
 * 依赖装配(D49-2 锚定):单主体在此手写拼装(id 方案 `entity:<rel>` /
 * `catalog:` / `policy:`),组合主体由内核 `compose.ts` canonical 产出
 * (id 方案 `composition:<id>@<version>:<region>:…`)。两套方案按主体类型
 * 各自同源自洽:plan 时存入 Sidecar 与命中时重算走同一装配,
 * `dependencyDecision` 比对不跨方案。改任何一侧的 id 形状前必须同步另一侧
 * 或统一经内核产出(届时按 GR3 净不增长纪律)。
 */
function currentDependencies(root: AuthorizedRoot): SidecarDependency[] {
  if (root.declaration !== undefined) return planWorkspaceComposition(root).dependencies;
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
  // D51 Phase B:policy 依赖指纹 = 凭证授予集合(排序 join)。授予集合变化即
  // 指纹失效 → 重规划;不再锚定会话 scope 或 'any' 占位。
  const policyRef = grantedPolicyRef(root.grantedApplications);
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
    genericIntentPolicyDependency(),
    {
      id: `policy:${policyRef}`,
      subtreeId: 'root',
      kind: 'policy',
      ref: policyRef,
      pointers: ['$policy'],
      mode: 'invalidate',
      fingerprint: policyRef,
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
  namespace: string,
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
        eventId: `${namespace}:${request.requestId}:${kind}`,
        requestId: request.requestId,
        ...detail,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
  }
}

async function persistSurface(
  request: PresentationRequest,
  key: UserSidecarKey,
  surface: SurfaceTree,
  dependencies: SidecarDependency[],
  provenance: { kind: 'application-recipe' | 'generic-fallback'; ref: string },
  recipeRef?: { id: string; version: number },
) {
  const sidecarId = `sidecar:${sidecarKeyFingerprint(key).replace(/^fnv1a64:/, '')}`;
  const commandNamespace = sidecarKeyFingerprint(key);
  const previous = (await loadPresentationSnapshot(getDb())).sidecars[sidecarId];
  const version = {
    surface,
    dependencies,
    provenance,
    changedPaths: [] as string[],
    ...(recipeRef === undefined ? {} : { recipeRef }),
  };
  const persisted = await appendSidecarCommand(
    getDb(),
    previous === undefined
      ? {
          kind: 'instantiate',
          eventId: `${commandNamespace}:${request.requestId}:instantiate:event`,
          commandId: `${commandNamespace}:${request.requestId}:instantiate`,
          sidecarId,
          key,
          version,
        }
      : {
          kind: 'revise',
          eventId: `${commandNamespace}:${request.requestId}:repair:event`,
          commandId: `${commandNamespace}:${request.requestId}:repair`,
          sidecarId,
          baseVersion: previous.activeVersion,
          version,
        },
  );
  return {
    id: sidecarId,
    version: persisted.aggregate.activeVersion,
    url: surfaceUrl(sidecarId, request),
  };
}

/** Process adapter; the Broker store is durable and rebuildable (db/presentation projection). */
export function getPresentationBroker(): WebPresentationBroker {
  const scope = globalThis as typeof globalThis & PresentationGlobal;
  if (scope[runtimeKey] !== undefined) return scope[runtimeKey];
  const delegate = createWebPresentationBroker({
    getEntity: getAuthorizedPresentationEntity,
    // B1 分类器:getEntity 落空时对 rel 做结构化归因,喂给内核 deny 分流。
    classifyUnauthorized: async (rel, principal, grantedApplications) => {
      const outcome = await getAuthorizedPresentationResult(
        rel,
        principal,
        grantedApplications ?? [],
      );
      return outcome.kind === 'authorized' ? 'subject-unavailable' : outcome.kind;
    },
    resolve: async (request, situation) => {
      const key = durableKey(request);
      const sidecar = await findActiveSidecar(getDb(), key);
      if (sidecar === undefined) {
        await hydratePromotedRecipes();
        if (typeof request.subject !== 'string') return { kind: 'miss' };
        const recipeContext =
          compositionRecipeContext(situation) ?? singleSubjectRecipeContext(situation);
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
        const persisted = await persistSurface(
          request,
          key,
          validation.surface,
          currentDependencies(situation),
          { kind: 'application-recipe', ref: recipe.id },
          { id: recipe.id, version: recipe.version },
        );
        return {
          kind: 'ready',
          sidecar: { id: persisted.id, version: persisted.version },
          surfaceUrl: persisted.url,
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
        ...(situation.regions?.some((region) => region.entity === undefined)
          ? { reasonCode: 'partial-authorization' }
          : {}),
      };
    },
    plan: async (request, situation) => {
      if (typeof request.subject !== 'string') throw new Error('selection planning unavailable');
      const key = durableKey(request);
      const composition =
        situation.declaration === undefined ? undefined : planWorkspaceComposition(situation);
      const entity = situation.entities[0] as Parameters<typeof planGenericSurface>[1];
      const dependencies = composition?.dependencies ?? currentDependencies(situation);
      const surface =
        composition?.surface ??
        planGenericSurface(request.subject, entity, PRESENTATION_SURFACE_CATALOG, {
          entityVersion: dependencies[0]!.fingerprint,
          intent: request.intent,
          semanticHints: semanticHintsOf(entity),
          provenanceRef: `request:${request.requestId}`,
        });
      const persisted = await persistSurface(request, key, surface, dependencies, {
        kind: 'generic-fallback',
        ref: `request:${request.requestId}`,
      });
      return {
        kind: 'ready',
        sidecar: { id: persisted.id, version: persisted.version },
        surfaceUrl: persisted.url,
        ...(composition?.partial ? { reasonCode: 'partial-authorization' } : {}),
      };
    },
  });
  scope[runtimeKey] = {
    async present(request, trustedContext?) {
      // D51:lifecycle 命名空间随无 scope 的新键同源;授予集合原样下传 Broker。
      const lifecycleNamespace = sidecarKeyFingerprint(durableKey(request));
      await appendLifecycle('presentation-requested', request, lifecycleNamespace, {
        subject: request.subject,
        intent: request.intent,
        delivery: request.delivery,
        sourceMessageIds: request.sourceMessageIds,
      });
      const receipt = await delegate.present(request, trustedContext);
      await appendLifecycle(
        receipt.status === 'failed' ? 'presentation-failed' : 'presentation-resolved',
        request,
        lifecycleNamespace,
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
