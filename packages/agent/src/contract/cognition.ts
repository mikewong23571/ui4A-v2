import {
  parseCognitiveSemanticsProjection,
  type SirenAction,
  type SirenEntity,
  type SirenFieldPresentation,
} from '@ui4a/engine';

const MAX_COLLECTION_MEMBER_SUMMARIES = 8;
const COGNITIVE_PROPERTY_KEYS = [
  'rel',
  'name',
  'title',
  'identity',
  'status',
  'node',
  'flow',
  'version',
  'count',
  'intent',
  'kind',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type FieldPresentationRole = NonNullable<SirenFieldPresentation['role']>;

function fieldPresentationRole(value: unknown): FieldPresentationRole | undefined {
  switch (value) {
    case 'identity':
    case 'status':
    case 'primary-content':
    case 'metadata':
    case 'relation':
      return value;
    default:
      return undefined;
  }
}

function sanitizeFieldPresentation(value: unknown): SirenFieldPresentation | undefined {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.title !== 'string') {
    return undefined;
  }
  const role = fieldPresentationRole(value.role);
  const overview = value.overview === true;
  if (role === undefined && !overview) return undefined;
  return {
    path: value.path,
    title: value.title,
    ...(role === undefined ? {} : { role }),
    ...(typeof value.overview === 'boolean' ? { overview: value.overview } : {}),
    ...(typeof value.contentMediaType === 'string'
      ? { contentMediaType: value.contentMediaType }
      : {}),
  };
}

function cognitiveFieldCandidate(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.role === undefined ? {} : { role: value.role }),
    ...(value.overview === undefined ? {} : { overview: value.overview }),
    ...(value.contentMediaType === undefined ? {} : { contentMediaType: value.contentMediaType }),
  };
}

function sanitizeCognitivePresentation(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const hasDeclaration = ['version', 'traits', 'groupRole', 'priority', 'emptyMeaning'].some(
    (key) => value[key] !== undefined,
  );
  const hasFields = value.fields !== undefined;
  if (!hasDeclaration && !hasFields) return undefined;
  try {
    const projection = parseCognitiveSemanticsProjection({
      version: value.version,
      ...(value.traits === undefined ? {} : { traits: value.traits }),
      ...(value.groupRole === undefined ? {} : { groupRole: value.groupRole }),
      ...(value.priority === undefined ? {} : { priority: value.priority }),
      ...(value.emptyMeaning === undefined ? {} : { emptyMeaning: value.emptyMeaning }),
      ...(hasFields
        ? {
            fields: Array.isArray(value.fields)
              ? value.fields.map(cognitiveFieldCandidate)
              : value.fields,
          }
        : {}),
    });
    return projection === undefined ? undefined : { ...projection };
  } catch {
    return undefined;
  }
}

function sanitizePresentation(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const cognition = sanitizeCognitivePresentation(value);
  const sanitized = {
    ...(cognition ?? {}),
    // T38 collection filters are contract declarations beside, not part of, V1 cognition.
    ...(value.filters === undefined ? {} : { filters: value.filters }),
  };
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function declaredFields(
  properties: Record<string, unknown>,
  overviewOnly: boolean,
): SirenFieldPresentation[] {
  const presentation = isRecord(properties.presentation) ? properties.presentation : undefined;
  if (presentation === undefined || !Array.isArray(presentation.fields)) return [];
  return presentation.fields.flatMap((entry) => {
    const field = sanitizeFieldPresentation(entry);
    return field === undefined || (overviewOnly && field.overview !== true) ? [] : [field];
  });
}

function declaredFieldName(field: SirenFieldPresentation): string | undefined {
  return /^properties\.fields\.([^.[\]]+)$/.exec(field.path)?.[1];
}

export function sanitizeProperties(
  properties: Record<string, unknown>,
  overviewOnly: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of COGNITIVE_PROPERTY_KEYS) {
    const value = properties[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      result[key] = value;
    }
  }
  const fieldPresentations = declaredFields(properties, overviewOnly);
  const fields = isRecord(properties.fields) ? properties.fields : undefined;
  if (fields !== undefined && fieldPresentations.length > 0) {
    result.fields = Object.fromEntries(
      fieldPresentations.flatMap((field) => {
        const name = declaredFieldName(field);
        return name === undefined || !(name in fields) ? [] : [[name, fields[name]]];
      }),
    );
  }
  for (const field of fieldPresentations) {
    const match = /^properties\.([^.[\]]+)$/.exec(field.path);
    const key = match?.[1];
    if (key !== undefined && key !== 'presentation' && key in properties) {
      result[key] = properties[key];
    }
  }
  const presentation = sanitizePresentation(properties.presentation);
  if (presentation !== undefined) {
    result.presentation = {
      ...presentation,
      ...(Array.isArray(presentation.fields) ? { fields: fieldPresentations } : {}),
    };
  }
  return result;
}

function sanitizeAction(action: SirenAction): Record<string, unknown> {
  return {
    name: action.name,
    title: action.title,
    fields: action.fields,
    ...(action['requires-confirmation'] === undefined
      ? {}
      : { 'requires-confirmation': action['requires-confirmation'] }),
    ...(action.submission === undefined
      ? {}
      : {
          submission: {
            mode: action.submission.mode,
            ...(action.submission.actors === undefined
              ? {}
              : { actors: [...action.submission.actors] }),
            ...(action.submission.scopes === undefined
              ? {}
              : { scopes: [...action.submission.scopes] }),
            ...(action.submission.reason === undefined ? {} : { reason: action.submission.reason }),
          },
        }),
  };
}

function sanitizeGuardResults(entity: SirenEntity): Record<string, unknown>[] | undefined {
  return entity['guard-results']?.map((entry) => ({
    action: entry.action,
    blocked: entry.blocked,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
  }));
}

function summarizeCollectionMember(entity: SirenEntity): Record<string, unknown> {
  return {
    class: [...entity.class],
    properties: sanitizeProperties(entity.properties, true),
    actions: entity.actions.map(({ name, title }) => ({ name, title })),
    ...(sanitizeGuardResults(entity) === undefined
      ? {}
      : { 'guard-results': sanitizeGuardResults(entity) }),
  };
}

/** Provider-facing entity cognition; the complete Siren entity remains available over HTTP. */
export function sanitizeEntity(entity: SirenEntity): Record<string, unknown> {
  return {
    class: [...entity.class],
    ...(entity.rel === undefined ? {} : { rel: [...entity.rel] }),
    properties: sanitizeProperties(entity.properties, false),
    actions: entity.actions.map(sanitizeAction),
    links: entity.links.map((link) => ({
      rel: [...link.rel],
      ...(link.title === undefined ? {} : { title: link.title }),
    })),
    ...(sanitizeGuardResults(entity) === undefined
      ? {}
      : { 'guard-results': sanitizeGuardResults(entity) }),
    ...(entity.entities === undefined
      ? {}
      : {
          entities: entity.entities
            .slice(0, MAX_COLLECTION_MEMBER_SUMMARIES)
            .map(summarizeCollectionMember),
        }),
  };
}
