import { clientActionPropertyNames, type SirenAction, type SirenEntity } from '@ui4a/engine';
import type { EffectAuthorization } from '../types';

function commandKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}

/** One run owns submission identity; only the HTTP server adjudicates/replays effects. */
export function createClientActionParams() {
  const submissions = new Map<string, Record<string, unknown>>();
  return (
    action: SirenAction,
    entity: SirenEntity,
    callerParams: Record<string, unknown>,
    authorization?: EffectAuthorization,
  ): Record<string, unknown> => {
    const owned = new Set(clientActionPropertyNames(action.fields));
    if (!owned.has('commandId')) return withObservedClientParams(action, entity, callerParams);
    const input = Object.fromEntries(
      Object.entries(callerParams).filter(([name]) => !owned.has(name)),
    );
    const key = commandKey({
      rel: entity.properties.rel,
      action: action.name,
      sourceMessageId: authorization?.sourceMessageId,
      params: input,
    });
    const existing = submissions.get(key);
    if (existing !== undefined) return structuredClone(existing);
    const params = withObservedClientParams(action, entity, input);
    submissions.set(key, structuredClone(params));
    return params;
  };
}

/**
 * Inject the fixed trusted-host values declared client-owned by the current action contract.
 * Unknown client properties are left absent so the server's full schema rejects them honestly.
 */
export function withObservedClientParams(
  action: SirenAction,
  entity: SirenEntity,
  callerParams: Record<string, unknown>,
): Record<string, unknown> {
  const names = new Set(clientActionPropertyNames(action.fields));
  const params = { ...callerParams };
  if (names.has('commandId')) params.commandId = crypto.randomUUID();
  if (names.has('baseVersion') && Number.isInteger(entity.properties.version)) {
    params.baseVersion = entity.properties.version;
  }
  return params;
}
