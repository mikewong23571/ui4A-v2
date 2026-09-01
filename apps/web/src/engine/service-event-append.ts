import type { EngineEvent, ExecRequest } from '@ui4a/engine';
import type { EventAppend } from '@ui4a/db/events';

import {
  preparedNativeFunctionDetail,
  type PreparedCapabilityDispatch,
} from './capability/dispatch';
import type { PreparedNativeAgentDispatch } from './agent/native-agent-dispatch';

function withIdentityAudit(detail: unknown, identity: ExecRequest['identity']): unknown {
  if (identity === undefined) return detail;
  const base =
    typeof detail === 'object' && detail !== null && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : detail === undefined
        ? {}
        : { value: detail };
  return { ...base, identity };
}

/** Project one pure Engine event into its append-only storage shape. */
export function engineEventToAppend(
  event: EngineEvent,
  prepared?: PreparedCapabilityDispatch<PreparedNativeAgentDispatch>,
): EventAppend {
  const eventDetail =
    event.kind === 'spawn-requested'
      ? {
          capability: event.capability,
          ...(event.bind !== undefined ? { bind: event.bind } : {}),
          ...(event['on-done'] !== undefined ? { 'on-done': event['on-done'] } : {}),
          ...(event['on-error'] !== undefined ? { 'on-error': event['on-error'] } : {}),
          ...(prepared?.kind === 'native-function'
            ? { nativeFunction: preparedNativeFunctionDetail(prepared.prepared) }
            : {}),
        }
      : event.detail;
  return {
    kind: event.kind,
    rel: event.rel,
    action: event.action,
    actor: event.actor,
    principal: event.principal,
    channel: event.channel,
    params: event.params,
    detail: withIdentityAudit(eventDetail, event.identity),
    reason: event.reason,
  };
}
