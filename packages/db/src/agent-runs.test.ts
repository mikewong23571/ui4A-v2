import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentRunBirthReferences, AgentRunCommand, AgentTaskEnvelope } from '@ui4a/engine';

import {
  appendAgentRunCommand,
  appendAgentRunRawEvent,
  agentRunProjectionSha256,
  ensureAgentRunTables,
  findAgentRunsBySource,
  getAgentRun,
  getAgentRunResultRef,
  listAgentRunRawReceipts,
  listAgentRuns,
  readAgentRunPayload,
  rebuildAgentRunProjection,
} from './agent-runs';
import { ensureEventsTable } from './events';
import { getPool } from './pool';

const pool = getPool(process.env.DATABASE_URL!);

const birth: AgentRunBirthReferences = {
  schemaVersion: 1,
  kind: 'event-native',
  definition: {
    ref: 'writing-agent@1',
    version: 1,
    sourceHash: 'sha256:definition-source',
    parentHashes: [],
    flattenedHash: 'sha256:definition-flat',
  },
  prompt: { templateHash: 'sha256:template', compiledHash: 'sha256:compiled' },
  runtime: {
    profileName: 'document-default',
    profileVersion: '1',
    adapterVersion: 'host-v1',
  },
  taskContract: { ref: 'writing-task@1', hash: 'sha256:task-contract' },
  resultContract: { ref: 'writing-result@1', hash: 'sha256:result-contract' },
};

const task: AgentTaskEnvelope = {
  schemaVersion: 1,
  contract: birth.taskContract,
  payload: { brief: 'Explain the architecture.', audience: 'engineers' },
  contextRefs: ['entity:application'],
};

function createNative(overrides: Partial<Extract<AgentRunCommand, { kind: 'create' }>> = {}) {
  return {
    kind: 'create',
    eventId: 'event:native:create',
    commandId: 'command:native:create',
    runId: 'native-1',
    principal: 'user:mike',
    policyScope: 'publishing',
    source: {
      rel: 'writing-request:main',
      action: 'write',
      eventId: 'core:20',
      onDoneAction: 'receive-draft',
      onErrorAction: 'record-failure',
    },
    birth,
    task,
    ...overrides,
  } satisfies AgentRunCommand;
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureAgentRunTables(pool);
  await pool.query(
    `TRUNCATE agent_run_projection_state, agent_run_projection, agent_run_payloads, events`,
  );
});

describe('canonical Agent Run persistence', () => {
  it('replays native events with the same incremental and empty-rebuild hash', async () => {
    await appendAgentRunCommand(pool, createNative());
    const native = await getAgentRun(pool, 'native-1', 'user:mike', 'publishing');
    await appendAgentRunCommand(pool, {
      kind: 'prepare',
      runId: 'native-1',
      expectedRevision: native!.revision,
      eventId: 'event:native:prepare',
      commandId: 'command:native:prepare',
    });

    const incremental = await listAgentRuns(pool, {
      principal: 'user:mike',
      policyScope: 'publishing',
    });
    expect(incremental).toHaveLength(1);
    expect(incremental[0]?.status).toBe('preparing');
    const hash = agentRunProjectionSha256(incremental);

    await pool.query('TRUNCATE agent_run_projection_state, agent_run_projection');
    expect(
      await pool.query('SELECT count(*)::integer AS count FROM agent_run_projection'),
    ).toMatchObject({ rows: [{ count: 0 }] });
    await rebuildAgentRunProjection(pool);
    expect(
      agentRunProjectionSha256(
        await listAgentRuns(pool, { principal: 'user:mike', policyScope: 'publishing' }),
      ),
    ).toBe(hash);
  });

  it('isolates exact/list/source reads by owner and policy scope', async () => {
    await appendAgentRunCommand(pool, createNative());
    await expect(
      getAgentRun(pool, 'native-1', 'user:other', 'publishing'),
    ).resolves.toBeUndefined();
    await expect(getAgentRun(pool, 'native-1', 'user:mike', 'other')).resolves.toBeUndefined();
    await expect(
      listAgentRuns(pool, { principal: 'user:other', policyScope: 'publishing' }),
    ).resolves.toEqual([]);
    await expect(
      findAgentRunsBySource(pool, 'writing-request:main', 'user:mike', 'other'),
    ).resolves.toEqual([]);
    await expect(
      findAgentRunsBySource(pool, 'writing-request:main', 'user:mike', 'publishing'),
    ).resolves.toHaveLength(1);
  });

  it('persists native cursor, question, grant, result, and cancellation transitions', async () => {
    let run = (await appendAgentRunCommand(pool, createNative())).aggregate;
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'prepare',
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: 'event:prepare',
        commandId: 'command:prepare',
      })
    ).aggregate;
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'start',
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: 'event:start',
        commandId: 'command:start',
        handle: { sessionRef: 'opaque-session' },
      })
    ).aggregate;
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'advance-cursor',
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: 'event:cursor',
        commandId: 'command:cursor',
        expectedCursor: null,
        cursor: 'cursor:1',
        observedSequence: 1,
      })
    ).aggregate;
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'ask-question',
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: 'event:question',
        commandId: 'command:question',
        question: { questionId: 'q1', prompt: 'Which audience?' },
      })
    ).aggregate;
    expect(run.status).toBe('needs-input');
    run = (
      await appendAgentRunCommand(
        pool,
        {
          kind: 'answer-question',
          runId: run.runId,
          expectedRevision: run.revision,
          eventId: 'event:answer',
          commandId: 'command:answer',
          questionId: 'q1',
          answeredBy: 'user:mike',
          answer: { audience: 'maintainers' },
        },
        'human',
      )
    ).aggregate;
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'request-resource-grant',
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: 'event:grant-request',
        commandId: 'command:grant-request',
        request: {
          requestId: 'g1',
          resource: { kind: 'source', ref: 'entity:guide', operations: ['read'] },
          reason: 'Need the approved source.',
        },
      })
    ).aggregate;
    run = (
      await appendAgentRunCommand(
        pool,
        {
          kind: 'decide-resource-grant',
          runId: run.runId,
          expectedRevision: run.revision,
          eventId: 'event:grant-decision',
          commandId: 'command:grant-decision',
          requestId: 'g1',
          decision: {
            outcome: 'granted',
            decidedBy: 'user:mike',
            grantRef: 'grant:g1',
          },
        },
        'human',
      )
    ).aggregate;
    const completed = await appendAgentRunCommand(pool, {
      kind: 'succeed',
      runId: run.runId,
      expectedRevision: run.revision,
      eventId: 'event:succeed',
      commandId: 'command:succeed',
      result: {
        schemaVersion: 1,
        contract: birth.resultContract,
        resultId: 'result:1',
        payload: { markdown: '# Architecture' },
        artifacts: [{ ref: 'document:1', hash: 'sha256:document', mediaType: 'text/markdown' }],
        evidence: [{ ref: 'render:1', kind: 'render-receipt' }],
        proposedEffects: [],
      },
    });
    expect(completed.aggregate).toMatchObject({
      status: 'succeeded',
      cursor: 'cursor:1',
      questions: [{ questionId: 'q1', answer: { answeredBy: 'user:mike' } }],
      resourceGrantRequests: [{ requestId: 'g1', decision: { outcome: 'granted' } }],
      result: { resultId: 'result:1' },
    });
    expect(completed.resultRef).toMatch(/^sha256:/);
    expect(await readAgentRunPayload(pool, completed.resultRef!)).toEqual(
      completed.aggregate.result,
    );
    const stored = await pool.query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM events WHERE kind='agent-run-succeeded'",
    );
    expect(stored.rows[0]?.detail).toHaveProperty('resultRef', completed.resultRef);
    expect(stored.rows[0]?.detail).not.toHaveProperty('result');
    expect(await getAgentRunResultRef(pool, 'native-1')).toBe(completed.resultRef);

    let cancellable = (
      await appendAgentRunCommand(
        pool,
        createNative({
          runId: 'native-cancel',
          eventId: 'event:cancel-run:create',
          commandId: 'command:cancel-run:create',
          source: { rel: 'writing-request:cancel', action: 'write', eventId: 'core:21' },
        }),
      )
    ).aggregate;
    cancellable = (
      await appendAgentRunCommand(
        pool,
        {
          kind: 'cancel',
          runId: cancellable.runId,
          expectedRevision: cancellable.revision,
          eventId: 'event:cancel-run',
          commandId: 'command:cancel-run',
          reason: 'cancelled by user',
        },
        'human',
      )
    ).aggregate;
    expect(cancellable.status).toBe('cancelled');
  });

  it('content-addresses raw frames and enforces raw event budgets', async () => {
    await appendAgentRunCommand(pool, createNative());
    const receipt = await appendAgentRunRawEvent(pool, {
      runId: 'native-1',
      principal: 'user:mike',
      policyScope: 'publishing',
      ordinal: 1,
      cursor: 'raw:1',
      redactedPayload: { message: 'safe output', secret: '[REDACTED]' },
    });
    expect(receipt.payloadRef).toMatch(/^sha256:/);
    expect(await readAgentRunPayload(pool, receipt.payloadRef)).toEqual({
      message: 'safe output',
      secret: '[REDACTED]',
    });
    expect(await listAgentRunRawReceipts(pool, 'native-1')).toEqual([
      expect.objectContaining({ payloadRef: receipt.payloadRef, redacted: true }),
    ]);
    await expect(
      appendAgentRunRawEvent(pool, {
        runId: 'native-1',
        principal: 'user:other',
        policyScope: 'publishing',
        ordinal: 2,
        redactedPayload: { hidden: true },
      }),
    ).rejects.toThrow('not authorized');
    await expect(
      appendAgentRunRawEvent(pool, {
        runId: 'native-1',
        principal: 'user:mike',
        policyScope: 'publishing',
        ordinal: 2,
        redactedPayload: { value: 'x'.repeat(70 * 1024) },
      }),
    ).rejects.toThrow('chunk budget');
    expect(
      Number(
        (await pool.query<{ count: string }>('SELECT count(*) AS count FROM agent_run_payloads'))
          .rows[0]?.count ?? 0,
      ),
    ).toBe(1);
  });
});
