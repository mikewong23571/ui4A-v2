// T55/D76:exec 编排入口(service-exec)的路由与批量裁决测试。
// 语义取自原 service.ts exec/execPlan 闭包:别名解析 → 三面路由(confirmation/
// thread/meta vs 业务 gates)→ 拒绝留痕 → 挂起物化 → spawn 管线 → 回执投影。
// 域模块以注入 mock 替身,验证编排顺序与数据流(域语义由各自模块测试与
// service-tests 端到端覆盖)。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execConfirmationDecision: vi.fn(),
  execThreadAction: vi.fn(),
  persistRejection: vi.fn(),
  materializeSuspension: vi.fn(),
  refreshFromLog: vi.fn(async () => undefined),
  appendBatchWithSeq: vi.fn(async (): Promise<number[]> => []),
  applyForeignGaps: vi.fn(),
  executeMeta: vi.fn(),
  executeWithGates: vi.fn(),
  executePlan: vi.fn(),
  project: vi.fn(),
  resolveFlowRelAlias: vi.fn(() => undefined),
  dispatchNotify: vi.fn(),
  scheduleRecipes: vi.fn(),
}));

vi.mock('../service-confirmation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service-confirmation')>();
  return {
    ...actual,
    execConfirmationDecision: mocks.execConfirmationDecision,
    persistRejection: mocks.persistRejection,
    materializeSuspension: mocks.materializeSuspension,
  };
});
vi.mock('../service-thread', () => ({ execThreadAction: mocks.execThreadAction }));
vi.mock('../service-event-log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service-event-log')>();
  return {
    ...actual,
    refreshFromLog: mocks.refreshFromLog,
    appendBatchWithSeq: mocks.appendBatchWithSeq,
    applyForeignGaps: mocks.applyForeignGaps,
  };
});
vi.mock('@ui4a/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui4a/engine')>();
  return {
    ...actual,
    executeMeta: mocks.executeMeta,
    executeWithGates: mocks.executeWithGates,
    executePlan: mocks.executePlan,
    project: mocks.project,
  };
});
vi.mock('../flow-entry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../flow-entry')>();
  return {
    ...actual,
    resolveFlowRelAlias: mocks.resolveFlowRelAlias,
  };
});

import { createCoreEventLogState } from '../service-event-log';
import { engineEventToAppend as toAppend } from '../service-event-append';

async function buildExecCore() {
  const mod = await import('./service-exec');
  return mod;
}

function coreDeps() {
  return {
    db: { kind: 'test-db' } as never,
    logState: createCoreEventLogState([]),
    toAppend,
    gateDeps: () => ({ flows: {}, guards: {}, policy: null as never, versions: {} }),
    confirmDeps: () => ({ flows: {}, guards: {}, versions: {} }) as never,
    projectDeps: () => ({ flows: {}, guards: {}, versions: {} }),
    metaDeps: () => ({ guards: {}, policy: null as never }) as never,
    dispatchNotify: mocks.dispatchNotify,
    scheduleRecipes: mocks.scheduleRecipes,
  };
}

const rejectedOutcome = {
  kind: 'rejected',
  layer: 'guard-failed',
  reason: 'nope',
} as const;

describe('execCore 三面路由(T55 FR4.2 confirmation/thread/meta 段)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshFromLog.mockResolvedValue(undefined);
  });

  it('confirmation rel → 人类裁决入口 execConfirmationDecision', async () => {
    const { execCore } = await buildExecCore();
    mocks.execConfirmationDecision.mockResolvedValue({ kind: 'accepted', entity: {}, appended: [] });
    const deps = coreDeps();
    const result = await execCore(deps, { rel: 'confirmation:c1', action: 'approve' } as never);
    expect(mocks.execConfirmationDecision).toHaveBeenCalledTimes(1);
    expect(mocks.executeWithGates).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'accepted', entity: {}, appended: [] });
  });

  it('thread rel → execThreadAction', async () => {
    const { execCore } = await buildExecCore();
    mocks.execThreadAction.mockResolvedValue({ kind: 'accepted', entity: {}, appended: [] });
    await execCore(coreDeps(), { rel: 'thread:abc', action: 'x' } as never);
    expect(mocks.execThreadAction).toHaveBeenCalledTimes(1);
    expect(mocks.executeWithGates).not.toHaveBeenCalled();
  });

  it('meta rel → executeMeta;业务 rel → executeWithGates', async () => {
    const { execCore } = await buildExecCore();
    mocks.executeMeta.mockReturnValue(rejectedOutcome);
    mocks.executeWithGates.mockReturnValue(rejectedOutcome);
    await execCore(coreDeps(), { rel: 'meta/flow:demo', action: 'edit' } as never);
    expect(mocks.executeMeta).toHaveBeenCalledTimes(1);
    mocks.executeMeta.mockClear();
    await execCore(coreDeps(), { rel: 'application:1', action: 'x' } as never);
    expect(mocks.executeWithGates).toHaveBeenCalledTimes(1);
    expect(mocks.executeMeta).not.toHaveBeenCalled();
  });

  it('拒绝走 persistRejection;挂起走 materializeSuspension', async () => {
    const { execCore } = await buildExecCore();
    mocks.executeWithGates.mockReturnValue(rejectedOutcome);
    mocks.persistRejection.mockResolvedValue({ kind: 'rejected', layer: 'guard-failed', reason: 'nope' });
    await execCore(coreDeps(), { rel: 'application:1', action: 'x' } as never);
    expect(mocks.persistRejection).toHaveBeenCalledTimes(1);
    expect(mocks.persistRejection.mock.calls[0]![3]).toMatchObject({ rel: 'application:1' });

    const suspended = {
      kind: 'suspended',
      events: [],
      snapshot: {},
      confirmation: { id: 'c9' },
    } as never;
    mocks.executeWithGates.mockReturnValue(suspended);
    mocks.materializeSuspension.mockResolvedValue({ kind: 'suspended', entity: {}, confirmation: { id: 'c9' } });
    await execCore(coreDeps(), { rel: 'application:1', action: 'x' } as never);
    expect(mocks.materializeSuspension).toHaveBeenCalledTimes(1);
  });
});

describe('execPlanCore 批量裁决编排(T55 FR4.2;T6 语义保持)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('伴随事件 + 拒绝步留痕 + plan-executed 标记一次落库;entities 保序去重', async () => {
    const { execPlanCore } = await buildExecCore();
    const executed = { step: 1, outcome: 'executed', rel: 'application:1', appended: ['article:1'] };
    const rejectedStep = {
      step: 2,
      outcome: 'rejected',
      rel: 'application:2',
      rejection: { layer: 'guard-failed', reason: 'no' },
    };
    const outcome = {
      kind: 'plan-completed',
      events: [{ seq: 0, kind: 'action-executed', rel: 'application:1', action: 'x' }],
      results: [executed, rejectedStep],
      record: { seq: 0, kind: 'plan-executed', rel: 'plan:p1' },
      snapshot: {},
    } as never;
    mocks.executePlan.mockReturnValue(outcome);
    mocks.appendBatchWithSeq.mockResolvedValue([1, 2]);
    const deps = coreDeps();
    const result = await execPlanCore(deps, [
      { rel: 'application:1', action: 'x' } as never,
      { rel: 'application:2', action: 'y' } as never,
    ]);
    expect(result).toMatchObject({ kind: 'plan-completed', entities: ['application:1', 'article:1'] });
    const batch = (mocks.appendBatchWithSeq.mock.calls[0] as unknown[])[2] as unknown[];
    // 伴随事件 + 拒绝步留痕 + plan-executed 记录
    expect(batch).toHaveLength(3);
    expect(mocks.appendBatchWithSeq).toHaveBeenCalledTimes(1);
    expect(mocks.applyForeignGaps).toHaveBeenCalledTimes(1);
  });
});
