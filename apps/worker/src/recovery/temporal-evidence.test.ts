import { describe, expect, it, vi } from 'vitest';

import {
  buildTemporalHistoryEvidence,
  verifyTemporalHistoryRecovery,
  type TemporalHistoryReader,
  type TemporalWorkflowHistory,
} from './temporal-evidence';

const STARTED = 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED';
const TASK = 'EVENT_TYPE_WORKFLOW_TASK_COMPLETED';
const COMPLETED = 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED';
const FAILED = 'EVENT_TYPE_WORKFLOW_EXECUTION_FAILED';

function history(
  status: TemporalWorkflowHistory['status'],
  eventTypes: string[],
  overrides: Partial<TemporalWorkflowHistory> = {},
): TemporalWorkflowHistory {
  return {
    workflowId: 'agent-run-42',
    runId: '0196f99e-15c7-7dd0-9d42-5021d5c71f42',
    status,
    events: eventTypes.map((eventType, index) => ({
      eventId: index + 1,
      eventType,
      payload: {
        prompt: '__private_prompt__',
        token: '__private_token__',
      },
    })),
    ...overrides,
  };
}

function reader(value: TemporalWorkflowHistory): TemporalHistoryReader {
  return { read: vi.fn(async () => structuredClone(value)) };
}

describe('canonical Temporal history recovery evidence', () => {
  it('fingerprints identity, status, ordered ids/types/count and digest without payload material', () => {
    const source = history('completed', [STARTED, TASK, COMPLETED]);

    const evidence = buildTemporalHistoryEvidence(source);

    expect(evidence).toEqual({
      schemaVersion: 1,
      workflowId: 'agent-run-42',
      runId: '0196f99e-15c7-7dd0-9d42-5021d5c71f42',
      status: 'completed',
      historyEventIds: [1, 2, 3],
      historyEventTypes: [STARTED, TASK, COMPLETED],
      historyEventCount: 3,
      historyDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('__private_prompt__');
    expect(serialized).not.toContain('__private_token__');
    expect(evidence).not.toHaveProperty('events');
  });

  it('is stable for equivalent cloned input and changes for identity, status, id, or type', () => {
    const source = history('completed', [STARTED, TASK, COMPLETED]);
    const baseline = buildTemporalHistoryEvidence(source);

    expect(buildTemporalHistoryEvidence(structuredClone(source))).toEqual(baseline);
    for (const changed of [
      { ...source, workflowId: 'agent-run-43' },
      { ...source, runId: '0196f99e-15c7-7dd0-9d42-5021d5c71f43' },
      history('failed', [STARTED, TASK, FAILED]),
      {
        ...source,
        events: source.events.map((event, index) =>
          index === 2 ? { ...event, eventId: 4 } : event,
        ),
      },
      history('completed', [STARTED, 'EVENT_TYPE_WORKFLOW_TASK_FAILED', COMPLETED]),
    ]) {
      expect(buildTemporalHistoryEvidence(changed).historyDigest).not.toBe(baseline.historyDigest);
    }
  });

  it('requires exact evidence equality for a workflow already completed before restore', async () => {
    const completed = history('completed', [STARTED, TASK, COMPLETED]);
    const sourceReader = reader(completed);
    const restoredReader = reader(completed);

    await expect(
      verifyTemporalHistoryRecovery(
        { workflowId: completed.workflowId, runId: completed.runId },
        { source: sourceReader, restored: restoredReader },
      ),
    ).resolves.toEqual({
      kind: 'closed-exact-match',
      source: buildTemporalHistoryEvidence(completed),
      restored: buildTemporalHistoryEvidence(completed),
    });
    expect(sourceReader.read).toHaveBeenCalledOnce();
    expect(restoredReader.read).toHaveBeenCalledOnce();
  });

  it('rejects any legal but non-identical restored history for a completed source', async () => {
    const source = history('completed', [STARTED, TASK, COMPLETED]);
    const restored = history('completed', [
      STARTED,
      TASK,
      'EVENT_TYPE_WORKFLOW_TASK_SCHEDULED',
      COMPLETED,
    ]);

    await expect(
      verifyTemporalHistoryRecovery(
        { workflowId: source.workflowId, runId: source.runId },
        { source: reader(source), restored: reader(restored) },
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'TEMPORAL_HISTORY_CLOSED_MISMATCH' }));
  });

  it('accepts a running source only when the restored history extends it to one legal terminal', async () => {
    const source = history('running', [STARTED, TASK]);
    const restored = history('completed', [STARTED, TASK, COMPLETED]);

    await expect(
      verifyTemporalHistoryRecovery(
        { workflowId: source.workflowId, runId: source.runId },
        { source: reader(source), restored: reader(restored) },
      ),
    ).resolves.toMatchObject({
      kind: 'open-advanced-to-terminal',
      source: { status: 'running', historyEventCount: 2 },
      restored: { status: 'completed', historyEventCount: 3 },
    });
  });

  it.each([
    [
      'missing source event',
      history('running', [STARTED, TASK]),
      history('completed', [STARTED, COMPLETED]),
      'TEMPORAL_HISTORY_PREFIX_MISMATCH',
    ],
    [
      'reordered history',
      history('running', [STARTED, TASK]),
      history('completed', [STARTED, TASK, COMPLETED], {
        events: [
          { eventId: 1, eventType: STARTED },
          { eventId: 3, eventType: COMPLETED },
          { eventId: 2, eventType: TASK },
        ],
      }),
      'TEMPORAL_HISTORY_EVENT_ORDER_INVALID',
    ],
    [
      'duplicate completion',
      history('running', [STARTED, TASK]),
      history('completed', [STARTED, TASK, COMPLETED, COMPLETED]),
      'TEMPORAL_HISTORY_COMPLETION_INVALID',
    ],
    [
      'still open after restore',
      history('running', [STARTED, TASK]),
      history('running', [STARTED, TASK, 'EVENT_TYPE_WORKFLOW_TASK_SCHEDULED']),
      'TEMPORAL_HISTORY_RESTORED_NOT_TERMINAL',
    ],
  ])('rejects open-workflow recovery with %s', async (_name, source, restored, code) => {
    await expect(
      verifyTemporalHistoryRecovery(
        { workflowId: source.workflowId, runId: source.runId },
        { source: reader(source), restored: reader(restored) },
      ),
    ).rejects.toEqual(expect.objectContaining({ code }));
  });

  it('rejects illegal status and a restored workflow identity mismatch', async () => {
    const source = history('running', [STARTED, TASK]);
    expect(() =>
      buildTemporalHistoryEvidence({ ...source, status: 'paused' as 'running' }),
    ).toThrow(expect.objectContaining({ code: 'TEMPORAL_HISTORY_STATUS_INVALID' }));

    await expect(
      verifyTemporalHistoryRecovery(
        { workflowId: source.workflowId, runId: source.runId },
        {
          source: reader(source),
          restored: reader(
            history('completed', [STARTED, TASK, COMPLETED], { runId: 'different-run' }),
          ),
        },
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'TEMPORAL_HISTORY_IDENTITY_MISMATCH' }));
  });
});
