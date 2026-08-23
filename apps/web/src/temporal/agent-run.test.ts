import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
const cancel = vi.fn();
const getHandle = vi.fn(() => ({ cancel }));

vi.mock('@temporalio/client', () => ({
  Connection: { connect: vi.fn(async () => ({})) },
  Client: class {
    workflow = { start, getHandle };
  },
}));

import {
  agentRunWorkflowId,
  cancelAgentRun,
  dispatchAgentRun,
  resetTemporalAgentRunClientForTests,
} from './agent-run';

const args = {
  runId: 'run-1',
  principal: 'local-user',
  policyScope: 'development',
  source: { rel: 'software-change:main', action: 'start', eventId: 'core:1' },
  birth: {
    schemaVersion: 1 as const,
    kind: 'event-native' as const,
    definition: {
      ref: 'coding-agent',
      version: 1,
      sourceHash: 'sha256:source',
      parentHashes: ['sha256:parent'],
      flattenedHash: 'sha256:flattened',
    },
    prompt: { templateHash: 'sha256:template', compiledHash: 'sha256:compiled' },
    runtime: { profileName: 'default', profileVersion: '1', adapterVersion: 'codex@1' },
    taskContract: { ref: 'coding-agent@1:input', hash: 'sha256:input' },
    resultContract: { ref: 'coding-agent@1:output', hash: 'sha256:output' },
  },
  task: {
    schemaVersion: 1 as const,
    contract: { ref: 'coding-agent@1:input', hash: 'sha256:input' },
    payload: { kind: 'coding-task' },
  },
  limits: { maxSuspensions: 8 },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetTemporalAgentRunClientForTests();
});

describe('generic Agent Run Temporal client', () => {
  it('starts the generic workflow with the exact birth-pinned task', async () => {
    vi.stubEnv('UI4A_TASK_QUEUE', 'ui4a-test-agent');

    await dispatchAgentRun(args);

    expect(start).toHaveBeenCalledWith('agentRunWorkflow', {
      args: [args],
      taskQueue: 'ui4a-test-agent',
      workflowId: 'agent-run-1',
    });
  });

  it('cancels by the same workflow identity and rejects path-like ids', async () => {
    await cancelAgentRun('run-1');
    expect(getHandle).toHaveBeenCalledWith('agent-run-1');
    expect(cancel).toHaveBeenCalledOnce();
    expect(() => agentRunWorkflowId('../escape')).toThrow('runId');
  });
});
