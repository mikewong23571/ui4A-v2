import { describe, expect, it, vi } from 'vitest';

import type { CapabilityDefinition, NativeFunctionProfileV1 } from '@ui4a/shared';
import type { EngineEvent } from '@ui4a/engine';

import {
  nativeFunctionExecutionIdentity,
  prepareCapabilityDispatch,
  reconcileNativeFunctionSpawns,
  startPersistedCapabilityDispatch,
  type NativeFunctionStartInput,
} from './dispatch';

const hash = `sha256:${'a'.repeat(64)}` as const;
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
    inputBytes: 16_384,
    outputBytes: 32_768,
  },
  network: 'denied',
};

function spawnEvent(capability = 'cve.enrich'): EngineEvent {
  return {
    kind: 'spawn-requested',
    rel: 'cve:CVE-2026-0001',
    action: 'enrich-impact',
    actor: 'human',
    principal: 'user:mike',
    capability,
    bind: {
      schemaVersion: 1,
      fields: { cveId: { from: 'source-field', name: 'cveId' } },
    },
    'on-done': 'enrichment-succeeded',
    'on-error': 'enrichment-failed',
  };
}

function functionCapability(overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    name: 'cve.enrich',
    title: 'Enrich CVE',
    kind: 'extract',
    intent: 'Return reference impact data.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['cveId'],
      properties: { cveId: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    executor: { class: 'native-function', profile: profile.ref },
    ...overrides,
  };
}

function input(capability = functionCapability()) {
  return {
    event: spawnEvent(capability.name),
    capability,
    principal: 'user:mike',
    policyScope: 'security',
    actionParams: {},
    source: {
      rel: 'cve:CVE-2026-0001',
      fields: { cveId: { value: 'CVE-2026-0001', origin: 'default' as const } },
    },
    artifacts: {},
  };
}

describe('Capability executor dispatch composition', () => {
  it('keeps capabilities with an exact Agent Definition on the existing Agent path', async () => {
    const prepareAgent = vi.fn(async () => ({ marker: 'agent-prepared' }));
    const capability = functionCapability({
      executor: {
        class: 'coding-agent',
        profile: 'codex-default',
        agentDefinition: 'coding-agent@1',
      },
    });
    await expect(
      prepareCapabilityDispatch(input(capability), {
        prepareAgent,
        nativeFunctionProfiles: new Map(),
      }),
    ).resolves.toEqual({ kind: 'agent', prepared: { marker: 'agent-prepared' } });
    expect(prepareAgent).toHaveBeenCalledOnce();
  });

  it('prepares a sealed Function birth without using capability or Application names for routing', async () => {
    const prepared = await prepareCapabilityDispatch(input(), {
      prepareAgent: vi.fn(),
      nativeFunctionProfiles: new Map([[profile.ref, profile]]),
    });
    expect(prepared.kind).toBe('native-function');
    if (prepared.kind !== 'native-function') throw new Error('wrong executor kind');
    expect(prepared.prepared.profile).toEqual(profile);
    expect(prepared.prepared.input.payload).toEqual({ cveId: 'CVE-2026-0001' });
    expect(prepared.prepared.input.hash).toMatch(/^sha256:/);
    expect(prepared.prepared.birth).toMatchObject({
      capability: { name: 'cve.enrich', hash: expect.stringMatching(/^sha256:/) },
      profile: { ref: profile.ref, handlerRef: profile.handlerRef },
    });
    expect(prepared.prepared.callback).toEqual({
      onDoneAction: 'enrichment-succeeded',
      onErrorAction: 'enrichment-failed',
    });
  });

  it.each([
    ['unknown executor', { class: 'mystery', profile: 'x' }, new Map()],
    ['missing profile', { class: 'native-function', profile: 'missing' }, new Map()],
    [
      'unavailable handler',
      { class: 'native-function', profile: profile.ref },
      new Map([
        [profile.ref, { ...profile, availability: { status: 'unavailable', reason: 'off' } }],
      ]),
    ],
  ])('fails %s before append or Temporal start', async (_label, executor, profiles) => {
    const append = vi.fn();
    const start = vi.fn();
    await expect(
      prepareCapabilityDispatch(input(functionCapability({ executor })), {
        prepareAgent: vi.fn(),
        nativeFunctionProfiles: profiles as Map<string, NativeFunctionProfileV1>,
      }),
    ).rejects.toThrow();
    expect(append).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('persists prepared birth before start and derives one deterministic workflow identity', async () => {
    const dispatch = await prepareCapabilityDispatch(input(), {
      prepareAgent: vi.fn(),
      nativeFunctionProfiles: new Map([[profile.ref, profile]]),
    });
    if (dispatch.kind !== 'native-function') throw new Error('wrong executor kind');
    const append = vi.fn<(event: Record<string, unknown>) => Promise<number>>(async () => 42);
    const start = vi.fn<(input: NativeFunctionStartInput) => Promise<void>>(async () => undefined);
    const result = await startPersistedCapabilityDispatch(dispatch.prepared, { append, start });
    expect(append).toHaveBeenCalledBefore(start);
    expect(append.mock.calls[0]![0]).toMatchObject({
      kind: 'spawn-requested',
      detail: {
        nativeFunction: { birth: dispatch.prepared.birth, input: dispatch.prepared.input },
      },
    });
    expect(result.executionId).toMatch(/^nf-16-[a-f0-9]{12}$/);
    expect(result.workflowId).toBe(`function-${result.executionId}`);
  });

  it('reconciles an orphaned persisted spawn with the same workflow ID exactly once', async () => {
    const start = vi.fn<(input: NativeFunctionStartInput) => Promise<void>>(async () => undefined);
    const orphan = {
      seq: 42,
      prepared: {
        event: spawnEvent(),
        profile,
        birth: {
          capability: { name: 'cve.enrich', hash },
          profile: {
            ref: profile.ref,
            version: profile.version,
            handlerRef: profile.handlerRef,
            adapterVersion: profile.adapterVersion,
          },
          inputContract: { hash },
          outputContract: { hash },
        },
        callback: { onDoneAction: 'enrichment-succeeded', onErrorAction: 'enrichment-failed' },
        input: {
          payload: { cveId: 'CVE-2026-0001' },
          sources: {
            cveId: {
              from: 'source-field' as const,
              name: 'cveId',
              rel: 'cve:CVE-2026-0001',
            },
          },
          hash,
          byteLength: 27,
        },
        source: {
          rel: 'cve:CVE-2026-0001',
          action: 'enrich-impact',
          principal: 'user:mike',
          policyScope: 'security',
        },
      },
    };
    const finalized = nativeFunctionExecutionIdentity(43, orphan.prepared);
    const result = await reconcileNativeFunctionSpawns({
      spawns: [orphan, { ...orphan, seq: 43 }],
      finalizedExecutionIds: new Set([finalized.executionId]),
      start,
    });
    expect(result.started).toHaveLength(1);
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]![0].workflowId).toBe(`function-${result.started[0]!}`);
  });
});
