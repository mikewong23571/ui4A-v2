import { describe, expect, it } from 'vitest';

import {
  applyCapabilityRunCommand,
  createCapabilityRunSnapshot,
  foldCapabilityRunEvents,
  type CapabilityRunCommand,
} from './index';

const base = {
  runId: 'run-1',
  task: {
    schemaVersion: 1 as const,
    repositoryRef: 'repo:fixture',
    baseRevision: 'a'.repeat(40),
    goal: 'change code',
    constraints: [],
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
  },
  principal: 'user:mike',
  source: { rel: 'change:1', action: 'start-implementation', eventId: 'business:1' },
  profileName: 'default',
};

function command<T extends CapabilityRunCommand>(value: T): T {
  return value;
}

describe('capability run aggregate', () => {
  it('folds the complete happy lifecycle and matches incremental replay', () => {
    let snapshot = createCapabilityRunSnapshot();
    const commands: CapabilityRunCommand[] = [
      command({ kind: 'create', commandId: 'c1', eventId: 'e1', ...base }),
      command({
        kind: 'prepare',
        commandId: 'c2',
        eventId: 'e2',
        runId: base.runId,
        expectedRevision: 1,
      }),
      command({
        kind: 'start',
        commandId: 'c3',
        eventId: 'e3',
        runId: base.runId,
        expectedRevision: 2,
        workspace: {
          schemaVersion: 1,
          workspaceId: 'w1',
          repositoryRef: 'repo:fixture',
          baseRevision: 'a'.repeat(40),
          branch: 'ui4a/run-1',
          leaseId: 'l1',
          allowedPaths: ['src'],
        },
        handle: { schemaVersion: 1, runId: base.runId, profileName: 'default', workspaceId: 'w1' },
      }),
      command({
        kind: 'advance-cursor',
        commandId: 'c4',
        eventId: 'e4',
        runId: base.runId,
        expectedRevision: 3,
        expectedCursor: null,
        cursor: 'cursor:1',
        normalizedSequence: 1,
      }),
      command({
        kind: 'restart',
        commandId: 'c5',
        eventId: 'e5',
        runId: base.runId,
        expectedRevision: 4,
        expectedCursor: 'cursor:1',
        reason: 'worker restarted',
      }),
      command({
        kind: 'succeed',
        commandId: 'c6',
        eventId: 'e6',
        runId: base.runId,
        expectedRevision: 5,
        result: {
          schemaVersion: 1,
          resultId: 'result:1',
          baseRevision: 'a'.repeat(40),
          headRevision: 'b'.repeat(40),
          patch: { hash: `sha256:${'1'.repeat(64)}`, sizeBytes: 1, mediaType: 'text/x-diff' },
          trajectory: {
            hash: `sha256:${'2'.repeat(64)}`,
            sizeBytes: 1,
            mediaType: 'application/x-ndjson',
          },
          commits: [],
          changedFiles: ['src/a.ts'],
          testRuns: [{ command: 'test', exitCode: 0, passed: true }],
          summary: 'done',
        },
      }),
    ];
    const events = [];
    for (const item of commands) {
      const applied = applyCapabilityRunCommand(snapshot, item);
      snapshot = applied.snapshot;
      events.push(...applied.events);
    }

    expect(snapshot.runs['run-1']).toMatchObject({
      status: 'succeeded',
      revision: 6,
      cursor: 'cursor:1',
      restartCount: 1,
      normalizedSequence: 1,
    });
    expect(foldCapabilityRunEvents(events)).toEqual(snapshot);
    expect(
      foldCapabilityRunEvents(events.slice(3), foldCapabilityRunEvents(events.slice(0, 3))),
    ).toEqual(snapshot);
  });

  it('rejects stale revision/cursor and illegal terminal transitions', () => {
    const created = applyCapabilityRunCommand(
      createCapabilityRunSnapshot(),
      command({ kind: 'create', commandId: 'c1', eventId: 'e1', ...base }),
    ).snapshot;
    expect(() =>
      applyCapabilityRunCommand(
        created,
        command({
          kind: 'prepare',
          commandId: 'c2',
          eventId: 'e2',
          runId: base.runId,
          expectedRevision: 0,
        }),
      ),
    ).toThrow(/revision/i);
    const preparing = applyCapabilityRunCommand(
      created,
      command({
        kind: 'prepare',
        commandId: 'c2',
        eventId: 'e2',
        runId: base.runId,
        expectedRevision: 1,
      }),
    ).snapshot;
    expect(() =>
      applyCapabilityRunCommand(
        preparing,
        command({
          kind: 'cancel',
          commandId: 'c3',
          eventId: 'e3',
          runId: base.runId,
          expectedRevision: 1,
          reason: 'stop',
        }),
      ),
    ).toThrow(/revision/i);
  });

  it('deduplicates command/event retries and rejects collisions', () => {
    const create = command({ kind: 'create', commandId: 'c1', eventId: 'e1', ...base });
    const first = applyCapabilityRunCommand(createCapabilityRunSnapshot(), create);
    expect(applyCapabilityRunCommand(first.snapshot, create).events).toEqual([]);
    expect(() =>
      applyCapabilityRunCommand(first.snapshot, { ...create, commandId: 'different' }),
    ).toThrow(/eventId/i);
    expect(() =>
      foldCapabilityRunEvents([{ ...first.events[0]!, commandId: 'different' }], first.snapshot),
    ).toThrow(/eventId/i);
  });
});
