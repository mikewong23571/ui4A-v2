import {
  parseCompositionDeclaration,
  parseCompositionId,
  type CompositionDeclaration,
  type CompositionRegionDeclaration,
} from '@ui4a/shared';

export interface BuiltinCompositionDeclaration extends Readonly<
  Omit<CompositionDeclaration, 'regions'>
> {
  readonly regions: readonly Readonly<CompositionRegionDeclaration>[];
}

export type BuiltinCompositionSubjectResolution =
  | { readonly kind: 'not-workspace' }
  | { readonly kind: 'rejected-workspace' }
  | {
      readonly kind: 'composition';
      readonly declaration: BuiltinCompositionDeclaration;
    };

const WORKSPACE_SUBJECT_PREFIX = 'workspace:';

const builtinCompositionData = [
  {
    id: 'my-work',
    version: '1',
    regions: [
      {
        region: 'waiting-for-me',
        source: 'inbox',
        intent: 'Review work waiting for me',
        mode: 'rehydrate',
        shape: 'collection',
      },
      {
        region: 'in-motion',
        source: 'delegations',
        intent: 'Track work currently in motion',
        mode: 'rehydrate',
        shape: 'collection',
      },
      {
        region: 'work-lines',
        source: 'threads',
        intent: 'Follow active work lines',
        mode: 'rehydrate',
        shape: 'collection',
      },
    ],
  },
] as const;

function freezeDeclaration(value: unknown): BuiltinCompositionDeclaration {
  const declaration = parseCompositionDeclaration(value);
  for (const region of declaration.regions) {
    Object.freeze(region);
  }
  Object.freeze(declaration.regions);
  return Object.freeze(declaration);
}

const builtinCompositions = new Map<string, BuiltinCompositionDeclaration>(
  builtinCompositionData.map((value) => {
    const declaration = freezeDeclaration(value);
    return [declaration.id, declaration];
  }),
);

/** Look up a built-in declaration by a strictly parsed declaration id. */
export function getBuiltinComposition(id: string): BuiltinCompositionDeclaration | undefined {
  try {
    return builtinCompositions.get(parseCompositionId(id));
  } catch {
    return undefined;
  }
}

/**
 * Resolve the reserved virtual-subject namespace without mistaking ordinary contract rels for it.
 * Any malformed or unregistered workspace subject is rejected and must not fall back to a rel.
 */
export function resolveBuiltinCompositionSubject(
  subject: string,
): BuiltinCompositionSubjectResolution {
  if (!subject.startsWith(WORKSPACE_SUBJECT_PREFIX)) {
    return { kind: 'not-workspace' };
  }

  const declaration = getBuiltinComposition(subject.slice(WORKSPACE_SUBJECT_PREFIX.length));
  return declaration === undefined
    ? { kind: 'rejected-workspace' }
    : { kind: 'composition', declaration };
}
