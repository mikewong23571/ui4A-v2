import type { SirenAction } from '@ui4a/engine';

type ActionSchema = SirenAction['fields'];

export interface ActionFormProjection {
  schema: ActionSchema;
  uiSchema?: Record<string, { 'ui:widget': 'textarea'; 'ui:options': { rows: number } }>;
  /** 投影为 JSON textarea 交互的字段名(预填编码与提交解析共用此清单)。 */
  jsonTextFields: string[];
}

export type ParsedActionFormData =
  { ok: true; params: Record<string, unknown> | undefined } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 需要投影为 JSON textarea 的字段:RJSF 在当前 FieldTemplate/样式下无法把
 * JSON 复合值渲染成可用的原生控件。两类——精确 `{}` 无约束 JSON 值(F-09
 * 前的 T14 机制)与声明 type:array/object 的受约束 JSON 字段(F-09);零
 * per-field/per-app 特判,交互形状一律由原始 schema 在提交时重新裁决。
 */
function isJsonProjectionField(field: unknown): boolean {
  if (!isRecord(field)) return false;
  if (Object.keys(field).length === 0) return true;
  return field.type === 'array' || field.type === 'object';
}

/**
 * 投影字段为 textarea 形状的 string schema 供交互;提交时解析回真实 JSON,
 * 仍由原始 caller/full schema 裁决(投影只改交互形状,不放松校验)。
 */
export function projectActionFormSchema(schema: ActionSchema): ActionFormProjection {
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (properties === undefined) return { schema, jsonTextFields: [] };
  const entries = Object.entries(properties).filter(
    (entry): entry is [string, Record<string, unknown>] => isJsonProjectionField(entry[1]),
  );
  if (entries.length === 0) return { schema, jsonTextFields: [] };

  const projectedProperties = { ...properties };
  const uiSchema: NonNullable<ActionFormProjection['uiSchema']> = {};
  const jsonTextFields: string[] = [];
  for (const [name, field] of entries) {
    jsonTextFields.push(name);
    projectedProperties[name] = {
      type: 'string',
      // 保留合同 title(中文标签);仅无 title 的机器名字段回退为字段名。
      title: typeof field.title === 'string' ? field.title : name,
      description: 'JSON',
    };
    uiSchema[name] = { 'ui:widget': 'textarea', 'ui:options': { rows: 10 } };
  }
  return {
    schema: { ...schema, properties: projectedProperties },
    uiSchema,
    jsonTextFields,
  };
}

/** 预填:标量沿用原生值,投影 JSON 字段编码为缩进 JSON 文本,不发明字段名。 */
export function initialActionFormData(
  schema: ActionSchema,
  prefill: Record<string, unknown> | undefined,
  jsonTextFields: string[],
): Record<string, unknown> | undefined {
  if (prefill === undefined || !isRecord(schema.properties)) return undefined;
  const jsonFields = new Set(jsonTextFields);
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

/** 把 textarea 文本解析回真实 JSON,交给未投影的 caller/full schema 裁决。 */
export function parseActionFormData(
  formData: Record<string, unknown> | undefined,
  jsonTextFields: string[],
): ParsedActionFormData {
  if (formData === undefined) return { ok: true, params: undefined };
  const params = { ...formData };
  for (const name of jsonTextFields) {
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
