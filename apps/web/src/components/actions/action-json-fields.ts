import type { SirenAction } from '@ui4a/engine';

type ActionSchema = SirenAction['fields'];

export interface ActionFormProjection {
  schema: ActionSchema;
  uiSchema?: Record<string, { 'ui:widget': 'textarea'; 'ui:options': { rows: number } }>;
  unconstrainedJsonFields: string[];
}

export type ParsedActionFormData =
  { ok: true; params: Record<string, unknown> | undefined } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exact `{}` is the contract's unconstrained JSON value, independent of action or field names. */
function isUnconstrainedJsonSchema(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

/**
 * RJSF cannot render an exact `{}` property. Project only those fields to a textarea-shaped string
 * schema for interaction; submission is parsed back to JSON and judged against the original schema.
 */
export function projectActionFormSchema(schema: ActionSchema): ActionFormProjection {
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (properties === undefined) return { schema, unconstrainedJsonFields: [] };
  const names = Object.entries(properties).flatMap(([name, field]) =>
    isUnconstrainedJsonSchema(field) ? [name] : [],
  );
  if (names.length === 0) return { schema, unconstrainedJsonFields: [] };

  const projectedProperties = { ...properties };
  const uiSchema: NonNullable<ActionFormProjection['uiSchema']> = {};
  for (const name of names) {
    projectedProperties[name] = {
      type: 'string',
      title: name,
      description: 'JSON',
    };
    uiSchema[name] = { 'ui:widget': 'textarea', 'ui:options': { rows: 10 } };
  }
  return {
    schema: { ...schema, properties: projectedProperties },
    uiSchema,
    unconstrainedJsonFields: names,
  };
}

/** Prefill declared scalar fields and JSON-encode exact `{}` fields without inventing field names. */
export function initialActionFormData(
  schema: ActionSchema,
  prefill: Record<string, unknown> | undefined,
  unconstrainedJsonFields: string[],
): Record<string, unknown> | undefined {
  if (prefill === undefined || !isRecord(schema.properties)) return undefined;
  const jsonFields = new Set(unconstrainedJsonFields);
  const data: Record<string, unknown> = {};
  for (const name of Object.keys(schema.properties)) {
    const value = prefill[name];
    if (jsonFields.has(name) && Object.hasOwn(prefill, name)) {
      const encoded = JSON.stringify(value, null, 2);
      if (encoded !== undefined) data[name] = encoded;
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      data[name] = value;
    }
  }
  return Object.keys(data).length > 0 ? data : undefined;
}

/** Parse textarea values back to real JSON before the original caller/full schemas judge them. */
export function parseActionFormData(
  formData: Record<string, unknown> | undefined,
  unconstrainedJsonFields: string[],
): ParsedActionFormData {
  if (formData === undefined) return { ok: true, params: undefined };
  const params = { ...formData };
  for (const name of unconstrainedJsonFields) {
    if (!Object.hasOwn(params, name)) continue;
    const raw = params[name];
    if (typeof raw !== 'string') {
      return { ok: false, reason: `JSON 字段 “${name}” 必须是文本输入。` };
    }
    try {
      params[name] = JSON.parse(raw) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `JSON 字段 “${name}” 必须是合法 JSON：${detail}` };
    }
  }
  return { ok: true, params };
}
