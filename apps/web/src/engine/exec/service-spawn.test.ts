// T55/D76:exec 闭包内 spawn-dispatch 准备与派发段(service-spawn)的模块测试。
// 语义取自原 service.ts exec 闭包:遍历 effectiveEvents 的 spawn-requested(带
// capability 且 capability.executor 在场才准备;源实例缺失即内部不变式错误)→
// 落库后按 prepared 类型派发(native-function 直启;agent 走 Agent Run 派发 +
// 失败回调留痕;prepared 缺失即抛)。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareCapabilityDispatch: vi.fn(),
  startNativeFunctionDispatch: vi.fn(async () => undefined),
  createAndDispatchAgentRun: vi.fn(),
  prepareNativeAgentDispatch: vi.fn(),
  persistFailedAgentDispatchCallback: vi.fn(async () => undefined),
  artifactModelFor: vi.fn(() => ({ model: 'fixture' })),
}));

vi.mock('../capability/dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../capability/dispatch')>();
  return {
    ...actual,
    prepareCapabilityDispatch: mocks.prepareCapabilityDispatch,
    startNativeFunctionDispatch: mocks.startNativeFunctionDispatch,
  };
});
vi.mock('../agent/native-agent-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/native-agent-dispatch')>();
  return {
    ...actual,
    createAndDispatchAgentRun: mocks.createAndDispatchAgentRun,
    prepareNativeAgentDispatch: mocks.prepareNativeAgentDispatch,
  };
});
vi.mock('../service-artifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service-artifacts')>();
  return {
    ...actual,
    artifactModelFor: mocks.artifactModelFor,
  };
});
vi.mock('../service-capability-callback', () => ({
  persistFailedAgentDispatchCallback: mocks.persistFailedAgentDispatchCallback,
}));

import { createCoreEventLogState } from '../service-event-log';

const SOURCE_INSTANCE = { rel: 'application:1', flow: 'demo-flow', node: 'run', fields: {} };

function logStateWith(capabilityExecutor: unknown) {
  const logState = createCoreEventLogState([]);
  (logState as { snapshot: unknown }).snapshot = {
    instances: { 'application:1': SOURCE_INSTANCE },
    capabilities: {
      'cap-1': { name: 'cap-1', ...(capabilityExecutor === undefined ? {} : { executor: capabilityExecutor }) },
    },
  };
  return logState;
}

const spawnEvent = (capability = 'cap-1') =>
  ({ seq: 0, kind: 'spawn-requested', rel: 'application:1', action: 'run', capability }) as never;

function prepareArgs(logState: ReturnType<typeof logStateWith>, events: unknown[]) {
  return {
    db: { kind: 'test-db' } as never,
    logState,
    aliased: { rel: 'application:1', action: 'run', params: {} } as never,
    effectiveEvents: events as never[],
    productionConfig: undefined,
  };
}

describe('prepareSpawnPlan(T55 FR4.2 spawn 准备段)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('仅为 executor 在场的 spawn-requested 事件准备 dispatch;源实例缺失即抛', async () => {
    const { prepareSpawnPlan } = await import('./service-spawn');
    const prepared = { kind: 'native-function', prepared: { x: 1 } } as never;
    mocks.prepareCapabilityDispatch.mockResolvedValue(prepared);
    const logState = logStateWith({ profile: 'p1' });
    const events = [spawnEvent(), { seq: 0, kind: 'action-executed', rel: 'application:1' } as never];
    const plan = await prepareSpawnPlan(prepareArgs(logState, events));
    expect(mocks.prepareCapabilityDispatch).toHaveBeenCalledTimes(1);
    expect(plan.preparedDispatches.get(events[0]!)).toBe(prepared);
    expect(plan.artifactModel).toEqual({ model: 'fixture' });

    const missingSource = createCoreEventLogState([]);
    (missingSource as { snapshot: unknown }).snapshot = {
      instances: {},
      capabilities: { 'cap-1': { executor: { profile: 'p1' } } },
    };
    await expect(
      prepareSpawnPlan(prepareArgs(missingSource, [spawnEvent()])),
    ).rejects.toThrow('spawn source instance is missing');
  });

  it('capability 缺失或 executor 缺失时跳过准备(不失败)', async () => {
    const { prepareSpawnPlan } = await import('./service-spawn');
    const logState = logStateWith(undefined);
    const plan = await prepareSpawnPlan(prepareArgs(logState, [spawnEvent('unknown-cap')]));
    expect(mocks.prepareCapabilityDispatch).not.toHaveBeenCalled();
    expect(plan.preparedDispatches.size).toBe(0);
  });
});

describe('dispatchSpawnPlan(T55 FR4.2 spawn 派发段)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('native-function 直启;agent 走 Agent Run 派发 + 失败回调留痕;prepared 缺失即抛', async () => {
    const { dispatchSpawnPlan } = await import('./service-spawn');
    const logState = logStateWith({ profile: 'p1' });
    const nativePrepared = {
      kind: 'native-function',
      prepared: { handle: 'n1' },
    } as never;
    const agentPrepared = { kind: 'agent', prepared: { run: 'a1' } } as never;
    const events = [spawnEvent(), spawnEvent()];
    const plan = {
      artifactModel: { model: 'fixture' },
      effectiveEvents: events,
      preparedDispatches: new Map<unknown, unknown>([
        [events[0], nativePrepared],
        [events[1], agentPrepared],
      ]),
    } as never;
    mocks.createAndDispatchAgentRun.mockResolvedValue({ id: 'run-1' });
    await dispatchSpawnPlan({
      db: { kind: 'test-db' } as never,
      logState,
      plan,
      effectiveSeqs: [11, 12],
      aliased: { rel: 'application:1', action: 'run' } as never,
      gateDeps: () => ({}) as never,
    });
    expect(mocks.startNativeFunctionDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.createAndDispatchAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.persistFailedAgentDispatchCallback).toHaveBeenCalledTimes(1);

    const noPrepared = {
      artifactModel: { model: 'fixture' },
      effectiveEvents: [spawnEvent()],
      preparedDispatches: new Map(),
    } as never;
    await expect(
      dispatchSpawnPlan({
        db: { kind: 'test-db' } as never,
        logState,
        plan: noPrepared,
        effectiveSeqs: [11],
        aliased: { rel: 'application:1', action: 'run' } as never,
        gateDeps: () => ({}) as never,
      }),
    ).rejects.toThrow('spawn dispatch missed its prepared executor');
  });
});
