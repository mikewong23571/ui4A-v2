import { clientActionPropertyNames, type SirenAction, type SirenEntity } from '@ui4a/engine';

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
