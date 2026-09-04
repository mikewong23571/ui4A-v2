/**
 * application bundle payload 的有界 schema 与最小 example(T50 Phase 1 / D69.2)。
 *
 * 从 parseApplicationBundle 同一合同派生结构层:顶层必填键与类型、bundle 元数据、
 * seed 条目四必填形状、封闭词表 enum(与 shared 常量同源,如 emptyMeaning 的
 * 'ready-to-start');flows[]/nodes[]/applications[] 元素深层保持开放,跨字段引用
 * (flow∈flows、node∈flow、key=rel)不进 schema,交给服务端裁决与 D69.3 结构化
 * 拒绝。example 是可被 parseApplicationBundle 接受的最小合法 bundle。schema 的
 * JSON 序列化尺寸受测试上限约束(嵌入 action 注解时的 prompt 膨胀防线)。
 */
import {
  APPLICATION_ENTRY_ROLES,
  COGNITIVE_SEMANTICS_EMPTY_MEANINGS,
  COGNITIVE_SEMANTICS_GROUP_ROLES,
  COGNITIVE_SEMANTICS_PRIORITIES,
  COGNITIVE_SEMANTICS_TRAITS,
} from '@ui4a/shared';

import { CAPABILITY_KINDS } from '../../core/parse';

import { APPLICATION_BUNDLE_SCHEMA } from './payload-issues';

/** 定义提案合同自披露负载(D69.1 注解值):draft-07 结构层 schema + 最小合法 example。 */
export interface ApplicationBundlePayloadContract {
  schema: Record<string, unknown>;
  example: Record<string, unknown>;
}

const nonEmptyString = { type: 'string', minLength: 1 } as const;

const seedInstance = {
  type: 'object',
  required: ['rel', 'flow', 'node', 'fields'],
  properties: {
    rel: nonEmptyString,
    flow: nonEmptyString,
    node: nonEmptyString,
    fields: { type: 'object' },
  },
} as const;

/** 派生结构层 schema 与 example;同一词表与 parseApplicationBundle 同源。 */
export function applicationBundlePayloadSchema(): ApplicationBundlePayloadContract {
  return {
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'UI4A application bundle payload',
      description:
        '结构层合同:顶层键/类型、bundle 元数据、seed 条目形状与封闭词表;flows/nodes 深层开放,跨字段引用由服务端裁决。',
      type: 'object',
      required: ['schema', 'bundle', 'applications', 'capabilities', 'flows', 'seed'],
      properties: {
        schema: { enum: [APPLICATION_BUNDLE_SCHEMA] },
        bundle: {
          type: 'object',
          required: ['name', 'version'],
          properties: {
            name: nonEmptyString,
            version: { type: 'integer', minimum: 1 },
          },
        },
        applications: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'title', 'intent'],
            properties: {
              name: nonEmptyString,
              title: nonEmptyString,
              intent: nonEmptyString,
              entry: {
                type: 'object',
                required: ['target', 'role'],
                properties: {
                  target: nonEmptyString,
                  role: { enum: [...APPLICATION_ENTRY_ROLES] },
                },
              },
              cognitive: {
                type: 'object',
                required: ['version'],
                properties: {
                  version: { enum: [1] },
                  traits: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 1,
                    items: { enum: ['system-fallback'] },
                  },
                },
              },
            },
          },
        },
        capabilities: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'title', 'kind', 'intent'],
            properties: {
              name: nonEmptyString,
              title: nonEmptyString,
              intent: nonEmptyString,
              kind: { enum: [...CAPABILITY_KINDS] },
            },
          },
        },
        flows: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'initial', 'nodes'],
            properties: {
              name: nonEmptyString,
              initial: nonEmptyString,
              app: { type: 'string' },
              nodes: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['name', 'actions'],
                  properties: {
                    name: nonEmptyString,
                    actions: { type: 'array' },
                  },
                },
              },
              cognitive: { $ref: '#/definitions/cognitive' },
            },
          },
        },
        seed: {
          type: 'object',
          required: ['rel', 'detail'],
          properties: {
            rel: nonEmptyString,
            detail: {
              type: 'object',
              required: ['instances'],
              properties: {
                instances: {
                  type: 'object',
                  description:
                    '实例快照表;key 必须等于条目自身的 rel(schema 不编码跨字段约束,由服务端裁决)。',
                  additionalProperties: seedInstance,
                },
                collections: {
                  type: 'object',
                  additionalProperties: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      definitions: {
        cognitive: {
          type: 'object',
          required: ['version'],
          properties: {
            version: { enum: [1] },
            traits: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { enum: [...COGNITIVE_SEMANTICS_TRAITS] },
            },
            groupRole: { enum: [...COGNITIVE_SEMANTICS_GROUP_ROLES] },
            priority: { enum: [...COGNITIVE_SEMANTICS_PRIORITIES] },
            emptyMeaning: { enum: [...COGNITIVE_SEMANTICS_EMPTY_MEANINGS] },
          },
        },
      },
    },
    example: {
      schema: APPLICATION_BUNDLE_SCHEMA,
      bundle: { name: 'example-bundle', version: 1 },
      applications: [
        {
          name: 'example-bundle',
          title: 'Example',
          intent: 'Demonstrate the application bundle payload contract',
        },
      ],
      capabilities: [],
      flows: [
        {
          name: 'example-entry',
          title: 'Example entry',
          app: 'example-bundle',
          initial: 'start',
          nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
          fields: [],
        },
      ],
      seed: {
        rel: 'seed:example-bundle',
        detail: {
          instances: {
            'example-entry:first': {
              rel: 'example-entry:first',
              flow: 'example-entry',
              node: 'start',
              fields: {},
            },
          },
        },
      },
    },
  };
}
