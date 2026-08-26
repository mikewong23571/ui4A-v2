import {
  instantiateRecipeSurface,
  type ApplicationRecipeSlotBinding,
  type ApplicationRenderRecipe,
  type SurfaceTree,
} from '@ui4a/engine';

export interface RecipeSelectionInput {
  subjectShape: string;
  intent: string;
  catalogVersion: string;
  slots: readonly ApplicationRecipeSlotBinding[];
}

export interface InstantiatedRecipeSelection {
  recipe: ApplicationRenderRecipe;
  surface: SurfaceTree;
}

function exactSlotShape(
  recipe: ApplicationRenderRecipe,
  expected: readonly ApplicationRecipeSlotBinding[],
): boolean {
  return (
    recipe.slots.length === expected.length &&
    recipe.slots.every(
      (slot, index) => slot.name === expected[index]?.name && slot.kind === expected[index]?.kind,
    )
  );
}

/** Select and instantiate only an exact ordered Recipe slot shape. */
export function selectAndInstantiateRecipe(
  recipes: readonly ApplicationRenderRecipe[],
  input: RecipeSelectionInput,
): InstantiatedRecipeSelection | undefined {
  const recipe = recipes
    .filter(
      (candidate) =>
        candidate.status !== 'stale' &&
        candidate.key.subjectShape === input.subjectShape &&
        candidate.key.intent === input.intent &&
        candidate.key.catalogVersion === input.catalogVersion &&
        exactSlotShape(candidate, input.slots),
    )
    .sort((left, right) => {
      const status = Number(right.status === 'promoted') - Number(left.status === 'promoted');
      return status !== 0 ? status : right.version - left.version;
    })[0];
  return recipe === undefined
    ? undefined
    : { recipe, surface: instantiateRecipeSurface(recipe, input.slots) };
}
