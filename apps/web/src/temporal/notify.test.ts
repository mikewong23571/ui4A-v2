import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SuspendedConfirmation } from '@ui4a/engine';

import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { getEngine, resetEngineForTests } from '../engine/service';

// notify 派发(T3 Phase C / Task 2,web→Temporal 接线):
// - dispatchNotify:挂起确认 → client.workflow.start('notifyWorkflow'),
//   workflowId=notify-<id>、taskQueue=ui4a、args=确认摘要;
// - 尽力而为:连接/启动失败只记日志不抛(挂起的 202 响应绝不被 notify 阻塞);
// - 失败不缓存:下次派发重连;
// - 测试默认关闭派发(process.env.VITEST 下),UI4A_NOTIFY_DISPATCH 显式开关。
const { startMock, connectMock, getHandleMock, terminateMock } = vi.hoisted(() => {
  const terminateMock = vi.fn(async () => undefined);
  return {
    startMock: vi.fn(async () => ({ workflowId: 'notify-c1' })),
    connectMock: vi.fn(async () => ({ connection: true })),
    getHandleMock: vi.fn(() => ({ terminate: terminateMock })),
    terminateMock,
  };
});

vi.mock('@temporalio/client', () => ({
  Connection: { connect: connectMock },
  // 测试替身:实现 dispatchNotify/terminateStaleNotifyWorkflows 用到的 workflow 面。
  Client: class {
    workflow = { start: startMock, getHandle: getHandleMock };
  },
}));

import {
  dispatchNotify,
  notifyDispatchEnabled,
  notifyWorkflowArgs,
  resetTemporalClientForTests,
  terminateStaleNotifyWorkflows,
} from './notify';

const suspended: SuspendedConfirmation = {
  id: 'c1',
  targetRel: 'post:post-welcome',
  targetAction: 'archive',
  params: {},
  proposedBy: { actor: 'agent', principal: 'user:mike' },
  channel: 'http',
  policyReason: 'Cedar: high 风险动作且 actor=agent,需人类确认',
};

beforeEach(() => {
  startMock.mockClear();
  connectMock.mockClear();
  getHandleMock.mockClear();
  terminateMock.mockClear();
  connectMock.mockImplementation(async () => ({ connection: true }));
  startMock.mockImplementation(async () => ({ workflowId: 'notify-c1' }));
  resetTemporalClientForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('notifyWorkflowArgs(参数映射,镜像 worker NotifyConfirmation)', () => {
  it('SuspendedConfirmation → {id, targetRel, targetAction, proposedBy, reason=policyReason}(丢弃 params/channel,最小载荷)', () => {
    expect(notifyWorkflowArgs(suspended)).toEqual({
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      reason: 'Cedar: high 风险动作且 actor=agent,需人类确认',
    });
  });
});

describe('notifyDispatchEnabled(派发开关)', () => {
  it('显式 off → 关闭;显式 on → 开启', () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'off');
    expect(notifyDispatchEnabled()).toBe(false);
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');
    expect(notifyDispatchEnabled()).toBe(true);
  });

  it('缺省:vitest 环境关闭(单测不派发真实 workflow),非测试环境开启', () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', '');
    vi.stubEnv('VITEST', 'true');
    expect(notifyDispatchEnabled()).toBe(false);
    vi.stubEnv('VITEST', '');
    expect(notifyDispatchEnabled()).toBe(true);
  });
});

describe('dispatchNotify(尽力而为派发)', () => {
  it('startWorkflow:workflowId=notify-<id>,taskQueue=ui4a,args=确认摘要', async () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');

    await dispatchNotify(suspended);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(
      'notifyWorkflow',
      expect.objectContaining({
        args: [notifyWorkflowArgs(suspended)],
        taskQueue: 'ui4a',
        workflowId: 'notify-c1',
      }),
    );
  });

  it('连接失败 → 不抛(挂起响应不受影响),只记警告日志', async () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');
    connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(dispatchNotify(suspended)).resolves.toBeUndefined();

    expect(startMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('启动失败(如 already-started)→ 不抛(幂等语义:同名 workflow 已在送达)', async () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');
    startMock.mockRejectedValueOnce(new Error('workflow execution already started'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(dispatchNotify(suspended)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('失败不缓存连接:下次派发重连', async () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');
    connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await dispatchNotify(suspended); // 失败

    await dispatchNotify(suspended); // 重连成功

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('派发关闭(vitest 缺省)→ 不触 Temporal', async () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', '');
    vi.stubEnv('VITEST', 'true');

    await dispatchNotify(suspended);

    expect(connectMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe('terminateStaleNotifyWorkflows(跨轮次残留清理)', () => {
  it('逐 id 终止 notify-<id>(terminated 状态可被下一轮 start 重用)', async () => {
    await terminateStaleNotifyWorkflows(['c1', 'c2']);

    expect(getHandleMock).toHaveBeenCalledWith('notify-c1');
    expect(getHandleMock).toHaveBeenCalledWith('notify-c2');
    expect(terminateMock).toHaveBeenCalledTimes(2);
    expect(terminateMock).toHaveBeenCalledWith('stale cleanup');
  });

  it('单个终止失败(不存在/已完成)→ 吞掉并继续其余 id(卫生动作不抛)', async () => {
    getHandleMock.mockImplementationOnce(() => ({
      terminate: vi.fn(async () => {
        throw new Error('workflow execution not found');
      }),
    }));

    await expect(terminateStaleNotifyWorkflows(['c1', 'c2'])).resolves.toBeUndefined();
    expect(terminateMock).toHaveBeenCalledTimes(1); // c2 正常终止
  });

  it('Temporal 不可达 → 静默返回(调用方已探活,此处兜底)', async () => {
    connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(terminateStaleNotifyWorkflows(['c1'])).resolves.toBeUndefined();
    expect(getHandleMock).not.toHaveBeenCalled();
  });
});

// ---- exec 挂起路径的服务层接线(真 PG;mock Temporal client)----------------

const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);

describe('exec 挂起路径派发 notify(service 接线)', () => {
  beforeEach(async () => {
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
  });

  it('agent archive 挂起 → 派发 notifyWorkflow(workflowId=notify-c1, taskQueue=ui4a)', async () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');
    const engine = await getEngine(pool);

    const outcome = await engine.exec({
      rel: 'post:post-welcome',
      action: 'archive',
      params: {},
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });

    expect(outcome.kind).toBe('suspended');
    // fire-and-forget:等微任务链完成再断言。
    await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledWith(
      'notifyWorkflow',
      expect.objectContaining({ workflowId: 'notify-c1', taskQueue: 'ui4a' }),
    );
  });

  it('派发失败不影响挂起结果:连接拒绝仍返回 suspended(Temporal 不可用时 202 照常)', async () => {
    vi.stubEnv('UI4A_NOTIFY_DISPATCH', 'on');
    connectMock.mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = await getEngine(pool);

    const outcome = await engine.exec({
      rel: 'post:post-welcome',
      action: 'archive',
      params: {},
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });

    expect(outcome.kind).toBe('suspended');
    expect(engine.getSnapshot().confirmations?.['confirmation:c1']?.status).toBe('pending');
    vi.restoreAllMocks();
  });
});
