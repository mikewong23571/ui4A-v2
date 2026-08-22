import type { SurfaceCatalog, SurfaceTree } from './surface';
import { validateSurfaceTree } from './surface';

export interface ApplicationRecipeKey {
  application: string;
  applicationVersion: string;
  scenario: string;
  subjectShape: string;
  intent: string;
  catalogVersion: string;
}

export interface ApplicationRecipeSlot {
  name: string;
  kind: 'entity' | 'collection' | 'flow' | 'selection';
}

export interface RecipeDependency {
  kind: 'definition' | 'catalog';
  subject: string;
  version: string;
  paths?: string[];
}

export interface ApplicationRenderRecipeCandidate {
  key: ApplicationRecipeKey;
  slots: ApplicationRecipeSlot[];
  surfaceTemplate: SurfaceTree;
  dependencies: RecipeDependency[];
  provenance: { model: string; generatedAt: string };
}

export interface ApplicationRenderRecipe extends ApplicationRenderRecipeCandidate {
  id: string;
  version: number;
  status: 'candidate' | 'promoted' | 'stale';
}

export interface RecipeValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RecipeRegistry {
  recipes: Record<string, ApplicationRenderRecipe>;
  recipeIdsByKey: Record<string, string[]>;
  activePromotedByKey: Record<string, string>;
  generationCommands: Record<string, string>;
}

export interface RecipeDependencyChange {
  kind: RecipeDependency['kind'];
  subject: string;
  version: string;
  compatible: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function deterministicRecipeKey(key: ApplicationRecipeKey): string {
  return `recipe:${fnv1a64(canonicalJson(key))}`;
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replaceAll(/[-_]/g, '');
    return (
      normalized === 'principal' ||
      normalized === 'session' ||
      normalized === 'sessionid' ||
      normalized === 'livevalue' ||
      hasForbiddenKey(child)
    );
  });
}

function collectSurfaceSubjects(node: SurfaceTree['root'], subjects: string[]): void {
  for (const dependency of node.dependencies) {
    if (dependency.kind === 'entity') subjects.push(dependency.subject);
  }
  if (node.kind === 'word') {
    for (const binding of Object.values(node.bindings)) {
      if (binding.kind !== 'item') subjects.push(binding.subject);
    }
  } else if (node.kind === 'repeat') {
    subjects.push(node.source.subject);
    collectSurfaceSubjects(node.item, subjects);
  } else if (node.kind === 'layout') {
    node.children.forEach((child) => collectSurfaceSubjects(child, subjects));
  } else if (node.kind === 'slot') {
    collectSurfaceSubjects(node.child, subjects);
  }
}

function validateKey(value: unknown, errors: string[]): value is ApplicationRecipeKey {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'application',
      'applicationVersion',
      'scenario',
      'subjectShape',
      'intent',
      'catalogVersion',
    ]) ||
    !Object.values(value).every(nonEmpty)
  ) {
    errors.push('recipe key is invalid');
    return false;
  }
  return true;
}

export function validateRecipeCandidate(
  value: unknown,
  catalog: SurfaceCatalog,
): RecipeValidationResult {
  const errors: string[] = [];
  if (
    !isRecord(value) ||
    !exactKeys(value, ['key', 'slots', 'surfaceTemplate', 'dependencies', 'provenance'])
  ) {
    return { valid: false, errors: ['recipe candidate envelope is invalid'] };
  }
  if (hasForbiddenKey(value)) errors.push('recipe contains forbidden identity or factual fields');
  validateKey(value.key, errors);

  const slotNames = new Set<string>();
  if (!Array.isArray(value.slots) || value.slots.length === 0) {
    errors.push('recipe slots must be non-empty');
  } else {
    for (const slot of value.slots) {
      if (
        !isRecord(slot) ||
        !exactKeys(slot, ['name', 'kind']) ||
        !nonEmpty(slot.name) ||
        !['entity', 'collection', 'flow', 'selection'].includes(String(slot.kind)) ||
        slotNames.has(String(slot.name))
      ) {
        errors.push('recipe slot is invalid or duplicate');
      } else {
        slotNames.add(slot.name);
      }
    }
  }

  const surfaceResult = validateSurfaceTree(value.surfaceTemplate, catalog);
  if (!surfaceResult.valid) errors.push(...surfaceResult.issues.map((issue) => issue.message));
  const subjects: string[] = [];
  collectSurfaceSubjects(surfaceResult.surface.root, subjects);
  for (const subject of subjects) {
    const slot = /^\$slot:([a-zA-Z0-9_.-]+)$/.exec(subject)?.[1];
    if (slot === undefined || !slotNames.has(slot)) {
      errors.push(`surface subject "${subject}" is not a declared slot`);
    }
  }

  if (!Array.isArray(value.dependencies) || value.dependencies.length === 0) {
    errors.push('recipe dependencies must be non-empty');
  } else {
    for (const dependency of value.dependencies) {
      if (
        !isRecord(dependency) ||
        !exactKeys(dependency, ['kind', 'subject', 'version', 'paths']) ||
        (dependency.kind !== 'definition' && dependency.kind !== 'catalog') ||
        !nonEmpty(dependency.subject) ||
        !nonEmpty(dependency.version)
      ) {
        errors.push('recipe dependency is invalid');
      }
    }
    if (
      !value.dependencies.some(
        (dependency) =>
          isRecord(dependency) &&
          dependency.kind === 'catalog' &&
          dependency.subject === catalog.id &&
          dependency.version === catalog.version,
      )
    ) {
      errors.push('recipe catalog dependency is missing or stale');
    }
  }

  if (
    !isRecord(value.provenance) ||
    !exactKeys(value.provenance, ['model', 'generatedAt']) ||
    !nonEmpty(value.provenance.model) ||
    !nonEmpty(value.provenance.generatedAt)
  ) {
    errors.push('recipe provenance is invalid');
  }
  return { valid: errors.length === 0, errors };
}

export function createRecipeRegistry(): RecipeRegistry {
  return {
    recipes: {},
    recipeIdsByKey: {},
    activePromotedByKey: {},
    generationCommands: {},
  };
}

export function registerRecipeCandidate(
  registry: RecipeRegistry,
  candidate: ApplicationRenderRecipeCandidate,
  catalog: SurfaceCatalog,
  commandId: string,
): { registry: RecipeRegistry; recipe: ApplicationRenderRecipe } {
  const priorId = registry.generationCommands[commandId];
  if (priorId !== undefined) return { registry, recipe: registry.recipes[priorId]! };
  const validation = validateRecipeCandidate(candidate, catalog);
  if (!validation.valid)
    throw new Error(`recipe candidate invalid: ${validation.errors.join('; ')}`);
  const key = deterministicRecipeKey(candidate.key);
  const priorIds = registry.recipeIdsByKey[key] ?? [];
  const version = priorIds.length + 1;
  const id = `${key}@${version}`;
  const recipe: ApplicationRenderRecipe = {
    ...candidate,
    slots: candidate.slots.map((slot) => ({ ...slot })),
    dependencies: candidate.dependencies.map((dependency) => ({ ...dependency })),
    id,
    version,
    status: 'candidate',
  };
  return {
    recipe,
    registry: {
      recipes: { ...registry.recipes, [id]: recipe },
      recipeIdsByKey: { ...registry.recipeIdsByKey, [key]: [...priorIds, id] },
      activePromotedByKey: { ...registry.activePromotedByKey },
      generationCommands: { ...registry.generationCommands, [commandId]: id },
    },
  };
}

export function promoteRecipe(
  registry: RecipeRegistry,
  recipeId: string,
  actor: 'human' | 'agent',
): RecipeRegistry {
  if (actor !== 'human') throw new Error('recipe promotion requires human approval');
  const recipe = registry.recipes[recipeId];
  if (recipe === undefined || recipe.status === 'stale') throw new Error('recipe not promotable');
  const key = deterministicRecipeKey(recipe.key);
  return {
    ...registry,
    recipes: { ...registry.recipes, [recipeId]: { ...recipe, status: 'promoted' } },
    activePromotedByKey: { ...registry.activePromotedByKey, [key]: recipeId },
  };
}

function dependenciesMatch(
  recipe: ApplicationRenderRecipe,
  current: readonly RecipeDependency[],
): boolean {
  const currentByKey = new Map(
    current.map((dependency) => [
      `${dependency.kind}\u0000${dependency.subject}`,
      dependency.version,
    ]),
  );
  return recipe.dependencies.every(
    (dependency) =>
      currentByKey.get(`${dependency.kind}\u0000${dependency.subject}`) === dependency.version,
  );
}

export function resolveRecipe(
  registry: RecipeRegistry,
  key: ApplicationRecipeKey,
  currentDependencies: readonly RecipeDependency[],
): ApplicationRenderRecipe | undefined {
  const fingerprint = deterministicRecipeKey(key);
  const preferredId = registry.activePromotedByKey[fingerprint];
  const candidates = [
    ...(preferredId === undefined ? [] : [preferredId]),
    ...(registry.recipeIdsByKey[fingerprint] ?? []).slice().reverse(),
  ];
  for (const id of [...new Set(candidates)]) {
    const recipe = registry.recipes[id];
    if (
      recipe !== undefined &&
      recipe.status !== 'stale' &&
      dependenciesMatch(recipe, currentDependencies)
    ) {
      return recipe;
    }
  }
  return undefined;
}

export function staleRecipesByDependencies(
  registry: RecipeRegistry,
  changes: readonly RecipeDependencyChange[],
): RecipeRegistry {
  const incompatible = changes.filter((change) => !change.compatible);
  if (incompatible.length === 0) return registry;
  const recipes = Object.fromEntries(
    Object.entries(registry.recipes).map(([id, recipe]) => {
      const stale = recipe.dependencies.some((dependency) =>
        incompatible.some(
          (change) =>
            change.kind === dependency.kind &&
            change.subject === dependency.subject &&
            change.version !== dependency.version,
        ),
      );
      return [id, stale ? { ...recipe, status: 'stale' as const } : recipe];
    }),
  );
  const activePromotedByKey = Object.fromEntries(
    Object.entries(registry.activePromotedByKey).filter(
      ([, id]) => recipes[id]?.status !== 'stale',
    ),
  );
  return { ...registry, recipes, activePromotedByKey };
}

export function rollbackRecipePromotion(
  registry: RecipeRegistry,
  key: ApplicationRecipeKey,
  targetVersion: number,
  actor: 'human' | 'agent',
): RecipeRegistry {
  if (actor !== 'human') throw new Error('recipe rollback requires human approval');
  const fingerprint = deterministicRecipeKey(key);
  const targetId = (registry.recipeIdsByKey[fingerprint] ?? []).find(
    (id) => registry.recipes[id]?.version === targetVersion,
  );
  if (targetId === undefined || registry.recipes[targetId]?.status === 'stale') {
    throw new Error('recipe rollback target unavailable');
  }
  return {
    ...registry,
    activePromotedByKey: { ...registry.activePromotedByKey, [fingerprint]: targetId },
  };
}
