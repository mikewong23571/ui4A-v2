import type { SirenEntity } from '@ui4a/engine';

export interface MetaRendererRegistration {
  id: string;
  priority: number;
  /** Every token must be present in the Siren class list. */
  classes: string[];
  matches?: (entity: SirenEntity) => boolean;
}

export interface MetaRendererRegistry {
  resolve(entity: SirenEntity): string;
}

/** Deterministic class registry. Equal-priority ambiguity is an authoring error, not a guess. */
export function createMetaRendererRegistry(
  registrations: readonly MetaRendererRegistration[],
): MetaRendererRegistry {
  return {
    resolve(entity) {
      const classes = new Set(entity.class);
      const matches = registrations
        .filter(
          (entry) =>
            entry.classes.every((candidate) => classes.has(candidate)) &&
            (entry.matches?.(entity) ?? true),
        )
        .sort((left, right) => right.priority - left.priority);
      if (matches.length > 1 && matches[0]!.priority === matches[1]!.priority) {
        throw new Error(
          `ambiguous Meta renderer: ${matches
            .filter((entry) => entry.priority === matches[0]!.priority)
            .map((entry) => entry.id)
            .join(', ')}`,
        );
      }
      if (matches[0] !== undefined) return matches[0].id;
      return classes.has('collection') ? 'generic-collection' : 'generic-detail';
    },
  };
}
