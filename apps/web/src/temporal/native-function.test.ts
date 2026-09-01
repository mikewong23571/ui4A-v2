import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();

vi.mock('@temporalio/client', () => ({
  Connection: { connect: vi.fn(async () => ({})) },
  Client: class {
    workflow = { start };
  },
}));

import {
  dispatchNativeFunction,
  nativeFunctionWorkflowId,
  resetTemporalNativeFunctionClientForTests,
} from './native-function';

const hash = `sha256:${'a'.repeat(64)}` as const;
const executionId = 'nf-16-aaaaaaaaaaaa';
const profile = {
  schemaVersion: 1 as const,
  ref: 'security-enrichment-default',
  version: '1',
  executorClass: 'native-function' as const,
  handlerRef: 'security/cve-enrich@1',
  adapterVersion: 'native-function@1',
  availability: { status: 'available' as const },
  limits: {
    startToCloseTimeoutMs: 30_000,
    maximumAttempts: 3,
    inputBytes: 16_384,
    outputBytes: 32_768,
  },
  network: 'denied' as const,
};
const invocation = {
  schemaVersion: 1 as const,
  source: {
    eventId: 'core:42' as const,
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
    inputContract: { hash },
    outputContract: { hash },
  },
  callback: { onDoneAction: 'enrichment-succeeded', onErrorAction: 'enrichment-failed' },
  input: { payload: { cveId: 'CVE-2026-0001' }, sources: {}, hash, byteLength: 27 },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetTemporalNativeFunctionClientForTests();
});

describe('Native Function Temporal client', () => {
  it('starts the birth-pinned workflow on the server-owned task queue', async () => {
    vi.stubEnv('UI4A_TASK_QUEUE', 'ui4a-function-test');
    await dispatchNativeFunction({
      executionId,
      workflowId: nativeFunctionWorkflowId(executionId),
      invocation,
      profile,
    });
    expect(start).toHaveBeenCalledWith('nativeFunctionWorkflow', {
      args: [{ executionId, invocation, profile }],
      taskQueue: 'ui4a-function-test',
      workflowId: `function-${executionId}`,
    });
  });

  it('rejects path-like ids and mismatched workflow identities', async () => {
    expect(() => nativeFunctionWorkflowId('../escape')).toThrow('executionId');
    await expect(
      dispatchNativeFunction({ executionId, workflowId: 'function-wrong', invocation, profile }),
    ).rejects.toThrow('identity mismatch');
    expect(start).not.toHaveBeenCalled();
  });
});
