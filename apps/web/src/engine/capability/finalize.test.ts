import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readReceipt: vi.fn(),
  commit: vi.fn(),
  readSpawn: vi.fn(),
  getEngine: vi.fn(),
}));
vi.mock('@ui4a/db/function-receipts', () => ({
  readNativeFunctionReceipt: mocks.readReceipt,
  commitNativeFunctionFinalization: mocks.commit,
}));
vi.mock('./reconciliation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readPersistedNativeFunctionSpawn: mocks.readSpawn,
}));
vi.mock('../service', () => ({ getEngine: mocks.getEngine }));

import type { EngineSnapshot, FlowDefinition, NativeFunctionOutcomeV1 } from '@ui4a/shared';
import { hashCanonicalAgentJson } from '@ui4a/engine';

import {
  nativeFunctionExecutionIdentity,
  nativeFunctionInvocation,
  type PreparedNativeFunctionDispatch,
} from './dispatch';
import { finalizeNativeFunctionSource } from './finalize';

const inputSchema = { type: 'object', properties: { cveId: { type: 'string' } } };
const outputSchema = {
  type: 'object',
  required: ['severity'],
  properties: { severity: { type: 'string' } },
};
const input = { cveId: 'CVE-2026-0001' };
const flow: FlowDefinition = {
  name: 'cve-enrichment',
  app: 'security',
  initial: 'enriching',
  nodes: [
    {
      name: 'enriching',
      actions: [
        {
          name: 'enrichment-succeeded',
          title: 'Succeeded',
          to: 'enriched',
          internal: 'capability-callback',
          fields: [
            { name: 'executionId', type: 'text', persist: false },
            { name: 'result', type: 'json', persist: false },
            { name: 'receipt', type: 'json', persist: false },
          ],
        },
        {
          name: 'enrichment-failed',
          title: 'Failed',
          to: 'failed',
          internal: 'capability-callback',
          fields: [
            { name: 'executionId', type: 'text', persist: false },
            { name: 'failure', type: 'json', persist: false },
          ],
        },
      ],
    },
    { name: 'enriched', actions: [] },
    { name: 'failed', actions: [] },
  ],
};
const prepared: PreparedNativeFunctionDispatch = {
  event: {
    kind: 'spawn-requested',
    rel: 'cve:CVE-2026-0001',
    action: 'enrich-impact',
    actor: 'human',
    principal: 'user:mike',
    capability: 'cve.enrich',
    'on-done': 'enrichment-succeeded',
    'on-error': 'enrichment-failed',
  },
  source: {
    rel: 'cve:CVE-2026-0001',
    action: 'enrich-impact',
    principal: 'user:mike',
    policyScope: 'security',
  },
  profile: {
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
      inputBytes: 16_384,
      outputBytes: 32_768,
    },
    network: 'denied',
  },
  birth: {
    capability: { name: 'cve.enrich', hash: hashCanonicalAgentJson({ name: 'cve.enrich' }) },
    profile: {
      ref: 'security-enrichment-default',
      version: '1',
      handlerRef: 'security/cve-enrich@1',
      adapterVersion: 'native-function@1',
    },
    inputContract: { hash: hashCanonicalAgentJson(inputSchema), schema: inputSchema },
    outputContract: { hash: hashCanonicalAgentJson(outputSchema), schema: outputSchema },
  },
  callback: { onDoneAction: 'enrichment-succeeded', onErrorAction: 'enrichment-failed' },
  input: {
    payload: input,
    sources: {},
    hash: hashCanonicalAgentJson(input),
    byteLength: 25,
  },
};

function snapshot(node = 'enriching'): EngineSnapshot {
  return {
    instances: {
      'cve:CVE-2026-0001': {
        rel: 'cve:CVE-2026-0001',
        flow: flow.name,
        node,
        fields: {},
        bornVersion: 1,
      },
    },
    collections: {},
    definitions: {
      [flow.name]: { name: flow.name, version: 1, status: 'active', definition: flow },
    },
    definitionVersions: {
      [flow.name]: { 1: flow },
    },
  };
}

function outcome(): Extract<NativeFunctionOutcomeV1, { status: 'succeeded' }> {
  const output = { severity: 'high' };
  return {
    schemaVersion: 1,
    status: 'succeeded',
    output,
    outputHash: hashCanonicalAgentJson(output),
    outputByteLength: 19,
    evidenceRefs: ['evidence:catalog'],
    attempt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readReceipt.mockResolvedValue(undefined);
  mocks.readSpawn.mockResolvedValue({ seq: 42, prepared });
  const engine = {
    getSnapshot: vi.fn(() => snapshot()),
    runExclusive: vi.fn(async (run: () => Promise<unknown>) => run()),
  };
  mocks.getEngine.mockResolvedValue(engine);
  mocks.commit.mockImplementation(async (_db, value) => ({
    deduplicated: false,
    receipt: value.receipt,
    coreSeqs: [44],
  }));
});

describe('Native Function governed finalization', () => {
  it('revalidates success and commits effect-origin callback events with the receipt', async () => {
    const identity = nativeFunctionExecutionIdentity(42, prepared);
    const invocation = nativeFunctionInvocation(42, prepared);
    const result = await finalizeNativeFunctionSource(
      { query: vi.fn() },
      {
        schemaVersion: 1,
        executionId: identity.executionId,
        sourceEventId: 'core:42',
        invocationHash: hashCanonicalAgentJson(invocation as never),
        outcome: outcome(),
      },
    );
    expect(result).toMatchObject({ ok: true, deduplicated: false });
    const committed = mocks.commit.mock.calls[0]![1];
    expect(committed.receipt.callback.outcome).toBe('accepted');
    expect(committed.coreEvents[0].params).toMatchObject({
      executionId: { value: identity.executionId, origin: 'effect' },
      result: { value: { severity: 'high' }, origin: 'effect' },
    });
  });

  it('rejects forged birth identity and invalid output without committing', async () => {
    const identity = nativeFunctionExecutionIdentity(42, prepared);
    await expect(
      finalizeNativeFunctionSource(
        { query: vi.fn() },
        {
          schemaVersion: 1,
          executionId: identity.executionId,
          sourceEventId: 'core:42',
          invocationHash: `sha256:${'f'.repeat(64)}`,
          outcome: outcome(),
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'birth-mismatch' });
    await expect(
      finalizeNativeFunctionSource(
        { query: vi.fn() },
        {
          schemaVersion: 1,
          executionId: identity.executionId,
          sourceEventId: 'core:42',
          invocationHash: hashCanonicalAgentJson(nativeFunctionInvocation(42, prepared) as never),
          outcome: { ...outcome(), outputHash: `sha256:${'f'.repeat(64)}` },
        },
      ),
    ).resolves.toMatchObject({ ok: true, deduplicated: false });
    expect(mocks.commit.mock.calls[0]![1]).toMatchObject({
      receipt: { outcome: { status: 'failed', failure: { code: 'output-invalid' } } },
      coreEvents: [
        expect.objectContaining({
          action: 'enrichment-failed',
          params: expect.objectContaining({ failure: expect.objectContaining({ origin: 'effect' }) }),
        }),
      ],
    });
  });

  it('records a stale guard rejection without overwriting current business state', async () => {
    const engine = await mocks.getEngine();
    engine.getSnapshot.mockReturnValue(snapshot('enriched'));
    const identity = nativeFunctionExecutionIdentity(42, prepared);
    const result = await finalizeNativeFunctionSource(
      { query: vi.fn() },
      {
        schemaVersion: 1,
        executionId: identity.executionId,
        sourceEventId: 'core:42',
        invocationHash: hashCanonicalAgentJson(nativeFunctionInvocation(42, prepared) as never),
        outcome: outcome(),
      },
    );
    expect(result).toMatchObject({ ok: false, code: 'callback-stale' });
    expect(mocks.commit.mock.calls[0]![1].coreEvents[0]).toMatchObject({
      kind: 'action-rejected',
    });
  });

  it('rechecks a concurrent terminal receipt inside the engine queue before judgment', async () => {
    const identity = nativeFunctionExecutionIdentity(42, prepared);
    const invocationHash = hashCanonicalAgentJson(nativeFunctionInvocation(42, prepared) as never);
    const terminal = {
      schemaVersion: 1 as const,
      executionId: identity.executionId,
      sourceEventId: 'core:42' as const,
      invocationHash,
      capability: prepared.birth.capability,
      profile: prepared.birth.profile,
      inputHash: prepared.input.hash,
      outcome: outcome(),
      callback: {
        commandId: `function-finalize:${identity.executionId}`,
        action: 'enrichment-succeeded',
        outcome: 'accepted' as const,
      },
    };
    mocks.readReceipt.mockResolvedValueOnce(undefined).mockResolvedValueOnce(terminal);

    await expect(
      finalizeNativeFunctionSource(
        { query: vi.fn() },
        {
          schemaVersion: 1,
          executionId: identity.executionId,
          sourceEventId: 'core:42',
          invocationHash,
          outcome: outcome(),
        },
      ),
    ).resolves.toMatchObject({ ok: true, deduplicated: true });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
