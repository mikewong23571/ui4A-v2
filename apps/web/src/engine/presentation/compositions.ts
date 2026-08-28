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
    // v2(T33/D50):成员可能携带已声明动作的区域(inbox 确认、threads 工作线)
    // 升级 invalidate——成员集变化触发结构重规划,决策卡随事实到达;delegations
    // 成员无动作,维持 rehydrate(结构稳定,数据逐源重授权)。
    id: 'my-work',
    version: '2',
    regions: [
      {
        region: 'waiting-for-me',
        source: 'inbox',
        intent: 'Review work waiting for me',
        mode: 'invalidate',
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
        mode: 'invalidate',
        shape: 'collection',
      },
    ],
  },
] as const;

/** Strictly parse and deep-freeze one declaration; shared by static and derived registries. */
export function freezeCompositionDeclaration(value: unknown): BuiltinCompositionDeclaration {
  const declaration = parseCompositionDeclaration(value);
  for (const region of declaration.regions) {
    Object.freeze(region);
  }
  Object.freeze(declaration.regions);
  return Object.freeze(declaration);
}

const builtinCompositions = new Map<string, BuiltinCompositionDeclaration>(
  builtinCompositionData.map((value) => {
    const declaration = freezeCompositionDeclaration(value);
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
