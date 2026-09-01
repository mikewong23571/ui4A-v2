import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatchNativeFunction } = vi.hoisted(() => ({
  dispatchNativeFunction: vi.fn<(input: { invocation: unknown }) => Promise<void>>(
    async () => undefined,
  ),
}));
vi.mock('../../temporal/native-function', () => ({ dispatchNativeFunction }));

import type { CapabilityDefinition, NativeFunctionProfileV1 } from '@ui4a/shared';
import { appendEvent, ensureEventsTable } from '@ui4a/db/events';
import { commitNativeFunctionFinalization } from '@ui4a/db/function-receipts';
import { getPool } from '@ui4a/db/pool';
import { hashCanonicalAgentJson } from '@ui4a/engine';

import {
  nativeFunctionExecutionIdentity,
  prepareCapabilityDispatch,
  preparedNativeFunctionDetail,
} from './dispatch';
import { reconcilePersistedNativeFunctions } from './reconciliation';

const pool = getPool(process.env.DATABASE_URL!);
const profile: NativeFunctionProfileV1 = {
  schemaVersion: 1,
  ref: 'security-enrichment-default',
  version: '1',
  executorClass: 'native-function',
  handlerRef: 'security/cve-enrich@1',
  adapterVersion: 'native-function@1',
  availability: { status: 'available' },
  limits: {
    startToCloseTimeoutMs: 30_000,
    maximumAttempts: 3,
    inputBytes: 4096,
    outputBytes: 4096,
  },
  network: 'denied',
};
const capability: CapabilityDefinition = {
  name: 'cve.enrich',
  title: 'Enrich',
  kind: 'extract',
  intent: 'Enrich one CVE.',
  inputSchema: { type: 'object', required: ['cveId'], properties: { cveId: { type: 'string' } } },
  outputSchema: { type: 'object' },
  executor: { class: 'native-function', profile: profile.ref },
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  dispatchNativeFunction.mockClear();
});

describe('Native Function persisted spawn outbox', () => {
  it('starts an orphan once and excludes it after a terminal receipt', async () => {
    const event = {
      kind: 'spawn-requested' as const,
      rel: 'cve:CVE-2026-0001',
      action: 'enrich-impact',
      actor: 'human' as const,
      principal: 'user:mike',
      capability: capability.name,
      bind: {
        schemaVersion: 1,
        fields: { cveId: { from: 'source-field', name: 'cveId' } },
      },
      'on-done': 'enrichment-succeeded',
      'on-error': 'enrichment-failed',
    };
    const dispatch = await prepareCapabilityDispatch(
      {
        event,
        capability,
        principal: 'user:mike',
        policyScope: 'security',
        actionParams: {},
        source: {
          rel: event.rel,
          fields: { cveId: { value: 'CVE-2026-0001', origin: 'default' } },
        },
        artifacts: {},
      },
      { prepareAgent: vi.fn(), nativeFunctionProfiles: new Map([[profile.ref, profile]]) },
    );
    if (dispatch.kind !== 'native-function') throw new Error('wrong executor');
    const persisted = await appendEvent(pool, {
      domain: 'core',
      kind: 'spawn-requested',
      rel: event.rel,
      action: event.action,
      actor: event.actor,
      principal: event.principal,
      detail: {
        capability: event.capability,
        bind: event.bind,
        'on-done': event['on-done'],
        'on-error': event['on-error'],
        nativeFunction: preparedNativeFunctionDetail(dispatch.prepared),
      },
    });
    const first = await reconcilePersistedNativeFunctions(pool);
    expect(first.started).toHaveLength(1);
    expect(dispatchNativeFunction).toHaveBeenCalledOnce();

    const identity = nativeFunctionExecutionIdentity(persisted.seq, dispatch.prepared);
    const outcome = {
      schemaVersion: 1 as const,
      status: 'failed' as const,
      failure: { code: 'fixture', reason: 'fixture', retryable: false },
      attempt: 1,
    };
    await commitNativeFunctionFinalization(pool, {
      receipt: {
        schemaVersion: 1,
        executionId: identity.executionId,
        sourceEventId: `core:${persisted.seq}`,
        invocationHash: hashCanonicalAgentJson(
          dispatchNativeFunction.mock.calls[0]![0].invocation as never,
        ),
        capability: dispatch.prepared.birth.capability,
        profile: dispatch.prepared.birth.profile,
        inputHash: dispatch.prepared.input.hash,
        outcome,
        callback: {
          commandId: `function-finalize:${identity.executionId}`,
          action: dispatch.prepared.callback.onErrorAction,
          outcome: 'accepted',
        },
      },
      sourceRel: event.rel,
      coreEvents: [],
    });
    dispatchNativeFunction.mockClear();
    await expect(reconcilePersistedNativeFunctions(pool)).resolves.toEqual({ started: [] });
    expect(dispatchNativeFunction).not.toHaveBeenCalled();
  });
});
