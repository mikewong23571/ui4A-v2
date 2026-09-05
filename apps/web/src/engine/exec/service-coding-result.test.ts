// T55/D76:exec 闭包内 coding-result 预检段(service-coding-result)的模块测试。
// 语义取自原 service.ts exec 闭包:decision 动作查表(快照 instances + 活跃定义)
// → preflight;denied/stale → guard-failed 拒绝留痕;approved → 事件装饰
// codingDecision receipt(仅 action-executed kind)。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preflightCodingResultDecision: vi.fn(),
  persistRejection: vi.fn(),
}));

vi.mock('../agent/coding-result-decision', () => ({
  preflightCodingResultDecision: mocks.preflightCodingResultDecision,
}));
vi.mock('../service-confirmation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service-confirmation')>();
  return {
    ...actual,
    persistRejection: mocks.persistRejection,
  };
});

import { createCoreEventLogState } from '../service-event-log';
import { engineEventToAppend as toAppend } from '../service-event-append';

const FLOW = 'demo-flow';

function snapshotWithDecisionAction(decision: unknown) {
  return {
    instances: {
      'application:1': { rel: 'application:1', flow: FLOW, node: 'review' },
    },
    definitions: {
      [FLOW]: { version: 1 },
    },
    definitionVersions: {
      [FLOW]: {
        1: {
          name: FLOW,
          app: 'default',
          nodes: [
            {
              name: 'review',
              actions: [
                {
                  name: 'submit',
                  ...(decision === undefined ? {} : { decision }),
                },
              ],
            },
          ],
        },
      },
    },
  };
}

function args(events: unknown[], snapshot: unknown) {
  const logState = createCoreEventLogState([]);
  (logState as { snapshot: unknown }).snapshot = snapshot;
  return {
    db: { kind: 'test-db' } as never,
    logState,
    toAppend,
    aliased: { rel: 'application:1', action: 'submit' } as never,
    events: events as never[],
  };
}

describe('resolveCodingResultDecision(T55 FR4.2 coding-result 预检段)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('动作无 decision 声明时不做预检,事件原样', async () => {
    const { resolveCodingResultDecision } = await import('./service-coding-result');
    const events = [{ seq: 0, kind: 'action-executed', rel: 'application:1', action: 'submit' }];
    const result = await resolveCodingResultDecision(args(events, snapshotWithDecisionAction(undefined)));
    expect(mocks.preflightCodingResultDecision).not.toHaveBeenCalled();
    expect(result).toEqual({ effectiveEvents: events });
  });

  it('decision approved:action-executed 事件装饰 codingDecision receipt', async () => {
    const { resolveCodingResultDecision } = await import('./service-coding-result');
    const receipt = { decision: 'approved', receiptId: 'r1' };
    mocks.preflightCodingResultDecision.mockResolvedValue({ decision: 'approved', receipt });
    const events = [{ seq: 0, kind: 'action-executed', rel: 'application:1', action: 'submit', detail: {} }];
    const result = (await resolveCodingResultDecision(
      args(events, snapshotWithDecisionAction({ runtime: 'coding' })),
    )) as unknown as { effectiveEvents: Array<{ detail?: Record<string, unknown> }> };
    const decorated = result.effectiveEvents[0] as { detail: Record<string, unknown> };
    expect(decorated.detail?.codingDecision).toEqual(receipt);
  });

  it('decision denied:guard-failed 拒绝留痕并短路返回', async () => {
    const { resolveCodingResultDecision } = await import('./service-coding-result');
    mocks.preflightCodingResultDecision.mockResolvedValue({
      decision: 'denied',
      reason: 'stale base',
    });
    const rejection = { kind: 'rejected', layer: 'guard-failed', reason: 'stale base' };
    mocks.persistRejection.mockResolvedValue(rejection);
    const events = [{ seq: 0, kind: 'action-executed', rel: 'application:1', action: 'submit' }];
    const result = await resolveCodingResultDecision(
      args(events, snapshotWithDecisionAction({ runtime: 'coding' })),
    );
    expect(mocks.persistRejection).toHaveBeenCalledTimes(1);
    expect(mocks.persistRejection.mock.calls[0]![4]).toMatchObject({
      layer: 'guard-failed',
      reason: 'stale base',
    });
    expect(result).toEqual(rejection);
  });
});
