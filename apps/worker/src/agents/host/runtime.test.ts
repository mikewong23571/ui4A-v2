import { describe, expect, it, vi } from 'vitest';

import type { AgentRunWorkflowArgs, AgentRuntimePort } from './contracts';
import { executeAgentRuntimeStep, type AgentActivityControls } from './runtime';

const context: AgentRunWorkflowArgs = {
  runId: 'agent-run:runtime-test',
  principal: 'user:test',
  policyScope: 'development',
  source: {
    rel: 'software-change:one',
    action: 'start',
    eventId: 'event:source',
    onDoneAction: 'implementation-succeeded',
    onErrorAction: 'implementation-failed',
  },
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
    runtime: {
      profileName: 'fixture',
      profileVersion: '1',
      adapterVersion: 'fixture-v1',
    },
    taskContract: { ref: 'task@1', hash: 'sha256:task' },
    resultContract: { ref: 'result@1', hash: 'sha256:result' },
  },
  task: {
    schemaVersion: 1,
    contract: { ref: 'task@1', hash: 'sha256:task' },
    payload: { objective: 'Complete the fixture task' },
  },
  limits: { maxSuspensions: 4 },
};

const prepared = { state: { workspaceRef: 'workspace:one' } };

function controls(overrides: Partial<AgentActivityControls> = {}): AgentActivityControls {
  return {
    attempt: 1,
    signal: new AbortController().signal,
    heartbeat: vi.fn(),
    ...overrides,
  };
}

describe('generic Agent Host runtime activity adapter', () => {
  it('executes a first attempt with the immutable Run context and reports checkpoints', async () => {
    const execute = vi.fn<AgentRuntimePort['execute']>().mockImplementation(async (input) => {
      input.reportProgress({ cursor: 'cursor:1', state: { token: 12 } });
      return { status: 'completed', state: { response: 'done' } };
    });
    const activityControls = controls();

    const result = await executeAgentRuntimeStep(
      { context, prepared },
      { runtime: { execute }, recordRestart: vi.fn() },
      activityControls,
    );

    expect(result).toEqual({ status: 'completed', state: { response: 'done' } });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        prepared,
        signal: activityControls.signal,
        restartBoundary: false,
      }),
    );
    expect(activityControls.heartbeat).toHaveBeenCalledWith({
      schemaVersion: 1,
      runId: context.runId,
      cursor: 'cursor:1',
      state: { token: 12 },
    });
  });

  it('uses a matching heartbeat checkpoint to resume and records a restart boundary', async () => {
    const checkpoint = {
      schemaVersion: 1 as const,
      runId: context.runId,
      cursor: 'cursor:7',
      state: { token: 34 },
    };
    const resume = vi
      .fn<NonNullable<AgentRuntimePort['resume']>>()
      .mockResolvedValue({ status: 'completed', state: { response: 'resumed' } });
    const recordRestart = vi.fn().mockResolvedValue(undefined);

    const result = await executeAgentRuntimeStep(
      { context, prepared },
      { runtime: { execute: vi.fn(), resume }, recordRestart },
      controls({ attempt: 2, heartbeatDetails: checkpoint }),
    );

    expect(result.status).toBe('completed');
    expect(recordRestart).toHaveBeenCalledWith({
      context,
      attempt: 2,
      priorCursor: 'cursor:7',
      reason: 'activity-retry-native-resume',
    });
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ checkpoint }));
  });

  it('records an explicit restart boundary when the runtime cannot resume natively', async () => {
    const execute = vi
      .fn<AgentRuntimePort['execute']>()
      .mockResolvedValue({ status: 'completed', state: null });
    const recordRestart = vi.fn().mockResolvedValue(undefined);

    await executeAgentRuntimeStep(
      { context, prepared },
      { runtime: { execute }, recordRestart },
      controls({ attempt: 2 }),
    );

    expect(recordRestart).toHaveBeenCalledWith({
      context,
      attempt: 2,
      priorCursor: null,
      reason: 'activity-retry-restart-boundary',
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ restartBoundary: true }));
  });

  it('rejects heartbeat details from another Run instead of resuming across scopes', async () => {
    await expect(
      executeAgentRuntimeStep(
        { context, prepared },
        { runtime: { execute: vi.fn() }, recordRestart: vi.fn() },
        controls({
          attempt: 2,
          heartbeatDetails: {
            schemaVersion: 1,
            runId: 'agent-run:other',
            cursor: 'cursor:foreign',
            state: null,
          },
        }),
      ),
    ).rejects.toThrow('heartbeat checkpoint does not belong to agent-run:runtime-test');
  });
});
