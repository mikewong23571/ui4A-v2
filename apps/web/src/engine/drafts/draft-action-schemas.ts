/**
 * Draft 动作合同装配(T50 Phase 3 / D69.1;自 views.ts 沿功能边界拆出)。
 *
 * meta/drafts 的 create/revise 动作在此装配,并自披露 payload schema 注解
 * `x-ui4a-payload-schemas`(值 { <kind>: { schema, example? } }):同一扇门,
 * 两个读者——模型/CLI 经动作字段序列化读到 kind 级结构层合同;RJSF 忽略
 * 未知关键字,人类表单零退化。
 *
 * 注解挂 fields 顶层 x- 描述符而非 payload 属性内部(type 同级):payload
 * 属性必须保持精确 {} 宽松形状——它是表单 JSON textarea 投影
 * (actions/action-json-fields 的 isJsonProjectionField 只认精确 {} 与显式
 * array/object type)与宽松裁决的依据;字段级挂法会使投影启发不再命中、
 * RJSF 对无 type 属性走 FallbackField,payload 控件整个消失(承重墙证据:
 * renderers/draft-payload-annotation.test.tsx)。application-bundle 分支与
 * engine 派生(applicationBundlePayloadSchema)同源;flow/agent 分支保持
 * 现状宽松({schema:{}},无 example 键),不造新真相。
 */
import { applicationBundlePayloadSchema, type SirenAction } from '@ui4a/engine';
import type { DraftAggregate } from '@ui4a/shared';

export function schema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

export function action(
  name: string,
  title: string,
  fields: Record<string, unknown>,
  risk?: SirenAction['requires-confirmation'],
): SirenAction {
  return {
    name,
    title,
    method: 'POST',
    href: '/_meta/api/exec',
    fields,
    ...(risk === undefined ? {} : { 'requires-confirmation': risk }),
  };
}

export const COMMAND_ID = {
  type: 'string',
  minLength: 1,
  description: 'Idempotency key',
  'x-ui4a-input-owner': 'client',
};

/** D69.1 注解值:kind → { schema, example? };宽松分支省略 example 键。 */
export function draftPayloadSchemasAnnotation(): Record<string, unknown> {
  const bundle = applicationBundlePayloadSchema();
  return {
    'application-bundle': { schema: bundle.schema, example: bundle.example },
    'flow-definition': { schema: {} },
    'agent-definition': { schema: {} },
  };
}

/** payload 承载动作的 fields:顶层挂注解,payload 属性本体保持精确 {}。 */
function annotatedPayloadFields(
  properties: Record<string, Record<string, unknown>>,
  required: string[],
): Record<string, unknown> {
  return {
    ...schema(properties, required),
    'x-ui4a-payload-schemas': draftPayloadSchemasAnnotation(),
  };
}

export function draftReviseAction(): SirenAction {
  return action(
    'revise',
    'Revise Draft',
    annotatedPayloadFields(
      {
        commandId: COMMAND_ID,
        baseVersion: {
          type: 'integer',
          minimum: 1,
          'x-ui4a-input-owner': 'client',
        },
        targetBaseVersion: { type: 'string' },
        payload: {},
      },
      ['commandId', 'baseVersion', 'payload'],
    ),
  );
}

export function draftCreateAction(): SirenAction {
  return action(
    'create',
    'Create Draft',
    annotatedPayloadFields(
      {
        kind: {
          type: 'string',
          enum: ['flow-definition', 'agent-definition', 'application-bundle'],
        },
        target: { type: 'string', minLength: 1 },
        commandId: COMMAND_ID,
        payload: {},
        sources: { type: 'array', items: { type: 'string' }, maxItems: 64 },
      },
      ['kind', 'target', 'commandId', 'payload'],
    ),
  );
}

export function draftActions(aggregate: DraftAggregate): SirenAction[] {
  if (['accepted', 'rejected', 'abandoned', 'expired'].includes(aggregate.status)) return [];
  if (aggregate.status === 'pending-approval') return [];
  const revise = draftReviseAction();
  const validate = action(
    'validate',
    'Validate Draft',
    schema({ commandId: COMMAND_ID }, ['commandId']),
  );
  const abandon = action(
    'abandon',
    'Abandon Draft',
    schema({ commandId: COMMAND_ID, reason: { type: 'string' } }, ['commandId']),
  );
  if (aggregate.status === 'ready') {
    return [
      revise,
      validate,
      action('diff', 'Read Mechanical Diff', schema({})),
      action('submit', 'Submit for Approval', schema({ commandId: COMMAND_ID }, ['commandId'])),
      abandon,
    ];
  }
  return [revise, validate, action('diff', 'Read Mechanical Diff', schema({})), abandon];
}

export function activationActions(): SirenAction[] {
  return [
    action('approve', 'Approve', schema({ commandId: COMMAND_ID }, ['commandId']), 'high'),
    action(
      'reject',
      'Reject',
      schema({ commandId: COMMAND_ID, reason: { type: 'string', minLength: 1 } }, [
        'commandId',
        'reason',
      ]),
      'high',
    ),
  ];
}
