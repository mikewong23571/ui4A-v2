/**
 * field-definition → JSON Schema(draft-07)派生。
 * RJSF v6 与 Ajv 的共同输入(spec:合同格式必须语言中立)。
 */
import type { FieldDefinition } from '../core/types';

/** 单字段 → JSON Schema 片段。 */
function fieldToJsonSchema(field: FieldDefinition): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  switch (field.type) {
    case 'number':
      schema.type = 'number';
      break;
    case 'boolean':
      schema.type = 'boolean';
      break;
    case 'select':
      schema.type = 'string';
      schema.enum = [...(field.options ?? [])];
      break;
    case 'textarea':
      schema.type = 'string';
      schema.format = 'textarea';
      break;
    case 'date':
      schema.type = 'string';
      schema.format = 'date';
      break;
    case 'json':
      // 任意 JSON 值(meta 编辑动词的 action-definition 全文等);内层形状
      // 缺省由专门 guard 裁决；声明 schema 时同时向人类表单与 agent 工具
      // 披露结构，避免把对象误序列化成字符串。
      Object.assign(schema, field.schema ?? {});
      break;
    default:
      schema.type = 'string';
  }
  if (field.title !== undefined) schema.title = field.title;
  if (field.description !== undefined) schema.description = field.description;
  if (field.minLength !== undefined) schema.minLength = field.minLength;
  if (field.default !== undefined) schema.default = field.default;
  if (field.contentMediaType !== undefined) schema.contentMediaType = field.contentMediaType;
  return schema;
}

/** 字段定义集 → 参数 object schema(严格合同:拒绝多余参数)。 */
export function fieldDefinitionsToJsonSchema(fields: readonly FieldDefinition[]): {
  $schema: string;
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.name] = fieldToJsonSchema(field);
    if (field.required) required.push(field.name);
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * 合并节点字段与动作字段:同名时动作字段覆盖(动作可对节点字段收紧约束)。
 * 向导的表单值随节点走、动作的专属参数随动作走,裁决层须同时校验两者。
 */
export function mergeFieldDefinitions(
  nodeFields: readonly FieldDefinition[],
  actionFields: readonly FieldDefinition[],
): FieldDefinition[] {
  const merged = new Map<string, FieldDefinition>();
  for (const field of nodeFields) merged.set(field.name, field);
  for (const field of actionFields) merged.set(field.name, field);
  return [...merged.values()];
}
