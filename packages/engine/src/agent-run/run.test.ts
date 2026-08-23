import { describe, expect, it } from 'vitest';

import {
  applyAgentRunCommand,
  createAgentRunSnapshot,
  foldAgentRunEvents,
  type AgentRunBirthReferences,
  type AgentRunCommand,
  type AgentRunEvent,
} from './run';

const birth: AgentRunBirthReferences = {
  schemaVersion: 1,
  kind: 'event-native',
  definition: {
    ref: 'article-author@2',
    version: 2,
    sourceHash: 'sha256:definition-source',
    parentHashes: ['sha256:root-definition'],
    flattenedHash: 'sha256:effective-definition',
  },
  prompt: {
    templateHash: 'sha256:prompt-template',
    compiledHash: 'sha256:compiled-messages',
  },
  runtime: { profileName: 'document-runtime', profileVersion: '4', adapterVersion: '2' },
  taskContract: { ref: 'writing-brief@1', hash: 'sha256:task-contract' },
  resultContract: { ref: 'writing-result@1', hash: 'sha256:result-contract' },
};

const create: AgentRunCommand = {
  kind: 'create',
  commandId: 'command:1',
  eventId: 'event:1',
  runId: 'run:1',
  principal: 'user:mike',
  policyScope: 'publishing',
  source: {
    rel: 'article-assignment:1',
    action: 'draft-article',
    eventId: 'business:1',
    onDoneAction: 'draft-ready',
    onErrorAction: 'draft-failed',
  },
  birth,
  task: {
    schemaVersion: 1,
    contract: birth.taskContract,
    payload: {
      title: 'Interface as contract',
      audience: 'software architects',
      sourceRefs: ['article:first-post'],
    },
  },
};

function applyAll(commands: readonly AgentRunCommand[]): {
  events: AgentRunEvent[];
  snapshot: ReturnType<typeof createAgentRunSnapshot>;
} {
  let snapshot = createAgentRunSnapshot();
  const events: AgentRunEvent[] = [];
  for (const command of commands) {
    const applied = applyAgentRunCommand(snapshot, command);
    snapshot = applied.snapshot;
    events.push(...applied.events);
  }
  return { events, snapshot };
}

describe('agent run aggregate', () => {
  it('runs a Writing-shaped task without repository fields and fixes every birth reference', () => {
    const changedBirth = structuredClone(birth);
    changedBirth.definition.ref = 'article-author@99';

    const commands: AgentRunCommand[] = [
      create,
      {
        kind: 'prepare',
        commandId: 'command:2',
        eventId: 'event:2',
        runId: 'run:1',
        expectedRevision: 1,
      },
      {
        kind: 'start',
        commandId: 'command:3',
        eventId: 'event:3',
        runId: 'run:1',
        expectedRevision: 2,
        handle: { sessionRef: 'session:1', detail: { documentLease: 'lease:1' } },
      },
      {
        kind: 'advance-cursor',
        commandId: 'command:4',
        eventId: 'event:4',
        runId: 'run:1',
        expectedRevision: 3,
        expectedCursor: null,
        cursor: 'cursor:1',
        observedSequence: 1,
      },
      {
        kind: 'restart',
        commandId: 'command:5',
        eventId: 'event:5',
        runId: 'run:1',
        expectedRevision: 4,
        expectedCursor: 'cursor:1',
        reason: 'runtime replaced',
        handle: { sessionRef: 'session:1-resumed' },
      },
      {
        kind: 'succeed',
        commandId: 'command:6',
        eventId: 'event:6',
        runId: 'run:1',
        expectedRevision: 5,
        result: {
          schemaVersion: 1,
          contract: birth.resultContract,
          resultId: 'result:1',
          payload: { markdown: '# Interface as contract' },
          artifacts: [{ ref: 'artifact:draft', hash: 'sha256:draft', mediaType: 'text/markdown' }],
          evidence: [{ ref: 'evidence:sources', kind: 'source-check' }],
          proposedEffects: [],
        },
      },
    ];

    const { events, snapshot } = applyAll(commands);
    const run = snapshot.runs['run:1'];
    expect(run).toMatchObject({
      status: 'succeeded',
      revision: 6,
      cursor: 'cursor:1',
      observedSequence: 1,
      restartCount: 1,
      birth,
      result: { resultId: 'result:1' },
    });
    expect(run?.task.payload).not.toHaveProperty('repositoryRef');
    expect(run?.birth.definition.ref).toBe('article-author@2');
    expect(foldAgentRunEvents(events)).toEqual(snapshot);
    expect(foldAgentRunEvents(events.slice(3), foldAgentRunEvents(events.slice(0, 3)))).toEqual(
      snapshot,
    );
  });

  it('records question/answer and resource grant decisions while resuming the same run', () => {
    const { events, snapshot } = applyAll([
      create,
      {
        kind: 'prepare',
        commandId: 'command:2',
        eventId: 'event:2',
        runId: 'run:1',
        expectedRevision: 1,
      },
      {
        kind: 'start',
        commandId: 'command:3',
        eventId: 'event:3',
        runId: 'run:1',
        expectedRevision: 2,
      },
      {
        kind: 'ask-question',
        commandId: 'command:4',
        eventId: 'event:4',
        runId: 'run:1',
        expectedRevision: 3,
        question: {
          questionId: 'question:audience',
          prompt: 'Should the tone be formal?',
          responseContract: { ref: 'boolean@1', hash: 'sha256:boolean' },
        },
      },
      {
        kind: 'answer-question',
        commandId: 'command:5',
        eventId: 'event:5',
        runId: 'run:1',
        expectedRevision: 4,
        questionId: 'question:audience',
        answeredBy: 'user:mike',
        answer: true,
      },
      {
        kind: 'request-resource-grant',
        commandId: 'command:6',
        eventId: 'event:6',
        runId: 'run:1',
        expectedRevision: 5,
        request: {
          requestId: 'grant:sources',
          resource: { kind: 'entity-collection', ref: 'articles', operations: ['read'] },
          reason: 'Read the source collection',
        },
      },
      {
        kind: 'decide-resource-grant',
        commandId: 'command:7',
        eventId: 'event:7',
        runId: 'run:1',
        expectedRevision: 6,
        requestId: 'grant:sources',
        decision: {
          outcome: 'granted',
          decidedBy: 'user:mike',
          grantRef: 'resource-grant:7',
        },
      },
    ]);

    expect(snapshot.runs['run:1']).toMatchObject({
      status: 'running',
      revision: 7,
      questions: [
        {
          questionId: 'question:audience',
          answer: { value: true, answeredBy: 'user:mike' },
        },
      ],
      resourceGrantRequests: [
        {
          requestId: 'grant:sources',
          decision: {
            outcome: 'granted',
            decidedBy: 'user:mike',
            grantRef: 'resource-grant:7',
          },
        },
      ],
    });
    expect(foldAgentRunEvents(events)).toEqual(snapshot);
  });

  it('enforces revision, cursor, lifecycle, eventId and commandId invariants', () => {
    const first = applyAgentRunCommand(createAgentRunSnapshot(), create);
    expect(applyAgentRunCommand(first.snapshot, create)).toEqual({
      snapshot: first.snapshot,
      events: [],
    });
    expect(() =>
      applyAgentRunCommand(first.snapshot, { ...create, commandId: 'command:collision' }),
    ).toThrow(/eventId/i);
    expect(() =>
      applyAgentRunCommand(first.snapshot, { ...create, eventId: 'event:collision' }),
    ).toThrow(/commandId/i);

    expect(() =>
      applyAgentRunCommand(first.snapshot, {
        kind: 'prepare',
        commandId: 'command:2',
        eventId: 'event:2',
        runId: 'run:1',
        expectedRevision: 0,
      }),
    ).toThrow(/revision/i);

    const terminal = applyAll([
      create,
      {
        kind: 'cancel',
        commandId: 'command:2',
        eventId: 'event:2',
        runId: 'run:1',
        expectedRevision: 1,
      },
    ]).snapshot;
    expect(() =>
      applyAgentRunCommand(terminal, {
        kind: 'prepare',
        commandId: 'command:3',
        eventId: 'event:3',
        runId: 'run:1',
        expectedRevision: 2,
      }),
    ).toThrow(/terminal/i);
  });

  it('covers every terminal status and rejects stale cursor or sequence updates', () => {
    const running = applyAll([
      create,
      {
        kind: 'prepare',
        commandId: 'command:2',
        eventId: 'event:2',
        runId: 'run:1',
        expectedRevision: 1,
      },
      {
        kind: 'start',
        commandId: 'command:3',
        eventId: 'event:3',
        runId: 'run:1',
        expectedRevision: 2,
      },
    ]).snapshot;
    expect(() =>
      applyAgentRunCommand(running, {
        kind: 'advance-cursor',
        commandId: 'command:4',
        eventId: 'event:4',
        runId: 'run:1',
        expectedRevision: 3,
        expectedCursor: 'stale',
        cursor: 'cursor:1',
        observedSequence: 1,
      }),
    ).toThrow(/cursor/i);
    expect(() =>
      applyAgentRunCommand(running, {
        kind: 'advance-cursor',
        commandId: 'command:4',
        eventId: 'event:4',
        runId: 'run:1',
        expectedRevision: 3,
        expectedCursor: null,
        cursor: 'cursor:1',
        observedSequence: 2,
      }),
    ).toThrow(/sequence/i);

    for (const terminalCommand of [
      {
        kind: 'fail' as const,
        commandId: 'terminal:failed',
        eventId: 'terminal-event:failed',
        runId: 'run:1',
        expectedRevision: 3,
        code: 'runtime-failed',
        reason: 'execution failed',
        expectedStatus: 'failed',
      },
      {
        kind: 'cancel' as const,
        commandId: 'terminal:cancelled',
        eventId: 'terminal-event:cancelled',
        runId: 'run:1',
        expectedRevision: 3,
        reason: 'cancelled by user',
        expectedStatus: 'cancelled',
      },
      {
        kind: 'mark-stale' as const,
        commandId: 'terminal:stale',
        eventId: 'terminal-event:stale',
        runId: 'run:1',
        expectedRevision: 3,
        reason: 'definition is unavailable',
        expectedStatus: 'stale',
      },
    ]) {
      const { expectedStatus, ...command } = terminalCommand;
      expect(applyAgentRunCommand(running, command).snapshot.runs['run:1']?.status).toBe(
        expectedStatus,
      );
    }
  });
});
