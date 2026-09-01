import { describe, expect, it, vi } from 'vitest';

import type {
  NativeFunctionInvocationV1,
  NativeFunctionProfileV1,
  NativeFunctionWorkflowInputV1,
} from '@ui4a/shared';
import { hashCanonicalAgentJson } from '@ui4a/engine';

import {
  createNativeFunctionHandlerRegistry,
  executeNativeFunction,
  nativeFunctionActivityOptions,
  NativeFunctionHandlerFailure,
} from './adapter';

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
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cveId'],
  properties: { cveId: { type: 'string' } },
};
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['severity'],
  properties: { severity: { type: 'string' } },
};
const inputContractHash = hashCanonicalAgentJson(inputSchema);
const outputContractHash = hashCanonicalAgentJson(outputSchema);
const inputHash = hashCanonicalAgentJson({ cveId: 'CVE-2026-0001' });
const invocation: NativeFunctionInvocationV1 = {
  schemaVersion: 1,
  source: {
    eventId: 'core:42',
    rel: 'cve:CVE-2026-0001',
    action: 'enrich-impact',
    principal: 'user:mike',
    policyScope: 'security',
  },
  birth: {
    capability: { name: 'cve.enrich', hash },
    profile: {
      ref: profile.ref,
      version: profile.version,
      handlerRef: profile.handlerRef,
      adapterVersion: profile.adapterVersion,
    },
    inputContract: { hash: inputContractHash, schema: inputSchema },
    outputContract: { hash: outputContractHash, schema: outputSchema },
  },
  callback: { onDoneAction: 'enrichment-succeeded', onErrorAction: 'enrichment-failed' },
  input: {
    payload: { cveId: 'CVE-2026-0001' },
    sources: {},
    hash: inputHash,
    byteLength: 25,
  },
};

function request(overrides: Partial<NativeFunctionWorkflowInputV1> = {}) {
  return {
    executionId: 'nf-16-aaaaaaaaaaaa',
    invocation,
    profile,
    ...overrides,
  };
}

describe('Native Function handler registry', () => {
  it('resolves by birth-pinned handler ref without capability-name routing', async () => {
    const first = vi.fn(async () => ({ output: { severity: 'high' }, evidenceRefs: [] }));
    const second = vi.fn(async () => ({ output: { severity: 'low' }, evidenceRefs: [] }));
    const registry = createNativeFunctionHandlerRegistry([
      { ref: profile.handlerRef, handler: first },
      { ref: 'security/other@1', handler: second },
    ]);
    const result = await executeNativeFunction(request(), {
      registry,
      signal: new AbortController().signal,
      attempt: 1,
    });
    expect(result).toMatchObject({ status: 'succeeded', output: { severity: 'high' } });
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('rejects duplicate and missing handler refs', async () => {
    const handler = vi.fn();
    expect(() =>
      createNativeFunctionHandlerRegistry([
        { ref: 'security/x@1', handler },
        { ref: 'security/x@1', handler },
      ]),
    ).toThrow(/duplicate/i);
    await expect(
      executeNativeFunction(request(), {
        registry: createNativeFunctionHandlerRegistry([]),
        signal: new AbortController().signal,
        attempt: 1,
      }),
    ).resolves.toMatchObject({ status: 'failed', failure: { retryable: false } });
  });
});

describe('Native Function execute Activity boundary', () => {
  it('fails permanently for invalid or oversized handler output', async () => {
    const invalid = createNativeFunctionHandlerRegistry([
      { ref: profile.handlerRef, handler: async () => ({ output: { severity: 42 } }) },
    ]);
    await expect(
      executeNativeFunction(request(), {
        registry: invalid,
        signal: new AbortController().signal,
        attempt: 1,
      }),
    ).resolves.toMatchObject({ status: 'failed', failure: { retryable: false } });

    const oversized = createNativeFunctionHandlerRegistry([
      {
        ref: profile.handlerRef,
        handler: async () => ({ output: { severity: 'x'.repeat(40_000) } }),
      },
    ]);
    await expect(
      executeNativeFunction(request(), {
        registry: oversized,
        signal: new AbortController().signal,
        attempt: 1,
      }),
    ).resolves.toMatchObject({ status: 'failed', failure: { code: 'output-budget' } });
  });

  it('lets retryable handler failures reach Temporal and maps permanent failures', async () => {
    const retryable = createNativeFunctionHandlerRegistry([
      {
        ref: profile.handlerRef,
        handler: async () => {
          throw new NativeFunctionHandlerFailure('catalog-offline', 'offline', true);
        },
      },
    ]);
    await expect(
      executeNativeFunction(request(), {
        registry: retryable,
        signal: new AbortController().signal,
        attempt: 1,
      }),
    ).rejects.toThrow('offline');

    const permanent = createNativeFunctionHandlerRegistry([
      {
        ref: profile.handlerRef,
        handler: async () => {
          throw new NativeFunctionHandlerFailure('unsupported', 'unsupported', false);
        },
      },
    ]);
    await expect(
      executeNativeFunction(request(), {
        registry: permanent,
        signal: new AbortController().signal,
        attempt: 1,
      }),
    ).resolves.toMatchObject({ status: 'failed', failure: { code: 'unsupported' } });
  });

  it('returns cancelled without invoking a handler when the cooperative signal is aborted', async () => {
    const handler = vi.fn();
    const controller = new AbortController();
    controller.abort('requested');
    const result = await executeNativeFunction(request(), {
      registry: createNativeFunctionHandlerRegistry([{ ref: profile.handlerRef, handler }]),
      signal: controller.signal,
      attempt: 1,
    });
    expect(result.status).toBe('cancelled');
    expect(handler).not.toHaveBeenCalled();
  });

  it('pins timeout and maximum attempts from the sealed profile', () => {
    expect(nativeFunctionActivityOptions(profile)).toEqual({
      startToCloseTimeout: '30000ms',
      retry: { maximumAttempts: 3 },
    });
  });

  it('rejects profile birth drift before invoking a handler', async () => {
    const handler = vi.fn();
    const drifted = { ...profile, handlerRef: 'security/changed@1' };
    await expect(
      executeNativeFunction(request({ profile: drifted }), {
        registry: createNativeFunctionHandlerRegistry([{ ref: drifted.handlerRef, handler }]),
        signal: new AbortController().signal,
        attempt: 1,
      }),
    ).resolves.toMatchObject({ status: 'failed', failure: { code: 'profile-birth-mismatch' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects birth-pinned limit drift before invoking a handler', async () => {
    const handler = vi.fn(async () => ({ output: { severity: 'high' } }));
    const drifted = {
      ...profile,
      limits: { ...profile.limits, maximumAttempts: profile.limits.maximumAttempts + 1 },
    };
    await expect(
      executeNativeFunction(request({ profile: drifted }), {
        registry: createNativeFunctionHandlerRegistry([{ ref: drifted.handlerRef, handler }]),
        signal: new AbortController().signal,
        attempt: 1,
      }),
    ).resolves.toMatchObject({ status: 'failed', failure: { code: 'profile-birth-mismatch' } });
    expect(handler).not.toHaveBeenCalled();
  });
});
