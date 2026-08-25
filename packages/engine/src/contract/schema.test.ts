import { describe, expect, it } from 'vitest';

import { fieldDefinitionsToJsonSchema } from './schema';
import type { FieldDefinition } from '../core/types';

const fields: FieldDefinition[] = [
  { name: 'region', type: 'select', options: ['cn-north', 'cn-south'], title: '地域' },
  { name: 'content', type: 'textarea', required: true, description: '正文' },
  { name: 'count', type: 'number', default: 3 },
  { name: 'published', type: 'boolean' },
  { name: 'publishAt', type: 'date' },
  { name: 'title', type: 'text' },
  { name: 'action', type: 'json', required: true },
];

describe('fieldDefinitionsToJsonSchema(JSON Schema draft-07,RJSF 直接输入)', () => {
  it('产出 object schema:properties/required/additionalProperties:false', () => {
    const schema = fieldDefinitionsToJsonSchema(fields);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['content', 'action'],
    });
  });

  it('select → string + enum;textarea → string + format=textarea', () => {
    const schema = fieldDefinitionsToJsonSchema(fields);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.region).toMatchObject({
      type: 'string',
      enum: ['cn-north', 'cn-south'],
      title: '地域',
    });
    expect(properties.content).toMatchObject({
      type: 'string',
      format: 'textarea',
      description: '正文',
    });
  });

  it('number/boolean/date/text 类型映射正确,default 保留', () => {
    const schema = fieldDefinitionsToJsonSchema(fields);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.count).toMatchObject({ type: 'number', default: 3 });
    expect(properties.published).toMatchObject({ type: 'boolean' });
    expect(properties.publishAt).toMatchObject({ type: 'string', format: 'date' });
    expect(properties.title).toMatchObject({ type: 'string' });
  });

  it('无字段动作 → 空 properties 与空 required(合法 draft-07)', () => {
    const schema = fieldDefinitionsToJsonSchema([]);
    expect(schema.properties).toEqual({});
    expect(schema.required).toEqual([]);
  });

  it('json 字段缺省不约束；显式 schema 原样投影给表单与 agent 工具', () => {
    const schema = fieldDefinitionsToJsonSchema(fields);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    // 无 type 约束 = 任意 JSON 值;内层形状由专门 guard(to-exists 等)裁决。
    expect(properties.action).toEqual({});

    const described = fieldDefinitionsToJsonSchema([
      { name: 'action', type: 'json', schema: { type: 'object', required: ['name'] } },
    ]);
    expect(described.properties.action).toEqual({ type: 'object', required: ['name'] });
  });

  it('minLength 声明透传(T3:reject 的 reason 必填且非空)', () => {
    const schema = fieldDefinitionsToJsonSchema([
      { name: 'reason', type: 'textarea', required: true, minLength: 1 },
    ]);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.reason).toMatchObject({ type: 'string', minLength: 1 });
    expect(schema.required).toEqual(['reason']);
  });

  it('contentMediaType 作为 JSON Schema 内容类型投影，呈现角色不混入输入 schema', () => {
    const schema = fieldDefinitionsToJsonSchema([
      {
        name: 'body',
        type: 'textarea',
        presentation: { role: 'primary-content' },
        contentMediaType: 'text/markdown',
      },
    ]);

    expect(schema.properties.body).toMatchObject({
      type: 'string',
      format: 'textarea',
      contentMediaType: 'text/markdown',
    });
    expect(schema.properties.body).not.toHaveProperty('presentation');
  });
});
