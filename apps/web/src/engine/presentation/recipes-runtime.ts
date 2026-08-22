import { createPresentationAgent } from '@ui4a/agent';
import {
  activeDefinitionOf,
  APPLICATION_BUNDLE_SCHEMA,
  type ApplicationBundle,
} from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import { PRESENTATION_SURFACE_CATALOG } from './catalog';
import { createRecipeCoordinator, type RecipeCoordinator } from './recipes';

const coordinatorKey = Symbol.for('ui4a.recipe-coordinator');

interface RecipeRuntimeGlobal {
  [coordinatorKey]?: RecipeCoordinator;
}

function coordinator(): RecipeCoordinator {
  const scope = globalThis as typeof globalThis & RecipeRuntimeGlobal;
  scope[coordinatorKey] ??= createRecipeCoordinator({
    agent: createPresentationAgent(),
    catalog: PRESENTATION_SURFACE_CATALOG,
  });
  return scope[coordinatorKey];
}

function activeBundle(snapshot: EngineSnapshot): ApplicationBundle {
  const flows = Object.keys(snapshot.definitions ?? {}).flatMap((name) => {
    const definition = activeDefinitionOf(snapshot, name);
    return definition === undefined ? [] : [definition];
  });
  const versions = Object.values(snapshot.definitions ?? {}).map((entry) => entry.version);
  return {
    schema: APPLICATION_BUNDLE_SCHEMA,
    bundle: {
      name: 'active-application-definitions',
      version: Math.max(1, ...versions),
    },
    applications: Object.values(snapshot.applications ?? {}),
    capabilities: Object.values(snapshot.capabilities ?? {}),
    flows,
    seed: { rel: 'seed:presentation-empty', detail: { instances: {} } },
  };
}

/** Fire-and-forget by contract: generation never blocks Application activation or Chat. */
export function scheduleRecipesForSnapshot(snapshot: EngineSnapshot): void {
  const scheduled = coordinator().schedule(activeBundle(snapshot));
  void scheduled.completion;
}

export function currentRecipeCoordinator(): RecipeCoordinator {
  return coordinator();
}

export function resetRecipeCoordinatorForTests(): void {
  const scope = globalThis as typeof globalThis & RecipeRuntimeGlobal;
  delete scope[coordinatorKey];
}
