import { describe, expect, it } from 'vitest';

import {
  parseNativeFunctionInvocation,
  parseNativeFunctionOutcome,
  parseNativeFunctionProfiles,
  parseNativeFunctionReceipt,
} from './native-function';

const hash = `sha256:${'a'.repeat(64)}`;

function profile(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function invocation(overrides: Record<string, unknown> = {}) {
  return {
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
        ref: 'security-enrichment-default',
        version: '1',
        handlerRef: 'security/cve-enrich@1',
        adapterVersion: 'native-function@1',
      },
      inputContract: { hash, schema: { type: 'object' } },
      outputContract: { hash, schema: { type: 'object' } },
    },
    callback: {
      onDoneAction: 'enrichment-succeeded',
      onErrorAction: 'enrichment-failed',
    },
    input: {
      payload: { cveId: 'CVE-2026-0001' },
      sources: {
        cveId: { from: 'source-field', name: 'cveId', rel: 'cve:CVE-2026-0001' },
      },
      hash,
      byteLength: 25,
    },
    ...overrides,
  };
}

function succeededOutcome(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    output: { severity: 'high' },
    outputHash: hash,
    outputByteLength: 19,
    evidenceRefs: ['evidence:cve-catalog'],
    attempt: 1,
    ...overrides,
  };
}

describe('Native Function deployment contract', () => {
  it('parses one exact network-denied deployment profile', () => {
    expect(parseNativeFunctionProfiles([profile()])).toEqual([profile()]);
  });

  it.each([
    ['missing ref', { ref: undefined }],
    ['wrong class', { executorClass: 'agent' }],
    ['unknown field', { endpoint: 'https://not-allowed.example' }],
    ['network access', { network: 'declared-hosts' }],
    ['zero timeout', { limits: { ...profile().limits, startToCloseTimeoutMs: 0 } }],
    ['zero attempts', { limits: { ...profile().limits, maximumAttempts: 0 } }],
    ['unbounded input', { limits: { ...profile().limits, inputBytes: Number.MAX_SAFE_INTEGER } }],
    ['hard memory claim', { memoryMb: 128 }],
  ])('rejects %s', (_label, override) => {
    expect(() => parseNativeFunctionProfiles([profile(override)])).toThrow();
  });

  it('rejects duplicate refs instead of selecting the first profile', () => {
    expect(() => parseNativeFunctionProfiles([profile(), profile({ version: '2' })])).toThrow(
      /duplicate/i,
    );
  });

  it('rejects payload budgets that the binder and canonical hash cannot honor', () => {
    expect(() =>
      parseNativeFunctionProfiles([
        profile({ limits: { ...profile().limits, inputBytes: 65_537 } }),
      ]),
    ).toThrow(/inputBytes/);
    expect(() =>
      parseNativeFunctionProfiles([
        profile({ limits: { ...profile().limits, outputBytes: 262_145 } }),
      ]),
    ).toThrow(/outputBytes/);
  });

  it('requires unavailable profiles to carry one bounded reason', () => {
    expect(
      parseNativeFunctionProfiles([
        profile({ availability: { status: 'unavailable', reason: 'handler is not deployed' } }),
      ]),
    ).toHaveLength(1);
    expect(() =>
      parseNativeFunctionProfiles([profile({ availability: { status: 'unavailable' } })]),
    ).toThrow();
  });
});

describe('Native Function invocation', () => {
  it('parses a sealed, birth-pinned invocation without deployment secrets', () => {
    expect(parseNativeFunctionInvocation(invocation())).toEqual(invocation());
  });

  it.each([
    ['wrong schema version', { schemaVersion: 2 }],
    ['non-core event id', { source: { ...invocation().source, eventId: 'agent:42' } }],
    [
      'invalid hash',
      { birth: { ...invocation().birth, capability: { name: 'cve.enrich', hash: 'x' } } },
    ],
    ['missing callback', { callback: { onDoneAction: 'enrichment-succeeded' } }],
    ['unknown root field', { credential: 'secret' }],
    ['oversized declared input', { input: { ...invocation().input, byteLength: 2_000_000 } }],
  ])('rejects %s', (_label, override) => {
    expect(() => parseNativeFunctionInvocation(invocation(override))).toThrow();
  });
});

describe('Native Function outcome and receipt', () => {
  it('parses succeeded, failed, and cancelled terminal outcomes', () => {
    expect(parseNativeFunctionOutcome(succeededOutcome(), 32_768).status).toBe('succeeded');
    expect(
      parseNativeFunctionOutcome(
        {
          schemaVersion: 1,
          status: 'failed',
          failure: { code: 'catalog-unavailable', reason: 'catalog unavailable', retryable: true },
          attempt: 3,
        },
        32_768,
      ).status,
    ).toBe('failed');
    expect(
      parseNativeFunctionOutcome(
        { schemaVersion: 1, status: 'cancelled', reason: 'requested', attempt: 1 },
        32_768,
      ).status,
    ).toBe('cancelled');
  });

  it('rejects output beyond the birth-pinned budget and malformed failures', () => {
    expect(() => parseNativeFunctionOutcome(succeededOutcome(), 8)).toThrow(/budget/i);
    expect(() =>
      parseNativeFunctionOutcome(
        {
          schemaVersion: 1,
          status: 'failed',
          failure: { code: '', reason: '', retryable: 'yes' },
          attempt: 1,
        },
        32_768,
      ),
    ).toThrow();
  });

  it('parses one terminal receipt and rejects callback/outcome drift', () => {
    const receipt = {
      schemaVersion: 1,
      executionId: `nf-16-${'b'.repeat(12)}`,
      sourceEventId: 'core:42',
      invocationHash: hash,
      capability: { name: 'cve.enrich', hash },
      profile: invocation().birth.profile,
      inputHash: hash,
      outcome: succeededOutcome(),
      callback: {
        commandId: `function-finalize:nf-16-${'b'.repeat(12)}`,
        action: 'enrichment-succeeded',
        outcome: 'accepted',
      },
    };
    expect(parseNativeFunctionReceipt(receipt, 32_768)).toEqual(receipt);
    expect(() =>
      parseNativeFunctionReceipt(
        { ...receipt, callback: { ...receipt.callback, outcome: 'unknown' } },
        32_768,
      ),
    ).toThrow();
  });
});
