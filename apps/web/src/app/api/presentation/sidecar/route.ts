import { getDb, getEngine } from '../../../../engine/service';
import {
  appendSidecarCommand,
  getSidecarById,
  loadPresentationSnapshot,
} from '@ui4a/db/presentation';
import { appendEvent } from '@ui4a/db/events';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../../../../auth/request-identity';
import {
  applyRenderPatch,
  createRenderPatchTarget,
  explainSidecarPresentation,
  normalizeDirectRenderPatch,
  promoteUserSidecarCandidate,
} from '@ui4a/engine';
import { PRESENTATION_SIDECAR_DENIED } from '@ui4a/shared';
import { PRESENTATION_SURFACE_CATALOG } from '../../../../engine/presentation/catalog';
import { currentRecipeCoordinator } from '../../../../engine/presentation/recipes-runtime';
import { singleSubjectRecipeContext } from '../../../../engine/presentation/recipe-context';
import { resolveBuiltinCompositionSubject } from '../../../../engine/presentation/compositions';
import { getAuthorizedPresentationEntity } from '../../../../engine/presentation/authorized-entity';
import { compositionRecipeContext } from '../../../../engine/presentation/runtime-composition';
import {
  authorizeStoredSidecar,
  hasUnavailableRegion,
  type StoredSidecarDenialReason,
} from '../../../../engine/presentation/sidecar-authorization';

export const dynamic = 'force-dynamic';

const LOCAL_PRESENTATION_PRINCIPAL = 'local-user';

// production profile(T22 验证修复):接入 application credential(Browser Session
// 或 Bearer),并以已认证 principal 作为 Sidecar 归属——durable Sidecar key 以
// principal 区分,固定 local principal 在生产既越权又查不到 chat 建立的 Sidecar。
// local profile 行为不变(固定 user:local)。
// D51:授予集合口径(grantedApplications,identity.grantedApplications 直传),
// stored key 已无 scope 维度;授权 = principal 相等 + sources 按当前集合重审。
interface TrustedPresentationIdentity {
  principal: string;
  grantedApplications: readonly string[];
}

async function presentationIdentity(
  request: Request,
  requiredScopes: string[],
): Promise<TrustedPresentationIdentity | Response> {
  if (requestIdentityProfile() !== 'production') {
    return {
      principal: LOCAL_PRESENTATION_PRINCIPAL,
      grantedApplications: ['local-demo'],
    };
  }
  try {
    const engine = await getEngine(getDb());
    const identity = await resolveTrustedRequestIdentity(request, {
      plane: 'business',
      requiredScopes,
      authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
    });
    return {
      principal: identity.principal,
      grantedApplications: identity.grantedApplications,
    };
  } catch (error) {
    return (
      authenticationErrorResponse(error) ??
      Response.json({ error: { code: 'credential_malformed' } }, { status: 401 })
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const sidecarId = new URL(request.url).searchParams.get('sidecarId');
  if (sidecarId === null || sidecarId === '') {
    return Response.json({ error: 'sidecarId is required' }, { status: 400 });
  }
  const identity = await presentationIdentity(request, ['ui4a:read']);
  if (identity instanceof Response) return identity;
  const sidecar = await getSidecarById(getDb(), sidecarId, identity.principal);
  // D51 §2.3(B3):查不到(他人/不存在)→ 404 存在性隐藏;本人的 stored 工件
  // 命中重审失败 → 结构化 denied,不再伪装成 Not Found。
  if (sidecar === undefined) {
    return Response.json({ error: 'Sidecar not found' }, { status: 404 });
  }
  const decision = await authorizeStoredSidecar(sidecar, identity);
  if (!decision.ok) {
    return Response.json(
      { error: { code: PRESENTATION_SIDECAR_DENIED, detail: decision.reason } },
      { status: 403 },
    );
  }
  if (new URL(request.url).searchParams.get('explain') === '1') {
    try {
      return Response.json({
        explanation: explainSidecarPresentation(await loadPresentationSnapshot(getDb()), sidecarId),
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 422 },
      );
    }
  }
  const active = sidecar.versions[sidecar.activeVersion]!;
  // T35 F-31:同 sidecarId 会话内可变(重规划 bump activeVersion)——禁缓存,
  // 否则浏览器以旧树应答 in-place reload(批准退场卡残留实测根因)。
  return Response.json(
    {
      sidecar: {
        id: sidecar.id,
        version: sidecar.activeVersion,
        key: sidecar.key,
        surface: active.surface,
        view: active.view ?? { collapsedNodeIds: [], densityByNodeId: {} },
        dependencies: active.dependencies,
        retention: active.retention,
        provenance: active.provenance,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => undefined)) as
    | {
        sidecarId?: unknown;
        action?: unknown;
        targetVersion?: unknown;
        actor?: unknown;
        interactionId?: unknown;
        operations?: unknown;
      }
    | undefined;
  if (
    body === undefined ||
    typeof body.sidecarId !== 'string' ||
    body.sidecarId === '' ||
    !['pin', 'revert', 'patch', 'promotion-preview', 'promote'].includes(String(body.action)) ||
    body.actor !== 'human'
  ) {
    return Response.json({ error: 'human Sidecar lifecycle request is invalid' }, { status: 400 });
  }
  const identity = await presentationIdentity(request, ['ui4a:write']);
  if (identity instanceof Response) return identity;
  const current = await getSidecarById(getDb(), body.sidecarId, identity.principal);
  if (
    body.action === 'revert' &&
    (typeof body.targetVersion !== 'number' ||
      !Number.isInteger(body.targetVersion) ||
      body.targetVersion < 1)
  ) {
    return Response.json({ error: 'targetVersion must be a positive integer' }, { status: 400 });
  }
  if (current === undefined) {
    return Response.json({ error: 'Sidecar not found' }, { status: 404 });
  }
  // B3:lifecycle 变更前同样做结构化 denied 分流(本人工件不回 404)。
  const currentDecision = await authorizeStoredSidecar(current, identity);
  let denial: StoredSidecarDenialReason | undefined = currentDecision.ok
    ? undefined
    : currentDecision.reason;
  if (
    denial === undefined &&
    body.action === 'revert' &&
    !(await authorizeStoredSidecar(current, identity, body.targetVersion as number)).ok
  ) {
    denial = 'sources-unreachable';
  }
  if (denial !== undefined) {
    return Response.json(
      { error: { code: PRESENTATION_SIDECAR_DENIED, detail: denial } },
      { status: 403 },
    );
  }
  const principal = identity.principal;

  if (body.action === 'patch') {
    try {
      const active = current.versions[current.activeVersion]!;
      const patch = normalizeDirectRenderPatch({
        sidecarId: current.id,
        baseVersion: current.activeVersion,
        interactionId: body.interactionId,
        operations: body.operations,
      });
      const target = createRenderPatchTarget(active.surface);
      target.collapsedNodeIds = [...(active.view?.collapsedNodeIds ?? [])];
      target.densityByNodeId = { ...(active.view?.densityByNodeId ?? {}) };
      target.retention = active.retention;
      const applied = applyRenderPatch(
        target,
        patch,
        PRESENTATION_SURFACE_CATALOG,
        current.activeVersion,
      );
      if (!applied.ok) return Response.json({ error: applied.reason }, { status: 409 });
      const id = crypto.randomUUID();
      const result = await appendSidecarCommand(getDb(), {
        kind: 'revise',
        eventId: `event:${id}`,
        commandId: `command:${id}`,
        sidecarId: current.id,
        baseVersion: current.activeVersion,
        version: {
          surface: applied.target.surface,
          view: {
            collapsedNodeIds: applied.target.collapsedNodeIds,
            densityByNodeId: applied.target.densityByNodeId,
          },
          dependencies: active.dependencies,
          provenance: { kind: 'human-patch', ref: String(body.interactionId) },
          changedPaths: applied.changedPaths,
          ...(active.recipeRef === undefined ? {} : { recipeRef: active.recipeRef }),
        },
      });
      const next = result.aggregate.versions[result.aggregate.activeVersion]!;
      return Response.json({
        sidecar: {
          id: result.aggregate.id,
          version: result.aggregate.activeVersion,
          retention: next.retention,
          rootNodeId: next.surface.root.id,
          view: next.view ?? { collapsedNodeIds: [], densityByNodeId: {} },
        },
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 409 },
      );
    }
  }

  if (body.action === 'promotion-preview' || body.action === 'promote') {
    try {
      if (hasUnavailableRegion(current.versions[current.activeVersion]!.surface.root)) {
        throw new Error('Partial workspace surfaces cannot be promoted');
      }
      if (typeof current.key.subject !== 'string') {
        throw new Error('Recipe promotion requires a complete ordered slot map');
      }
      const composition = resolveBuiltinCompositionSubject(current.key.subject);
      const recipeContext =
        composition.kind === 'composition'
          ? await (async () => {
              const regions = await Promise.all(
                composition.declaration.regions.map(async (declaration) => ({
                  declaration,
                  entity: await getAuthorizedPresentationEntity(
                    declaration.source,
                    principal,
                    identity.grantedApplications,
                  ),
                })),
              );
              if (regions.some((region) => region.entity === undefined)) {
                throw new Error('Partial workspace surfaces cannot be promoted');
              }
              return compositionRecipeContext({
                rels: regions.map((region) => region.declaration.source),
                entities: regions.map((region) => region.entity),
                declaration: composition.declaration,
                regions,
              });
            })()
          : await (async () => {
              const entity = await getAuthorizedPresentationEntity(
                current.key.subject as string,
                principal,
                identity.grantedApplications,
              );
              return singleSubjectRecipeContext({
                rels: [current.key.subject as string],
                entities: entity === undefined ? [] : [entity],
              });
            })();
      if (recipeContext === undefined) {
        throw new Error('Recipe promotion requires an authorized single-subject contract shape');
      }
      const promoted = promoteUserSidecarCandidate(current, {
        application: 'runtime',
        applicationVersion: '1',
        scenario: 'human-promoted',
        subjectShape: recipeContext.subjectShape,
        intent: current.key.intent,
        catalog: PRESENTATION_SURFACE_CATALOG,
        slots: [...recipeContext.slots],
        dependencies: [
          {
            kind: 'catalog',
            subject: PRESENTATION_SURFACE_CATALOG.id,
            version: PRESENTATION_SURFACE_CATALOG.version,
          },
        ],
      });
      if (body.action === 'promotion-preview') return Response.json({ diff: promoted.diff });
      const id = crypto.randomUUID();
      const recipe = currentRecipeCoordinator().promote(
        promoted.candidate,
        `promotion:${id}`,
        'human',
      );
      await appendEvent(getDb(), {
        domain: 'presentation',
        kind: 'render-recipe-promoted',
        rel: recipe.id,
        principal,
        channel: 'presentation',
        detail: {
          eventId: `event:${id}`,
          sidecarId: current.id,
          sidecarVersion: current.activeVersion,
          recipeId: recipe.id,
          recipeVersion: recipe.version,
          commandId: `promotion:${id}`,
          candidate: promoted.candidate,
          diff: promoted.diff,
        },
      });
      return Response.json({
        recipe: { id: recipe.id, version: recipe.version, status: recipe.status },
        diff: promoted.diff,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 409 },
      );
    }
  }
  const id = crypto.randomUUID();
  const command =
    body.action === 'pin'
      ? {
          kind: 'pin' as const,
          eventId: `event:${id}`,
          commandId: `command:${id}`,
          sidecarId: current.id,
          baseVersion: current.activeVersion,
        }
      : {
          kind: 'revert' as const,
          eventId: `event:${id}`,
          commandId: `command:${id}`,
          sidecarId: current.id,
          activeVersion: current.activeVersion,
          targetVersion: body.targetVersion as number,
        };
  try {
    const result = await appendSidecarCommand(getDb(), command);
    const active = result.aggregate.versions[result.aggregate.activeVersion]!;
    return Response.json({
      sidecar: {
        id: result.aggregate.id,
        version: result.aggregate.activeVersion,
        retention: active.retention,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  }
}
