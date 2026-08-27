import type {
  ApplicationRecipeKey,
  ApplicationRenderRecipe,
  RecipeDependency,
  RecipeRegistry,
} from './recipe';
import { resolveRecipe } from './recipe';
import {
  dependencyDecision,
  sidecarKeyFingerprint,
  type DependencyDecision,
  type PresentationSnapshot,
  type SidecarDependency,
  type UserSidecarAggregate,
  type UserSidecarKey,
} from '../sidecar';
import type { SurfaceTree } from '../surface/index';

export type PresentationHitPath =
  'user-pinned' | 'user-cache' | 'promoted-recipe' | 'candidate-recipe' | 'generic' | 'planner';

export interface ResolvedPresentationPlan {
  surface: SurfaceTree;
  dependencies: SidecarDependency[];
}

export interface PresentationFastpathInput {
  key: UserSidecarKey;
  dependencies: SidecarDependency[];
  presentation: PresentationSnapshot;
  registry: RecipeRegistry;
  recipeKey?: ApplicationRecipeKey;
  recipeDependencies?: RecipeDependency[];
}

export interface PresentationFastpathDependencies {
  authorize(key: UserSidecarKey): boolean | Promise<boolean>;
  now(): number;
  instantiateRecipe?(
    recipe: ApplicationRenderRecipe,
  ): Promise<{ surface: SurfaceTree; sidecar?: { id: string; version: number } } | undefined>;
  generic(): Promise<ResolvedPresentationPlan | undefined>;
  plan(): Promise<ResolvedPresentationPlan>;
}

export type PresentationFastpathResult =
  | {
      status: 'ready';
      hitPath: PresentationHitPath;
      sidecar?: { id: string; version: number };
      surface: SurfaceTree;
      dependency: DependencyDecision;
      chatLlmCalls: number;
      presentationLlmCalls: number;
      firstUsableMs: number;
    }
  | {
      status: 'failed';
      hitPath: PresentationHitPath;
      reasonCode: 'authorization-failed' | 'planning-failed';
      dependency: DependencyDecision;
      chatLlmCalls: number;
      presentationLlmCalls: number;
      firstUsableMs: number;
    };

function sameSubject(left: UserSidecarKey['subject'], right: UserSidecarKey['subject']): boolean {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  return (
    left.selection.length === right.selection.length &&
    left.selection.every((rel, index) => rel === right.selection[index])
  );
}

function sameKey(left: UserSidecarKey, right: UserSidecarKey): boolean {
  return (
    left.principal === right.principal &&
    left.intent === right.intent &&
    left.deviceClass === right.deviceClass &&
    sameSubject(left.subject, right.subject)
  );
}

function retentionOf(sidecar: UserSidecarAggregate): 'cache' | 'pinned' {
  return sidecar.versions[sidecar.activeVersion]?.retention ?? 'cache';
}

function sidecarCandidates(
  snapshot: PresentationSnapshot,
  key: UserSidecarKey,
): UserSidecarAggregate[] {
  return (snapshot.sidecarIdsByKey[sidecarKeyFingerprint(key)] ?? [])
    .flatMap((id) => {
      const sidecar = snapshot.sidecars[id];
      return sidecar === undefined || sidecar.stale !== undefined || !sameKey(sidecar.key, key)
        ? []
        : [sidecar];
    })
    .sort((left, right) => {
      const retention =
        Number(retentionOf(right) === 'pinned') - Number(retentionOf(left) === 'pinned');
      return retention !== 0 ? retention : right.activeVersion - left.activeVersion;
    });
}

function exactDependency(dependencies: readonly SidecarDependency[]): DependencyDecision {
  return dependencyDecision(dependencies, dependencies);
}

function elapsed(started: number, now: () => number): number {
  return Math.max(0, now() - started);
}

/** Resolve the first safe presentation without letting a cache/request grant authorization. */
export async function resolvePresentationFastpath(
  input: PresentationFastpathInput,
  dependencies: PresentationFastpathDependencies,
): Promise<PresentationFastpathResult> {
  const started = dependencies.now();
  if ((await dependencies.authorize(input.key)) !== true) {
    return {
      status: 'failed',
      hitPath: 'planner',
      reasonCode: 'authorization-failed',
      dependency: exactDependency(input.dependencies),
      chatLlmCalls: 0,
      presentationLlmCalls: 0,
      firstUsableMs: elapsed(started, dependencies.now),
    };
  }

  let staleDecision: DependencyDecision | undefined;
  for (const sidecar of sidecarCandidates(input.presentation, input.key)) {
    const active = sidecar.versions[sidecar.activeVersion]!;
    const decision = dependencyDecision(active.dependencies, input.dependencies);
    if (!decision.valid) {
      staleDecision ??= decision;
      continue;
    }
    return {
      status: 'ready',
      hitPath: active.retention === 'pinned' ? 'user-pinned' : 'user-cache',
      sidecar: { id: sidecar.id, version: sidecar.activeVersion },
      surface: active.surface,
      dependency: decision,
      chatLlmCalls: 0,
      presentationLlmCalls: 0,
      firstUsableMs: elapsed(started, dependencies.now),
    };
  }

  if (input.recipeKey !== undefined && input.recipeDependencies !== undefined) {
    const recipe = resolveRecipe(input.registry, input.recipeKey, input.recipeDependencies);
    if (recipe !== undefined) {
      const instantiated = await dependencies.instantiateRecipe?.(recipe);
      if (instantiated !== undefined && !JSON.stringify(instantiated.surface).includes('$slot:')) {
        return {
          status: 'ready',
          hitPath: recipe.status === 'promoted' ? 'promoted-recipe' : 'candidate-recipe',
          ...(instantiated.sidecar === undefined ? {} : { sidecar: instantiated.sidecar }),
          surface: instantiated.surface,
          dependency: staleDecision ?? exactDependency(input.dependencies),
          chatLlmCalls: 0,
          presentationLlmCalls: 0,
          firstUsableMs: elapsed(started, dependencies.now),
        };
      }
    }
  }

  const generic = await dependencies.generic();
  if (generic !== undefined) {
    return {
      status: 'ready',
      hitPath: 'generic',
      surface: generic.surface,
      dependency: staleDecision ?? exactDependency(generic.dependencies),
      chatLlmCalls: 0,
      presentationLlmCalls: 0,
      firstUsableMs: elapsed(started, dependencies.now),
    };
  }

  try {
    const planned = await dependencies.plan();
    return {
      status: 'ready',
      hitPath: 'planner',
      surface: planned.surface,
      dependency: staleDecision ?? exactDependency(planned.dependencies),
      chatLlmCalls: 0,
      presentationLlmCalls: 1,
      firstUsableMs: elapsed(started, dependencies.now),
    };
  } catch {
    return {
      status: 'failed',
      hitPath: 'planner',
      reasonCode: 'planning-failed',
      dependency: staleDecision ?? exactDependency(input.dependencies),
      chatLlmCalls: 0,
      presentationLlmCalls: 1,
      firstUsableMs: elapsed(started, dependencies.now),
    };
  }
}
