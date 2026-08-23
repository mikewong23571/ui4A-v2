import { describe, expect, it } from 'vitest';

import type { CapabilityRunEvent } from '../capability-run/run';
import { foldAgentRunEvents } from './run';
import {
  LEGACY_T18_DEFINITION_HASH,
  decodeLegacyCapabilityRunEvents,
} from './legacy-capability-run';

const task = {
  schemaVersion: 1 as const,
  repositoryRef: 'repo:fixture',
  baseRevision: 'a'.repeat(40),
  goal: 'implement the requested change',
  constraints: ['keep the public API'],
  acceptanceCriteria: ['tests pass'],
  allowedPaths: ['src'],
  budget: {
    timeoutSeconds: 300,
    maxTurns: 12,
    maxRawEvents: 2_000,
    maxRawBytes: 4 * 1024 * 1024,
    maxRawChunkBytes: 64 * 1024,
  },
  redaction: { secretNames: [], redactHostPaths: true },
};

const legacyEvents: CapabilityRunEvent[] = [
  {
    kind: 'capability-run-created',
    eventId: 'legacy:event:1',
    commandId: 'legacy:command:1',
    runId: 'legacy-run:1',
    revision: 1,
    task,
    principal: 'user:mike',
    policyScope: 'development',
    source: {
      rel: 'software-change:1',
      action: 'start-implementation',
      eventId: 'business:1',
      onDoneAction: 'implementation-succeeded',
      onErrorAction: 'implementation-failed',
    },
    profileName: 'local',
  },
  {
    kind: 'capability-run-preparing',
    eventId: 'legacy:event:2',
    commandId: 'legacy:command:2',
    runId: 'legacy-run:1',
    revision: 2,
  },
  {
    kind: 'capability-run-started',
    eventId: 'legacy:event:3',
    commandId: 'legacy:command:3',
    runId: 'legacy-run:1',
    revision: 3,
    workspace: {
      schemaVersion: 1,
      workspaceId: 'workspace:1',
      repositoryRef: task.repositoryRef,
      baseRevision: task.baseRevision,
      branch: 'ui4a/run-legacy-1',
      leaseId: 'lease:1',
      allowedPaths: ['src'],
      mainCheckoutFingerprint: 'sha256:main',
    },
    handle: {
      schemaVersion: 1,
      runId: 'legacy-run:1',
      profileName: 'local',
      workspaceId: 'workspace:1',
      nativeSessionId: 'native:1',
    },
  },
  {
    kind: 'capability-run-cursor-advanced',
    eventId: 'legacy:event:4',
    commandId: 'legacy:command:4',
    runId: 'legacy-run:1',
    revision: 4,
    priorCursor: null,
    cursor: 'cursor:1',
    normalizedSequence: 1,
  },
  {
    kind: 'capability-run-restarted',
    eventId: 'legacy:event:5',
    commandId: 'legacy:command:5',
    runId: 'legacy-run:1',
    revision: 5,
    priorCursor: 'cursor:1',
    reason: 'worker restarted',
  },
  {
    kind: 'capability-run-succeeded',
    eventId: 'legacy:event:6',
    commandId: 'legacy:command:6',
    runId: 'legacy-run:1',
    revision: 6,
    result: {
      schemaVersion: 1,
      resultId: 'result:1',
      baseRevision: task.baseRevision,
      headRevision: 'b'.repeat(40),
      patch: { hash: 'sha256:patch', sizeBytes: 12, mediaType: 'text/x-diff' },
      trajectory: { hash: 'sha256:trace', sizeBytes: 23, mediaType: 'application/x-ndjson' },
      commits: [],
      changedFiles: ['src/index.ts'],
      testRuns: [{ command: 'pnpm test', exitCode: 0, passed: true }],
      summary: 'done',
    },
  },
];

describe('T18 capability run compatibility decoder', () => {
  it('upcasts archived events without modifying their task/result JSON', () => {
    const before = structuredClone(legacyEvents);
    const decoded = decodeLegacyCapabilityRunEvents(legacyEvents);
    const run = foldAgentRunEvents(decoded).runs['legacy-run:1'];

    expect(legacyEvents).toEqual(before);
    expect(run).toMatchObject({
      status: 'succeeded',
      revision: 6,
      birth: {
        kind: 'legacy-t18-reconstructed',
        definition: {
          ref: 'coding-agent@1',
          version: 1,
          sourceHash: LEGACY_T18_DEFINITION_HASH,
          flattenedHash: LEGACY_T18_DEFINITION_HASH,
        },
        runtime: { profileName: 'local', profileVersion: 'legacy', adapterVersion: 't18-v1' },
      },
      task: { payload: task },
      result: {
        payload:
          legacyEvents[5]?.kind === 'capability-run-succeeded' ? legacyEvents[5].result : undefined,
      },
    });
  });

  it('has deterministic reconstructed birth metadata and identical full/incremental replay', () => {
    const first = decodeLegacyCapabilityRunEvents(legacyEvents);
    const second = decodeLegacyCapabilityRunEvents(structuredClone(legacyEvents));
    expect(first).toEqual(second);

    const full = foldAgentRunEvents(first);
    const incremental = foldAgentRunEvents(first.slice(3), foldAgentRunEvents(first.slice(0, 3)));
    expect(incremental).toEqual(full);
    expect(full.runs['legacy-run:1']?.birth.prompt.compiledHash).toMatch(/^fnv1a64:/);
  });

  it('fails closed on an unknown compatibility schema version', () => {
    expect(() =>
      decodeLegacyCapabilityRunEvents([
        { ...legacyEvents[0], schemaVersion: 2 } as CapabilityRunEvent & { schemaVersion: number },
      ]),
    ).toThrow(/schema version/i);
  });
});
