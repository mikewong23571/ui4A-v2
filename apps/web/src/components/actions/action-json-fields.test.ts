import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import {
  initialActionFormData,
  parseActionFormData,
  projectActionFormSchema,
} from './action-json-fields';

/** 读 projected schema 的 properties(未知键,经 isRecord 口径收窄)。 */
function props(schema: Record<string, unknown>): Record<string, unknown> {
  const value = schema.properties;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 与 action-submit 同口径的 caller/full schema 裁决器(draft-07)。 */
function compileValidator(schema: Record<string, unknown>): (value: unknown) => boolean {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

/** F-09 实测口径:writing-request「开始写作」动作的 caller schema。 */
const writingSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['objective', 'audience', 'requiredSections', 'constraints', 'sources'],
  properties: {
    objective: { type: 'string', minLength: 1, title: '写作目标' },
    audience: { type: 'string', minLength: 1, title: '目标读者' },
    requiredSections: { type: 'array', items: { type: 'string' }, title: '必需章节' },
    constraints: { type: 'array', items: { type: 'string' }, title: '写作约束' },
    sources: {
      type: 'array',
      title: '授权来源',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          mediaType: { type: 'string', enum: ['text/plain', 'text/markdown'] },
          content: { type: 'string' },
          hash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
        },
        required: ['id', 'title', 'mediaType', 'content', 'hash'],
        additionalProperties: false,
      },
    },
  },
};

describe('projectActionFormSchema (F-09:受约束 JSON 字段投影)', () => {
  it('projects declared array/object caller fields to JSON textareas, preserving contract titles', () => {
    const projection = projectActionFormSchema(writingSchema);

    // 受约束 array/object 字段投影为 string schema:保留合同 title,description 为 JSON 提示。
    expect(props(projection.schema).requiredSections).toEqual({
      type: 'string',
      title: '必需章节',
      description: 'JSON',
    });
    expect(props(projection.schema).constraints).toEqual({
      type: 'string',
      title: '写作约束',
      description: 'JSON',
    });
    expect(props(projection.schema).sources).toEqual({
      type: 'string',
      title: '授权来源',
      description: 'JSON',
    });
    // 标量字段原样保留,不进投影。
    expect(props(projection.schema).objective).toEqual({
      type: 'string',
      minLength: 1,
      title: '写作目标',
    });
    expect(props(projection.schema).audience).toEqual({
      type: 'string',
      minLength: 1,
      title: '目标读者',
    });

    // uiSchema:仅投影字段走 textarea;标量零 uiSchema。
    expect(projection.uiSchema?.requiredSections).toEqual({
      'ui:widget': 'textarea',
      'ui:options': { rows: 10 },
    });
    expect(projection.uiSchema?.sources).toEqual({
      'ui:widget': 'textarea',
      'ui:options': { rows: 10 },
    });
    expect(projection.uiSchema?.objective).toBeUndefined();

    // 字段清单驱动预填编码与提交解析;原 required/additionalProperties 不变。
    expect(projection.jsonTextFields).toEqual(['requiredSections', 'constraints', 'sources']);
    expect(projection.schema.required).toEqual([
      'objective',
      'audience',
      'requiredSections',
      'constraints',
      'sources',
    ]);
    expect(projection.schema.additionalProperties).toBe(false);
  });

  it('falls back to the machine name only when the original field has no title', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        rawConfig: { type: 'object', properties: { a: { type: 'string' } } },
        labels: { type: 'array', items: { type: 'string' } },
      },
    };
    const projection = projectActionFormSchema(schema);
    expect(props(projection.schema).rawConfig).toEqual({
      type: 'string',
      title: 'rawConfig',
      description: 'JSON',
    });
    expect(props(projection.schema).labels).toEqual({
      type: 'string',
      title: 'labels',
      description: 'JSON',
    });
    expect(projection.jsonTextFields).toEqual(['rawConfig', 'labels']);
  });

  it('keeps projecting exact `{}` fields (T14 回归:无约束 JSON 值)', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: { extension: {}, note: { type: 'string' } },
    };
    const projection = projectActionFormSchema(schema);
    expect(props(projection.schema).extension).toEqual({
      type: 'string',
      title: 'extension',
      description: 'JSON',
    });
    expect(projection.uiSchema?.extension).toEqual({
      'ui:widget': 'textarea',
      'ui:options': { rows: 10 },
    });
    expect(projection.jsonTextFields).toEqual(['extension']);
    expect(props(projection.schema).note).toEqual({ type: 'string' });
  });

  it('passes through schemas without json text fields (empty properties, scalars only)', () => {
    const empty: Record<string, unknown> = { type: 'object', properties: {} };
    const projection = projectActionFormSchema(empty);
    expect(projection.schema).toBe(empty);
    expect(projection.uiSchema).toBeUndefined();
    expect(projection.jsonTextFields).toEqual([]);

    const scalars: Record<string, unknown> = {
      type: 'object',
      properties: {
        title: { type: 'string', title: '文章标题' },
        category: { type: 'string', enum: ['tech', 'essay'] },
        active: { type: 'boolean' },
        count: { type: 'number' },
      },
    };
    const scalarProjection = projectActionFormSchema(scalars);
    expect(scalarProjection.schema).toBe(scalars);
    expect(scalarProjection.uiSchema).toBeUndefined();
    expect(scalarProjection.jsonTextFields).toEqual([]);
  });
});

describe('initialActionFormData (F-09:预填覆盖新投影字段)', () => {
  it('JSON-encodes array/object prefills as indented text, keeps scalars, drops unknowns', () => {
    const prefill: Record<string, unknown> = {
      objective: '写一篇',
      audience: '内部团队',
      requiredSections: ['Summary', 'Evidence'],
      constraints: ['正式文风', '不引用未授权来源'],
      sources: [
        {
          id: 'src-1',
          title: '来源一',
          mediaType: 'text/plain',
          content: '内容',
          hash: `sha256:${'a'.repeat(64)}`,
        },
      ],
      injected: 'must-not-submit',
    };
    const data = initialActionFormData(writingSchema, prefill, [
      'requiredSections',
      'constraints',
      'sources',
    ]);

    expect(data).toBeDefined();
    expect(data!.objective).toBe('写一篇');
    expect(data!.audience).toBe('内部团队');
    expect(JSON.parse(data!.requiredSections as string)).toEqual(['Summary', 'Evidence']);
    expect(JSON.parse(data!.constraints as string)).toEqual(['正式文风', '不引用未授权来源']);
    expect(JSON.parse(data!.sources as string)).toEqual([
      {
        id: 'src-1',
        title: '来源一',
        mediaType: 'text/plain',
        content: '内容',
        hash: `sha256:${'a'.repeat(64)}`,
      },
    ]);
    // 缩进 JSON 文本(可编辑),不是序列化对象。
    expect(data!.requiredSections).toContain('\n');
    expect(data!.injected).toBeUndefined();
  });

  it('returns undefined when there is no prefill or no declared properties', () => {
    expect(initialActionFormData(writingSchema, undefined, ['requiredSections'])).toBeUndefined();
    expect(
      initialActionFormData({ type: 'object', properties: {} }, { requiredSections: ['x'] }, [
        'requiredSections',
      ]),
    ).toBeUndefined();
  });
});

describe('parseActionFormData + 原 schema 裁决 (F-09)', () => {
  it('round-trips textarea JSON back to arrays/objects and passes the original caller schema', () => {
    const formData: Record<string, unknown> = {
      objective: '写一篇',
      audience: '内部团队',
      requiredSections: '["Summary","Evidence"]',
      constraints: '["正式文风"]',
      sources: JSON.stringify(
        [
          {
            id: 'src-1',
            title: '来源一',
            mediaType: 'text/plain',
            content: '内容',
            hash: `sha256:${'a'.repeat(64)}`,
          },
        ],
        null,
        2,
      ),
    };
    const parsed = parseActionFormData(formData, ['requiredSections', 'constraints', 'sources']);

    expect(parsed).toEqual({
      ok: true,
      params: {
        objective: '写一篇',
        audience: '内部团队',
        requiredSections: ['Summary', 'Evidence'],
        constraints: ['正式文风'],
        sources: [
          {
            id: 'src-1',
            title: '来源一',
            mediaType: 'text/plain',
            content: '内容',
            hash: `sha256:${'a'.repeat(64)}`,
          },
        ],
      },
    });

    // 解析后的真实 JSON 由原 caller schema(未投影)继续裁决——投影只是交互形状。
    const validate = compileValidator(writingSchema);
    expect(parsed.ok && validate(parsed.params)).toBe(true);
  });

  it('rejects invalid JSON with a human-readable schema-invalid reason and keeps the text', () => {
    const parsed = parseActionFormData({ sources: '[{"id":' }, ['sources']);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/JSON 字段 “sources” 必须是合法 JSON/);
  });

  it('rejects non-string projected values and passes through untouched data', () => {
    const nonString = parseActionFormData({ sources: { id: 'x' } }, ['sources']);
    expect(nonString.ok).toBe(false);
    if (!nonString.ok) expect(nonString.reason).toMatch(/必须是文本输入/);

    const untouched = parseActionFormData({ objective: 'x' }, ['requiredSections']);
    expect(untouched).toEqual({ ok: true, params: { objective: 'x' } });
    expect(parseActionFormData(undefined, ['sources'])).toEqual({ ok: true, params: undefined });
  });

  it('valid JSON that violates the original schema is still rejected by the caller schema', () => {
    // 合法 JSON,但 sources items 缺 required(id/title/mediaType/content/hash)。
    const parsed = parseActionFormData({ sources: '[{"id":"x"}]' }, ['sources']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validate = compileValidator(writingSchema);
    expect(validate(parsed.params)).toBe(false);
  });
});
