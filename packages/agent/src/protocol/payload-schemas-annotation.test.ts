/**
 * D69 T50 附录(prompt 预算冲突裁定)模型视图剥离单测:
 * packages/agent 的动作字段 → 工具 schema 投影对 fields 顶层
 * `x-ui4a-payload-schemas` 注解剥离 per-kind `schema` 大对象、保留 `example`
 * ——披露收窄只发生在 prompt 层,HTTP 合同/CLI/e2e 仍见全量注解
 * (route.meta-parity.test.ts 固定 HTTP 同载荷全量回放)。
 */
import { describe, expect, it } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { sanitizeEntity } from '../contract/cognition';
import { buildToolProjection } from './tools';
import { instanceEntity } from '../testkit/testkit';

const bundleSchema = {
  type: 'object',
  required: ['schema', 'bundle'],
  properties: { schema: { enum: ['https://ui4a.dev/application-bundle/v1'] } },
};

const bundleExample = {
  schema: 'https://ui4a.dev/application-bundle/v1',
  bundle: { name: 'example-bundle', version: 1 },
};

/** 与 apps/web draft-action-schemas 同形:注解挂 fields 顶层,payload 属性保持精确 {}。 */
const annotatedFields = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['flow-definition', 'agent-definition', 'application-bundle'] },
    commandId: { type: 'string', minLength: 1, 'x-ui4a-input-owner': 'client' },
    payload: {},
  },
  required: ['kind', 'commandId', 'payload'],
  additionalProperties: false,
  'x-ui4a-payload-schemas': {
    'application-bundle': { schema: bundleSchema, example: bundleExample },
    'flow-definition': { schema: {} },
    'agent-definition': { schema: {} },
  },
};

function entityWithAction(action: SirenAction): SirenEntity {
  return {
    ...instanceEntity({
      rel: 'meta/drafts',
      flow: 'draft-review',
      node: 'candidate',
      actions: [action],
    }),
    properties: { rel: 'meta/drafts', count: 0 },
  };
}

function createActionTool(fields: Record<string, unknown>) {
  const entity = entityWithAction({
    name: 'create',
    title: 'Create Draft',
    method: 'POST',
    href: '/_meta/api/exec',
    fields,
  });
  return buildToolProjection(entity).find((tool) => tool.name === 'action_create')!;
}

describe('D69 附录(T50):模型视图剥离 x-ui4a-payload-schemas 注解', () => {
  it('action_* 工具的注解剥离 per-kind schema、保留 example;宽松分支同样无 schema 键', () => {
    const tool = createActionTool(structuredClone(annotatedFields) as Record<string, unknown>);
    const parameters = tool.parameters as Record<string, unknown>;
    const annotation = parameters['x-ui4a-payload-schemas'] as Record<string, unknown>;

    expect(annotation['application-bundle']).toEqual({ example: bundleExample });
    expect(annotation['application-bundle']).not.toHaveProperty('schema');
    expect(annotation['flow-definition']).toEqual({});
    expect(annotation['agent-definition']).toEqual({});
  });

  it('注解之外的参数合同零变化(payload 精确 {}、授权证据注入、键序保留)', () => {
    const tool = createActionTool(structuredClone(annotatedFields) as Record<string, unknown>);
    const parameters = tool.parameters as Record<string, unknown> & {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(JSON.stringify(parameters.properties.payload)).toBe('{}');
    expect(parameters.required).toEqual(['kind', 'payload', 'authorization']);
    expect(parameters.properties.authorization).toMatchObject({ type: 'object' });
    expect(Object.keys(parameters.properties).sort()).toEqual(['authorization', 'kind', 'payload']);
    // 除注解键外,fields 顶层其余键(契约元数据)原样保留。
    expect(parameters.type).toBe(annotatedFields.type);
    expect(parameters.additionalProperties).toBe(false);
  });

  it('无注解动作的投影零变化', () => {
    const fields = {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
      additionalProperties: false,
    };
    const tool = createActionTool(fields);
    const parameters = tool.parameters as Record<string, unknown>;

    expect(parameters).not.toHaveProperty('x-ui4a-payload-schemas');
    expect(parameters).toEqual({
      type: 'object',
      properties: {
        note: { type: 'string' },
        authorization: expect.any(Object),
      },
      required: ['note', 'authorization'],
      additionalProperties: false,
    });
  });

  it('x-ui4a-input-owner 客户端字段剥离在有注解时仍然生效(commandId 不进模型参数)', () => {
    const tool = createActionTool(structuredClone(annotatedFields) as Record<string, unknown>);
    const schema = tool.parameters as { properties: Record<string, unknown> };

    expect(schema.properties.commandId).toBeUndefined();
    expect(JSON.stringify(schema)).not.toMatch(/commandId/);
  });

  it('注解值非 { <kind>: record } 形状(无 kind 条目的宽松分支)原样透传', () => {
    for (const loose of ['preceding-string', 42, null, ['not', 'a', 'record'], {}]) {
      const tool = createActionTool({
        type: 'object',
        properties: {},
        'x-ui4a-payload-schemas': loose,
      });
      expect(tool.parameters).toHaveProperty('x-ui4a-payload-schemas', loose);
    }

    // kind 条目本身非 record:该条目原样,其余条目仍正常剥离。
    const tool = createActionTool({
      type: 'object',
      properties: {},
      'x-ui4a-payload-schemas': {
        'application-bundle': { schema: bundleSchema, example: bundleExample },
        'flow-definition': 'loose-entry',
      },
    });
    const annotation = (tool.parameters as Record<string, unknown>)[
      'x-ui4a-payload-schemas'
    ] as Record<string, unknown>;
    expect(annotation).toEqual({
      'application-bundle': { example: bundleExample },
      'flow-definition': 'loose-entry',
    });
  });

  it('投影是纯函数:源实体动作 fields 的注解不被改写(HTTP 合同仍见全量)', () => {
    const fields = structuredClone(annotatedFields) as Record<string, unknown>;
    createActionTool(fields);
    expect(fields['x-ui4a-payload-schemas']).toEqual(annotatedFields['x-ui4a-payload-schemas']);
  });

  it('认知投影 observation 同一剥离:actions[].fields 的注解含 example 不含 schema', () => {
    const entity = entityWithAction({
      name: 'create',
      title: 'Create Draft',
      method: 'POST',
      href: '/_meta/api/exec',
      fields: structuredClone(annotatedFields) as Record<string, unknown>,
    });
    const sanitized = sanitizeEntity(entity) as {
      actions: { fields: Record<string, unknown> }[];
    };
    const annotation = sanitized.actions[0]!.fields['x-ui4a-payload-schemas'] as Record<
      string,
      unknown
    >;

    expect(annotation['application-bundle']).toEqual({ example: bundleExample });
    expect(annotation['application-bundle']).not.toHaveProperty('schema');
    // 源实体的 HTTP 合同仍携带全量注解。
    expect(entity.actions[0]!.fields['x-ui4a-payload-schemas']).toEqual(
      annotatedFields['x-ui4a-payload-schemas'],
    );
  });
});
