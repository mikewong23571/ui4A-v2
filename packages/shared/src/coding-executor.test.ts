import { describe, expect, it } from 'vitest';

import {
  CODING_EXECUTION_LIMITS,
  CODING_EXECUTOR_SCHEMA_VERSION,
  type CodingNormalizedEvent,
  type CodingResult,
  type CodingTask,
  type WorkspaceHandle,
} from './coding-executor';

describe('coding executor wire contract', () => {
  it('versions every durable envelope and fixes raw trajectory budgets', () => {
    const task: CodingTask = {
      schemaVersion: CODING_EXECUTOR_SCHEMA_VERSION,
      repositoryRef: 'repo:fixture',
      baseRevision: 'a'.repeat(40),
      goal: 'implement the requested change',
      constraints: ['do not change dependencies'],
      acceptanceCriteria: ['tests pass'],
      allowedPaths: ['src', 'test/example.test.ts'],
      budget: {
        timeoutSeconds: 900,
        maxTurns: 24,
        maxRawEvents: CODING_EXECUTION_LIMITS.maxRawEvents,
        maxRawBytes: CODING_EXECUTION_LIMITS.maxRawBytes,
        maxRawChunkBytes: CODING_EXECUTION_LIMITS.maxRawChunkBytes,
      },
      redaction: { secretNames: ['API_KEY'], redactHostPaths: true },
    };
    const workspace: WorkspaceHandle = {
      schemaVersion: 1,
      workspaceId: 'workspace:run-1',
      repositoryRef: task.repositoryRef,
      baseRevision: task.baseRevision,
      branch: 'ui4a/run-1',
      leaseId: 'lease:run-1',
      allowedPaths: task.allowedPaths,
      mainCheckoutFingerprint: `sha256:${'3'.repeat(64)}`,
    };
    const event: CodingNormalizedEvent = {
      schemaVersion: 1,
      eventId: 'event:1',
      runId: 'run-1',
      sequence: 1,
      kind: 'progress-reported',
      message: 'working',
    };
    const result: CodingResult = {
      schemaVersion: 1,
      resultId: 'result:1',
      baseRevision: task.baseRevision,
      headRevision: 'b'.repeat(40),
      patch: { hash: `sha256:${'1'.repeat(64)}`, sizeBytes: 12, mediaType: 'text/x-diff' },
      trajectory: {
        hash: `sha256:${'2'.repeat(64)}`,
        sizeBytes: 24,
        mediaType: 'application/x-ndjson',
      },
      commits: ['b'.repeat(40)],
      changedFiles: ['src/index.ts'],
      testRuns: [{ command: 'pnpm test', exitCode: 0, passed: true }],
      summary: 'implemented',
    };

    expect(task.schemaVersion).toBe(1);
    expect(workspace.repositoryRef).toBe(task.repositoryRef);
    expect(event.sequence).toBe(1);
    expect(result.patch.hash).toMatch(/^sha256:/);
    expect(CODING_EXECUTION_LIMITS).toEqual({
      maxRawChunkBytes: 64 * 1024,
      maxRawBytes: 4 * 1024 * 1024,
      maxRawEvents: 2_000,
    });
  });

  it('preserves unknown provider detail without leaking it into normalized fields', () => {
    const event: CodingNormalizedEvent = {
      schemaVersion: 1,
      eventId: 'event:2',
      runId: 'run-1',
      sequence: 2,
      kind: 'provider-event',
      providerDetail: { futureShape: { value: 1 } },
    };

    expect(event.providerDetail).toEqual({ futureShape: { value: 1 } });
  });
});
