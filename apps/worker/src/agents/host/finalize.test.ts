import { describe, expect, it, vi } from 'vitest';

import type { AgentRunWorkflowArgs } from './contracts';
import { finalizeAgentRunOutcome } from './finalize';

const context = {
  runId: 'agent-run:finalize-test',
  principal: 'user:test',
  policyScope: 'development',
  source: { rel: 'request:one', action: 'start', eventId: 'event:source' },
  birth: {
    schemaVersion: 1,
    kind: 'event-native',
    definition: {
      ref: 'base-agent',
      version: 1,
      sourceHash: 'sha256:source',
      parentHashes: [],
      flattenedHash: 'sha256:definition',
    },
    prompt: { templateHash: 'sha256:template', compiledHash: 'sha256:prompt' },
    runtime: { profileName: 'fixture', profileVersion: '1', adapterVersion: 'fixture-v1' },
    taskContract: { ref: 'task@1', hash: 'sha256:task' },
    resultContract: { ref: 'result@1', hash: 'sha256:result' },
  },
  task: {
    schemaVersion: 1,
    contract: { ref: 'task@1', hash: 'sha256:task' },
    payload: null,
  },
  limits: { maxSuspensions: 2 },
} satisfies AgentRunWorkflowArgs;

describe('Agent Host terminal callback adapter', () => {
  it('uses one stable idempotency key across activity retries', async () => {
    const recordTerminal = vi.fn().mockResolvedValue({ deduplicated: false });
    const callbackSource = vi.fn().mockResolvedValue({ deduplicated: false });
    const outcome = { status: 'failed' as const, code: 'fixture', reason: 'failed safely' };

    await finalizeAgentRunOutcome({ context, outcome }, { recordTerminal, callbackSource });
    await finalizeAgentRunOutcome({ context, outcome }, { recordTerminal, callbackSource });

    expect(recordTerminal).toHaveBeenCalledTimes(2);
    expect(callbackSource).toHaveBeenCalledTimes(2);
    const firstKey = recordTerminal.mock.calls[0]?.[0].idempotencyKey;
    expect(firstKey).toBe('agent-run-finalize:agent-run:finalize-test');
    expect(recordTerminal.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
    expect(callbackSource.mock.calls[0]?.[0].idempotencyKey).toBe(firstKey);
    expect(callbackSource.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
  });

  it('still retries the idempotent source callback after terminal persistence was deduplicated', async () => {
    const recordTerminal = vi.fn().mockResolvedValue({ deduplicated: true });
    const callbackSource = vi.fn().mockResolvedValue({ deduplicated: true });

    await finalizeAgentRunOutcome(
      { context, outcome: { status: 'cancelled', reason: 'human cancelled' } },
      { recordTerminal, callbackSource },
    );

    expect(callbackSource).toHaveBeenCalledOnce();
  });
});
