/**
 * Siren 实体构件:href 拼装、action 声明 → Siren action、guard-results 求值。
 * 投影口径:guard 以空参数求值;真正裁决以 exec 时的 guard 层为准(拒绝即教育)。
 */
import type { EngineSnapshot, GuardRegistry } from '@ui4a/shared';

import { GUARD_HINTS } from '@ui4a/shared';

import { evaluateGuards } from '../../execution/judge';
import { fieldDefinitionsToJsonSchema, mergeFieldDefinitions } from '../schema';
import type { ActionDefinition, FieldDefinition } from '../../core/types';
import type { GuardResultEntry, SirenAction, SirenFieldPresentation } from './types';

export function fallbackPresentationRole(
  fieldName: string,
): NonNullable<FieldDefinition['presentation']>['role'] {
  const normalized = fieldName.toLowerCase();
  if (['title', 'name', 'label', 'identity'].includes(normalized)) return 'identity';
  if (['body', 'content', 'description', 'summary'].includes(normalized)) {
    return 'primary-content';
  }
  if (['status', 'state'].includes(normalized)) return 'status';
  return 'metadata';
}

export function entityHref(base: string | undefined, rel: string): string {
  return `${base ?? ''}/api/entity?rel=${rel}`;
}

function execHref(base: string | undefined): string {
  return `${base ?? ''}/api/exec`;
}

export function toSirenAction(
  action: ActionDefinition,
  nodeFields: readonly FieldDefinition[],
  base: string | undefined,
): SirenAction {
  const collectedNodeFields = action['collect-node-fields'] === false ? [] : nodeFields;
  const sirenAction: SirenAction = {
    name: action.name,
    title: action.title,
    method: action.method ?? 'POST',
    href: execHref(base),
    fields: fieldDefinitionsToJsonSchema(
      mergeFieldDefinitions(collectedNodeFields, action.fields ?? []),
    ),
  };
  if (action['requires-confirmation'] !== undefined) {
    sirenAction['requires-confirmation'] = action['requires-confirmation'];
  }
  if (action.submission !== undefined) sirenAction.submission = action.submission;
  return sirenAction;
}

export function guardResultsFor(
  actions: readonly ActionDefinition[],
  instance: EngineSnapshot['instances'][string],
  snapshot: EngineSnapshot,
  guards: GuardRegistry,
): GuardResultEntry[] {
  return actions.map((action) => {
    const evaluations = evaluateGuards(action, instance, snapshot, {}, guards);
    const failed = evaluations.filter((evaluation) => !evaluation.pass);
    const entry: GuardResultEntry = {
      action: action.name,
      blocked: failed.length > 0,
      guards: evaluations,
    };
    if (failed.length > 0) {
      entry.reason = guardBlockReason(failed);
    }
    return entry;
  });
}

/**
 * D-5/F-10:被拒守卫的 reason 组合——人话主句(合同数据 GUARD_HINTS)+ 机器
 * 表达式审计括号;未登记守卫(应用域自定义)整体回退机器串(零发明)。
 */
export function guardBlockReason(failed: readonly { name: string }[]): string {
  const machine = `guard 不满足: ${failed.map((f) => `${f.name}=false`).join(', ')}`;
  const hints = failed
    .map((f) => GUARD_HINTS[f.name])
    .filter((hint): hint is string => hint !== undefined);
  return hints.length > 0 ? `${hints.join(';')}(${machine})` : machine;
}

/** 实例字段的 presentation 视图(声明优先,未声明按名字回退角色)。 */
export function fieldPresentationsOf(
  fieldDefinitions: readonly FieldDefinition[],
  fields: Record<string, unknown>,
): SirenFieldPresentation[] {
  const definitionsByName = new Map(fieldDefinitions.map((field) => [field.name, field]));
  const names = [
    ...fieldDefinitions.map((field) => field.name),
    ...Object.keys(fields).filter((name) => !definitionsByName.has(name)),
  ];
  return names.map((name) => {
    const field = definitionsByName.get(name);
    return {
      path: `properties.fields.${name}`,
      title: field?.title ?? name,
      role: field?.presentation?.role ?? fallbackPresentationRole(name),
      ...(field?.contentMediaType === undefined
        ? {}
        : { contentMediaType: field.contentMediaType }),
    };
  });
}
