import type {
  NativeFunctionCallbackClaimV1,
  NativeFunctionOutcomeV1,
  NativeFunctionReceiptV1,
} from '@ui4a/shared';
import {
  activeDefinitionOf,
  actionRejectedEvent,
  assertCapabilityPayload,
  canonicalAgentJson,
  executeWithGates,
  hashCanonicalAgentJson,
  type EngineEvent,
  type ExecRequest,
} from '@ui4a/engine';
import { seedGuardRegistry } from '@ui4a/shared';
import type { DbExecutor } from '@ui4a/db/events';
import {
  commitNativeFunctionFinalization,
  readNativeFunctionReceipt,
} from '@ui4a/db/function-receipts';

import { cedarPolicyFromDefaultFile } from '../../domain/cedarPolicy';
import { getEngine } from '../service';
import { engineEventToAppend } from '../service-event-append';
import { nativeFunctionExecutionIdentity, nativeFunctionInvocation } from './dispatch';
import { readPersistedNativeFunctionSpawn } from './reconciliation';

export type NativeFunctionFinalizeResult =
  | { ok: true; deduplicated: boolean; callback: NativeFunctionReceiptV1['callback'] }
  | { ok: false; status: 404 | 409 | 422; code: string; reason: string };

function sourceSeq(sourceEventId: string): number | undefined {
  const match = /^core:([1-9][0-9]*)$/.exec(sourceEventId);
  return match === null ? undefined : Number(match[1]);
}

function sameClaim(
  receipt: NativeFunctionReceiptV1,
  claim: NativeFunctionCallbackClaimV1,
): boolean {
  return (
    receipt.invocationHash === claim.invocationHash &&
    canonicalAgentJson(receipt.outcome as never) === canonicalAgentJson(claim.outcome as never)
  );
}

function validatedOutcome(
  outcome: NativeFunctionOutcomeV1,
  prepared: NonNullable<Awaited<ReturnType<typeof readPersistedNativeFunctionSpawn>>>['prepared'],
): NativeFunctionOutcomeV1 {
  if (outcome.status !== 'succeeded') return outcome;
  const canonical = canonicalAgentJson(outcome.output as never);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (
    bytes !== outcome.outputByteLength ||
    bytes > prepared.profile.limits.outputBytes ||
    hashCanonicalAgentJson(outcome.output as never) !== outcome.outputHash
  ) {
    throw new Error('function output hash or byte length is invalid');
  }
  assertCapabilityPayload(
    prepared.birth.outputContract.schema,
    outcome.output,
    'native function callback output',
  );
  return outcome;
}

function callbackRequest(
  executionId: string,
  outcome: NativeFunctionOutcomeV1,
  prepared: NonNullable<Awaited<ReturnType<typeof readPersistedNativeFunctionSpawn>>>['prepared'],
): ExecRequest {
  const succeeded = outcome.status === 'succeeded';
  const params = succeeded
    ? {
        executionId,
        result: outcome.output,
        receipt: { outputHash: outcome.outputHash, evidenceRefs: outcome.evidenceRefs },
      }
    : {
        executionId,
        failure:
          outcome.status === 'failed'
            ? outcome.failure
            : { code: 'cancelled', reason: outcome.reason, retryable: false },
      };
  return {
    rel: prepared.source.rel,
    action: succeeded ? prepared.callback.onDoneAction : prepared.callback.onErrorAction,
    actor: 'agent',
    principal: `system:capability:${executionId}`,
    channel: 'native-function-callback',
    params,
    paramOrigins: Object.fromEntries(Object.keys(params).map((name) => [name, 'effect'])),
  };
}

/** Revalidate one terminal claim and atomically append its receipt plus governed callback events. */
export async function finalizeNativeFunctionSource(
  db: DbExecutor,
  claim: NativeFunctionCallbackClaimV1,
): Promise<NativeFunctionFinalizeResult> {
  const seq = sourceSeq(claim.sourceEventId);
  if (seq === undefined) {
    return {
      ok: false,
      status: 422,
      code: 'source-event-invalid',
      reason: 'source event is invalid',
    };
  }
  const existing = await readNativeFunctionReceipt(db, claim.executionId);
  if (existing !== undefined) {
    return sameClaim(existing, claim)
      ? { ok: true, deduplicated: true, callback: existing.callback }
      : {
          ok: false,
          status: 409,
          code: 'idempotency-collision',
          reason: 'terminal claim differs from the committed receipt',
        };
  }
  const spawn = await readPersistedNativeFunctionSpawn(db, seq);
  if (spawn === undefined) {
    return { ok: false, status: 404, code: 'spawn-not-found', reason: 'source spawn not found' };
  }
  const identity = nativeFunctionExecutionIdentity(spawn.seq, spawn.prepared);
  const invocation = nativeFunctionInvocation(spawn.seq, spawn.prepared);
  if (
    identity.executionId !== claim.executionId ||
    hashCanonicalAgentJson(invocation as never) !== claim.invocationHash
  ) {
    return {
      ok: false,
      status: 409,
      code: 'birth-mismatch',
      reason: 'callback identity does not match the persisted spawn',
    };
  }
  let outcome: NativeFunctionOutcomeV1;
  try {
    outcome = validatedOutcome(claim.outcome, spawn.prepared);
  } catch (error) {
    return {
      ok: false,
      status: 422,
      code: 'output-invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const engine = await getEngine(db);
  return engine.runExclusive(async () => {
    const snapshot = engine.getSnapshot();
    const flows = Object.fromEntries(
      Object.keys(snapshot.definitions ?? {}).flatMap((name) => {
        const flow = activeDefinitionOf(snapshot, name);
        return flow === undefined ? [] : [[flow.name, flow]];
      }),
    );
    const request = callbackRequest(claim.executionId, outcome, spawn.prepared);
    const judged = executeWithGates(request, snapshot, {
      flows,
      versions: snapshot.definitionVersions ?? {},
      guards: seedGuardRegistry,
      policy: cedarPolicyFromDefaultFile(),
    });
    let events: EngineEvent[];
    let callback: NativeFunctionReceiptV1['callback'];
    if (judged.kind === 'rejected') {
      events = [actionRejectedEvent(request, judged)];
      callback = {
        commandId: `function-finalize:${claim.executionId}`,
        action: request.action,
        outcome: 'rejected',
        reason: judged.reason,
      };
    } else {
      events = judged.events;
      callback = {
        commandId: `function-finalize:${claim.executionId}`,
        action: request.action,
        outcome: judged.kind === 'executed' ? 'accepted' : 'suspended',
        ...(judged.kind === 'suspended' ? { reason: 'callback requires confirmation' } : {}),
      };
    }
    const receipt: NativeFunctionReceiptV1 = {
      schemaVersion: 1,
      executionId: claim.executionId,
      sourceEventId: claim.sourceEventId,
      invocationHash: claim.invocationHash,
      capability: spawn.prepared.birth.capability,
      profile: spawn.prepared.birth.profile,
      inputHash: spawn.prepared.input.hash,
      outcome,
      callback,
    };
    const committed = await commitNativeFunctionFinalization(db, {
      receipt,
      coreEvents: events.map((event) => engineEventToAppend(event)),
    });
    if (committed.deduplicated) {
      return { ok: true, deduplicated: true, callback: committed.receipt.callback };
    }
    return callback.outcome === 'accepted'
      ? { ok: true, deduplicated: false, callback }
      : {
          ok: false,
          status: 409,
          code: callback.outcome === 'rejected' ? 'callback-stale' : 'callback-suspended',
          reason: callback.reason ?? 'callback was not accepted',
        };
  });
}
