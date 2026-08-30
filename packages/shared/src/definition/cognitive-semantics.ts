/** Stable cognitive meaning that cannot be derived from the existing business contract. */
export const COGNITIVE_SEMANTICS_TRAITS = [
  'system-fallback',
  'work-queue',
  'review-queue',
  'output-catalog',
  'task-history',
  'human-responsibility',
  'audit-only',
] as const;

export const COGNITIVE_SEMANTICS_GROUP_ROLES = [
  'responsibility',
  'candidate',
  'definition',
  'system',
] as const;

export const COGNITIVE_SEMANTICS_PRIORITIES = ['high', 'normal', 'low'] as const;

export const COGNITIVE_SEMANTICS_EMPTY_MEANINGS = [
  'no-current-responsibility',
  'no-results',
  'ready-to-start',
] as const;

export type CognitiveSemanticsTrait = (typeof COGNITIVE_SEMANTICS_TRAITS)[number];
export type CognitiveSemanticsGroupRole = (typeof COGNITIVE_SEMANTICS_GROUP_ROLES)[number];
export type CognitiveSemanticsPriority = (typeof COGNITIVE_SEMANTICS_PRIORITIES)[number];
export type CognitiveSemanticsEmptyMeaning = (typeof COGNITIVE_SEMANTICS_EMPTY_MEANINGS)[number];

/** Versioned declaration containing cognition only: no facts, fields, or visual policy. */
export interface CognitiveSemanticsDeclarationV1 {
  version: 1;
  traits?: readonly CognitiveSemanticsTrait[];
  groupRole?: CognitiveSemanticsGroupRole;
  priority?: CognitiveSemanticsPriority;
  emptyMeaning?: CognitiveSemanticsEmptyMeaning;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Cognitive semantics declaration must be an object');
  }
}

function assertExactKeys(value: Record<string, unknown>): void {
  const allowed = new Set(['version', 'traits', 'groupRole', 'priority', 'emptyMeaning']);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`Cognitive semantics declaration contains unknown key "${unexpected}"`);
  }
}

function parseMember<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Cognitive semantics ${label} is not in the closed vocabulary`);
  }
  return value as T;
}

function parseTraits(value: unknown): CognitiveSemanticsTrait[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Cognitive semantics traits must be a non-empty array');
  }
  const traits = value.map((entry) => parseMember(entry, COGNITIVE_SEMANTICS_TRAITS, 'trait'));
  if (new Set(traits).size !== traits.length) {
    throw new Error('Cognitive semantics traits must be unique');
  }
  return traits;
}

/** Strictly parse the bounded V1 cognitive declaration; absence remains honest absence. */
export function parseCognitiveSemanticsDeclaration(
  value: unknown,
): CognitiveSemanticsDeclarationV1 | undefined {
  if (value === undefined) return undefined;
  assertRecord(value);
  assertExactKeys(value);
  if (value.version !== 1) {
    throw new Error('Cognitive semantics version must be 1');
  }

  return {
    version: 1,
    ...(value.traits === undefined ? {} : { traits: parseTraits(value.traits) }),
    ...(value.groupRole === undefined
      ? {}
      : {
          groupRole: parseMember(value.groupRole, COGNITIVE_SEMANTICS_GROUP_ROLES, 'groupRole'),
        }),
    ...(value.priority === undefined
      ? {}
      : {
          priority: parseMember(value.priority, COGNITIVE_SEMANTICS_PRIORITIES, 'priority'),
        }),
    ...(value.emptyMeaning === undefined
      ? {}
      : {
          emptyMeaning: parseMember(
            value.emptyMeaning,
            COGNITIVE_SEMANTICS_EMPTY_MEANINGS,
            'emptyMeaning',
          ),
        }),
  };
}
