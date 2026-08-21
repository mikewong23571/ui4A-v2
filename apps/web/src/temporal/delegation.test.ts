import { beforeEach, describe, expect, it, vi } from 'vitest';

// delegation 派发(T5 Phase B / Task 1,web→Temporal 接线):
// - dispatchDelegation:goal/driverKind/startRel/principal/baseUrl →
//   client.workflow.start('delegationWorkflow', workflowId=delegation-<uuid>,
//   taskQueue=ui4a);
// - 与 notify 不同:派发失败**向上抛**(调用方 /api/chat 据实 503——委托没派出去
//   不能假装成功;notify 是 fire-and-forget,语义不同);
// - 失败不缓存连接:下次派发重连(Temporal 恢复后自愈)。
const { startMock, connectMock } = vi.hoisted(() => ({
  startMock: vi.fn(
    async (_workflow: string, _options?: Record<string, unknown>) => ({ workflowId: 'delegation-stub' }),
  ),
  connectMock: vi.fn(async () => ({ connection: true })),
}));

vi.mock('@temporalio/client', () => ({
  Connection: { connect: connectMock },
  // 测试替身:实现 dispatchDelegation 用到的 workflow 面。
  Client: class {
    workflow = { start: startMock };
  },
}));

import {
  dispatchDelegation,
  resetTemporalDelegationClientForTests,
  type DelegationDispatchArgs,
} from './delegation';

const args: DelegationDispatchArgs = {
  goal: { verb: '发布一篇文章', fields: { title: '舰队首航' } },
  driverKind: 'rule',
  startRel: 'articles',
  principal: 'user:sess-1',
  baseUrl: 'http://127.0.0.1:3100',
};

beforeEach(() => {
  startMock.mockClear();
  connectMock.mockClear();
  connectMock.mockImplementation(async () => ({ connection: true }));
  startMock.mockImplementation(
    async (_workflow: string, _options?: Record<string, unknown>) => ({ workflowId: 'delegation-stub' }),
  );
  resetTemporalDelegationClientForTests();
});

describe('dispatchDelegation(委托派发)', () => {
  it('startWorkflow:workflowId=delegation-<uuid>,taskQueue=ui4a,args=委托参数', async () => {
    const { delegationId } = await dispatchDelegation(args);

    expect(startMock).toHaveBeenCalledTimes(1);
    const call = startMock.mock.calls[0]!;
    expect(call[0]).toBe('delegationWorkflow');
    expect(call[1]!).toMatchObject({
      taskQueue: 'ui4a',
      args: [args],
    });
    const workflowId = call[1]!.workflowId as string;
    expect(workflowId).toMatch(/^delegation-[0-9a-f-]{36}$/);
    // delegationId 即 workflowId 全量(含前缀):worker 侧事件 rel=
    // delegation:<workflowId>,statusUrl 直查该 id 才能命中(手工验证锚定)。
    expect(delegationId).toBe(workflowId);
  });

  it('两次派发生成不同 uuid(并行委托各自独立)', async () => {
    const first = await dispatchDelegation(args);
    const second = await dispatchDelegation(args);
    expect(first.delegationId).not.toBe(second.delegationId);
  });

  it('连接失败 → 向上抛(调用方据实 503,不吞)', async () => {
    connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(dispatchDelegation(args)).rejects.toThrow('ECONNREFUSED');
    expect(startMock).not.toHaveBeenCalled();
  });

  it('失败不缓存连接:下次派发重连', async () => {
    connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(dispatchDelegation(args)).rejects.toThrow('ECONNREFUSED');

    await expect(dispatchDelegation(args)).resolves.toBeDefined();
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
