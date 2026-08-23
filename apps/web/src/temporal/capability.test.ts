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
  cancelCodingCapability,
  codingWorkflowId,
  dispatchCodingCapability,
  resetTemporalCapabilityClientForTests,
} from './capability';

beforeEach(() => {
  vi.clearAllMocks();
  resetTemporalCapabilityClientForTests();
});

describe('coding capability Temporal client', () => {
  it('uses a stable workflow id and configured queue', async () => {
    vi.stubEnv('UI4A_TASK_QUEUE', 'ui4a-test-coding');
    const task = {
      schemaVersion: 1 as const,
      repositoryRef: 'repo:fixture',
      baseRevision: 'a'.repeat(40),
      goal: 'change code',
      constraints: [],
      acceptanceCriteria: ['tests pass'],
      allowedPaths: ['src'],
      budget: {
        timeoutSeconds: 300,
        maxTurns: 20,
        maxRawEvents: 2_000,
        maxRawBytes: 4 * 1024 * 1024,
        maxRawChunkBytes: 64 * 1024,
      },
      redaction: { secretNames: [], redactHostPaths: true },
    };
    await dispatchCodingCapability({
      runId: 'run-1',
      principal: 'user:mike',
      policyScope: 'development',
      profileName: 'default',
      task,
      baseUrl: 'http://localhost:3100',
    });
    expect(start).toHaveBeenCalledWith(
      'codingCapabilityWorkflow',
      expect.objectContaining({ workflowId: 'coding-run-1', taskQueue: 'ui4a-test-coding' }),
    );
  });

  it('cancels by the same workflow identity and rejects path-like ids', async () => {
    await cancelCodingCapability('run-1');
    expect(getHandle).toHaveBeenCalledWith('coding-run-1');
    expect(cancel).toHaveBeenCalled();
    expect(() => codingWorkflowId('../escape')).toThrow('runId');
  });
});
