import {
  parseCognitiveSemanticsDeclaration,
  type CognitiveSemanticsDeclarationV1,
} from '@ui4a/shared';

import type { SirenFieldPresentation } from './siren/types';

const FIELD_PRESENTATION_ROLES = new Set([
  'identity',
  'status',
  'primary-content',
  'metadata',
  'relation',
]);

/** The single cognitive source projected into public sitemap and exact Siren contracts. */
export interface CognitiveSemanticsProjectionV1 extends CognitiveSemanticsDeclarationV1 {
  fields?: SirenFieldPresentation[];
}

export interface ProjectCognitiveSemanticsInput {
  declaration?: unknown;
  /** Output of the existing field presentation projector; remains authoritative. */
  fieldPresentations?: readonly SirenFieldPresentation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFieldPresentation(value: unknown): SirenFieldPresentation {
  if (!isRecord(value)) throw new Error('Cognitive presentation field must be an object');
  const allowed = new Set(['path', 'title', 'role', 'overview', 'contentMediaType']);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`Cognitive presentation field contains unknown key "${unexpected}"`);
  }
  if (typeof value.path !== 'string' || value.path === '') {
    throw new Error('Cognitive presentation field path must be a non-empty string');
  }
  if (typeof value.title !== 'string' || value.title === '') {
    throw new Error('Cognitive presentation field title must be a non-empty string');
  }
  if (value.role !== undefined && !FIELD_PRESENTATION_ROLES.has(String(value.role))) {
    throw new Error('Cognitive presentation field role is not in the closed vocabulary');
  }
  if (value.overview !== undefined && typeof value.overview !== 'boolean') {
    throw new Error('Cognitive presentation field overview must be boolean');
  }
  if (value.contentMediaType !== undefined && typeof value.contentMediaType !== 'string') {
    throw new Error('Cognitive presentation field contentMediaType must be a string');
  }
  return {
    path: value.path,
    title: value.title,
    ...(value.role === undefined ? {} : { role: value.role as SirenFieldPresentation['role'] }),
    ...(value.overview === undefined ? {} : { overview: value.overview }),
    ...(value.contentMediaType === undefined ? {} : { contentMediaType: value.contentMediaType }),
  };
}

/** Strict public-wire parser for the cognitive projection consumed by typed clients. */
export function parseCognitiveSemanticsProjection(
  value: unknown,
): CognitiveSemanticsProjectionV1 | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('Cognitive presentation must be an object');
  const allowed = new Set(['version', 'traits', 'groupRole', 'priority', 'emptyMeaning', 'fields']);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`Cognitive presentation contains unknown key "${unexpected}"`);
  }
  const declaration = parseCognitiveSemanticsDeclaration({
    version: value.version,
    ...(value.traits === undefined ? {} : { traits: value.traits }),
    ...(value.groupRole === undefined ? {} : { groupRole: value.groupRole }),
    ...(value.priority === undefined ? {} : { priority: value.priority }),
    ...(value.emptyMeaning === undefined ? {} : { emptyMeaning: value.emptyMeaning }),
  });
  const fields =
    value.fields === undefined
      ? undefined
      : Array.isArray(value.fields) && value.fields.length > 0
        ? value.fields.map(parseFieldPresentation)
        : (() => {
            throw new Error('Cognitive presentation fields must be a non-empty array');
          })();
  return {
    ...declaration!,
    ...(fields === undefined ? {} : { fields }),
  };
}

/** Merge declared cognition with existing field references without duplicating field authority. */
export function projectCognitiveSemantics(
  input: ProjectCognitiveSemanticsInput,
): CognitiveSemanticsProjectionV1 | undefined {
  const declaration = parseCognitiveSemanticsDeclaration(input.declaration);
  const fields = input.fieldPresentations;
  const hasDeclaredSemantics =
    declaration !== undefined &&
    (declaration.traits !== undefined ||
      declaration.groupRole !== undefined ||
      declaration.priority !== undefined ||
      declaration.emptyMeaning !== undefined);
  const hasFields = fields !== undefined && fields.length > 0;

  if (!hasDeclaredSemantics && !hasFields) return undefined;

  return {
    version: 1,
    ...(declaration?.traits === undefined ? {} : { traits: declaration.traits }),
    ...(declaration?.groupRole === undefined ? {} : { groupRole: declaration.groupRole }),
    ...(declaration?.priority === undefined ? {} : { priority: declaration.priority }),
    ...(declaration?.emptyMeaning === undefined ? {} : { emptyMeaning: declaration.emptyMeaning }),
    ...(hasFields ? { fields: fields.map((field) => ({ ...field })) } : {}),
  };
}
