import type { SurfaceCatalog, SurfaceTree } from '../surface/index';
import { validateSurfaceTree } from '../surface/index';

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

export interface ApplicationRecipeSlotBinding extends ApplicationRecipeSlot {
  subject: string;
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
  if (JSON.stringify(surfaceResult.surface).includes('$slot:')) {
    const invalidDependency = (() => {
      const visit = (node: SurfaceTree['root']): boolean => {
        if (
          node.dependencies.some(
            (dependency) => dependency.kind !== 'entity' && dependency.subject.startsWith('$slot:'),
          )
        ) {
          return true;
        }
        if (node.kind === 'layout') return node.children.some(visit);
        if (node.kind === 'slot') return visit(node.child);
        if (node.kind === 'repeat') return visit(node.item);
        return false;
      };
      return visit(surfaceResult.surface.root);
    })();
    if (invalidDependency) errors.push('only entity dependencies may use Recipe slot subjects');
  }
  const subjects: string[] = [];
  collectSurfaceSubjects(surfaceResult.surface.root, subjects);
  for (const subject of subjects) {
    const slot = /^\$slot:([a-zA-Z0-9_.-]+)$/.exec(subject)?.[1];
    if (slot === undefined || !slotNames.has(slot)) {
      errors.push(`surface subject "${subject}" is not a declared slot`);
    }
  }
  const referencedSlots = subjects
    .map((subject) => /^\$slot:([a-zA-Z0-9_.-]+)$/.exec(subject)?.[1])
    .filter((slot): slot is string => slot !== undefined)
    .filter((slot, index, all) => all.indexOf(slot) === index);
  const candidateSlots = Array.isArray(value.slots) ? value.slots : [];
  if (
    Array.isArray(value.slots) &&
    (referencedSlots.length !== candidateSlots.length ||
      referencedSlots.some((slot, index) => slot !== recordSlotName(candidateSlots[index])))
  ) {
    errors.push('recipe slots must match the complete ordered surface slot shape');
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

function recordSlotName(value: unknown): string | undefined {
  return isRecord(value) && typeof value.name === 'string' ? value.name : undefined;
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

function bindRecipeSubject(subject: string, slots: Readonly<Record<string, string>>): string {
  if (!subject.startsWith('$slot:')) return subject;
  const value = slots[subject.slice('$slot:'.length)];
  if (value === undefined) throw new Error(`recipe slot "${subject}" is unbound`);
  return value;
}

function instantiateRecipeNode(
  node: SurfaceTree['root'],
  slots: Readonly<Record<string, string>>,
): SurfaceTree['root'] {
  const dependencies = node.dependencies.map((dependency) =>
    dependency.kind === 'entity'
      ? {
          ...dependency,
          subject: bindRecipeSubject(dependency.subject, slots),
          version: dependency.version === '$runtime' ? '$runtime' : dependency.version,
        }
      : { ...dependency },
  );
  const base = {
    id: node.id,
    role: node.role,
    dependencies,
    provenance: node.provenance.map((entry) => ({ ...entry })),
  };
  if (node.kind === 'layout') {
    return {
      ...base,
      kind: 'layout',
      layout: node.layout,
      children: node.children.map((child) => instantiateRecipeNode(child, slots)),
    };
  }
  if (node.kind === 'slot') {
    return {
      ...base,
      kind: 'slot',
      name: node.name,
      child: instantiateRecipeNode(node.child, slots),
    };
  }
  if (node.kind === 'repeat') {
    return {
      ...base,
      kind: 'repeat',
      source: { ...node.source, subject: bindRecipeSubject(node.source.subject, slots) },
      item: instantiateRecipeNode(node.item, slots),
    };
  }
  if (node.kind === 'word') {
    return {
      ...base,
      kind: 'word',
      word: node.word,
      bindings: Object.fromEntries(
        Object.entries(node.bindings).map(([name, binding]) => [
          name,
          binding.kind === 'item'
            ? { ...binding }
            : { ...binding, subject: bindRecipeSubject(binding.subject, slots) },
        ]),
      ),
    };
  }
  return {
    ...base,
    kind: 'diagnostic',
    code: node.code,
    ...(node.failedNodeId === undefined ? {} : { failedNodeId: node.failedNodeId }),
  };
}

/** Instantiate only declared Recipe slots; factual values remain binding-only. */
export function instantiateRecipeSurface(
  recipe: ApplicationRenderRecipe,
  slots: readonly ApplicationRecipeSlotBinding[],
): SurfaceTree {
  if (
    slots.length !== recipe.slots.length ||
    slots.some(
      (slot, index) =>
        slot.name !== recipe.slots[index]?.name || slot.kind !== recipe.slots[index]?.kind,
    )
  ) {
    throw new Error('recipe instantiation slot shape does not match the declared ordered shape');
  }
  const subjects = new Set<string>();
  for (const slot of slots) {
    if (
      slot.subject.trim() === '' ||
      slot.subject.startsWith('$slot:') ||
      subjects.has(slot.subject)
    ) {
      throw new Error('recipe instantiation contains an invalid or duplicate slot subject');
    }
    subjects.add(slot.subject);
  }
  const bound = Object.fromEntries(slots.map(({ name, subject }) => [name, subject]));
  const surface = {
    schemaVersion: 1 as const,
    root: instantiateRecipeNode(recipe.surfaceTemplate.root, bound),
  };
  if (JSON.stringify(surface).includes('$slot:')) {
    throw new Error('recipe instantiation left an unresolved slot subject');
  }
  return surface;
}
