// T55/D76:exec 闭包内挂起物化段(service-confirmation.materializeSuspension)测试。
// 语义取自原 service.ts exec 闭包:suspended 伴随事件一次落库 → 快照推进 →
// foreignGaps 补折 → confirmation:<id> 实体投影(不可投影即内部不变式错误)→
// notify 派发(尽力而为,不 await)→ 返回 suspended ExecOutcome。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendBatchWithSeq: vi.fn(async () => []),
  applyForeignGaps: vi.fn(),
  project: vi.fn(),
  dispatchNotify: vi.fn(),
}));

vi.mock('./service-event-log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service-event-log')>();
  return {
    ...actual,
    appendBatchWithSeq: mocks.appendBatchWithSeq,
    applyForeignGaps: mocks.applyForeignGaps,
  };
});
vi.mock('@ui4a/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui4a/engine')>();
  return {
    ...actual,
    project: mocks.project,
  };
});
vi.mock('../temporal/notify', () => ({ dispatchNotify: mocks.dispatchNotify }));

import { createCoreEventLogState } from './service-event-log';
import { engineEventToAppend as toAppend } from './service-event-append';

const CONFIRMATION = { id: 'c7', rel: 'confirmation:c7' } as never;

function outcomeFixture() {
  return {
    kind: 'suspended',
    events: [{ seq: 0, kind: 'confirmation-requested', rel: 'confirmation:c7' }],
    snapshot: { instances: {} },
    confirmation: CONFIRMATION,
  } as never;
}

describe('materializeSuspension(T55 FR4.2 confirmation 挂起物化段)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('伴随事件落库、快照推进、confirmation 实体投影、notify 尽力派发', async () => {
    const { materializeSuspension } = await import('./service-confirmation');
    const entity = { class: ['confirmation'] };
    mocks.project.mockReturnValue(entity);
    const logState = createCoreEventLogState([]);
    const result = await materializeSuspension({
      db: { kind: 'test-db' } as never,
      logState,
      toAppend,
      projectDeps: () => ({ flows: {}, guards: {}, versions: {} }),
      outcome: outcomeFixture(),
      dispatchNotify: mocks.dispatchNotify,
    });
    expect(mocks.appendBatchWithSeq).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: 'suspended',
      entity,
      confirmation: CONFIRMATION,
    });
    expect(mocks.project).toHaveBeenCalledWith(
      logState.snapshot,
      'confirmation:c7',
      expect.anything(),
    );
    expect(mocks.dispatchNotify).toHaveBeenCalledWith(CONFIRMATION);
    expect(mocks.applyForeignGaps).toHaveBeenCalledTimes(1);
  });

  it('挂起后确认实体不可投影 → 内部不变式错误(不静默放行)', async () => {
    const { materializeSuspension } = await import('./service-confirmation');
    mocks.project.mockReturnValue(undefined);
    await expect(
      materializeSuspension({
        db: { kind: 'test-db' } as never,
        logState: createCoreEventLogState([]),
        toAppend,
        projectDeps: () => ({ flows: {}, guards: {}, versions: {} }),
        outcome: outcomeFixture(),
        dispatchNotify: mocks.dispatchNotify,
      }),
    ).rejects.toThrow('不可投影(内部不变式破坏)');
  });
});
