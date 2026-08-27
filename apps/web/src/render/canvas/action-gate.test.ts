/**
 * 画布 action 拦截门测试(T7 Phase B / spec 架构决定 3b):组件事件 →
 * 映射实体已声明 action → /api/exec;白名单外(未声明动作/未注册实体)拒,
 * 且**不发生任何 /api/exec 调用**(合同外按钮无法提交)。
 */
import { describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { createActionGate } from './action-gate';

function entityOf(rel: string, actions: string[]): SirenEntity {
  return {
    class: ['flow-instance'],
    properties: { rel },
    actions: actions.map((name) => ({
      name,
      title: name,
      method: 'POST',
      href: '/api/exec',
      fields: { type: 'object', properties: {} },
    })),
    links: [],
  };
}

function clientAction(name: string, context: Record<string, unknown> = {}) {
  return {
    name,
    surfaceId: 's1',
    sourceComponentId: 'c1',
    timestamp: new Date().toISOString(),
    context,
  };
}

describe('画布 action 拦截门', () => {
  it('已声明动作:转发 /api/exec(renderer 固定身份),成功回流实体', async () => {
    const execFn = vi.fn().mockResolvedValue({ ok: true, entity: entityOf('post:p1', []) });
    const gate = createActionGate(execFn);
    gate.register(entityOf('post:post-welcome', ['unpublish', 'archive']));

    const outcome = await gate.handle(clientAction('unpublish', { rel: 'post:post-welcome' }));
    expect(outcome.outcome).toBe('executed');
    expect(execFn).toHaveBeenCalledTimes(1);
    expect(execFn).toHaveBeenCalledWith({
      rel: 'post:post-welcome',
      action: 'unpublish',
      params: undefined,
    });
  });

  it('实体未声明的动作:拒绝且零 /api/exec 调用(白名单外拒)', async () => {
    const execFn = vi.fn();
    const gate = createActionGate(execFn);
    gate.register(entityOf('post:post-welcome', ['unpublish']));

    const outcome = await gate.handle(
      clientAction('nuke-everything', { rel: 'post:post-welcome' }),
    );
    expect(outcome.outcome).toBe('rejected');
    if (outcome.outcome === 'rejected') {
      expect(outcome.reason).toContain('nuke-everything');
    }
    expect(execFn).not.toHaveBeenCalled();
  });

  it('未注册实体/缺 rel 上下文:拒绝且零调用(缺数据不造数据)', async () => {
    const execFn = vi.fn();
    const gate = createActionGate(execFn);
    gate.register(entityOf('post:post-welcome', ['unpublish']));

    expect((await gate.handle(clientAction('unpublish'))).outcome).toBe('rejected');
    expect((await gate.handle(clientAction('unpublish', { rel: 'ghost:rel' }))).outcome).toBe(
      'rejected',
    );
    expect(execFn).not.toHaveBeenCalled();
  });

  it('exec 被裁决层拒绝:如实回流 layer/reason(拒绝也是合同的一部分)', async () => {
    const execFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 422, layer: 'guard', reason: 'is-published=false' });
    const gate = createActionGate(execFn);
    gate.register(entityOf('post:post-welcome', ['unpublish']));

    const outcome = await gate.handle(clientAction('unpublish', { rel: 'post:post-welcome' }));
    expect(outcome.outcome).toBe('refused');
    if (outcome.outcome === 'refused') {
      expect(outcome.layer).toBe('guard');
      expect(outcome.reason).toContain('is-published');
    }
  });

  it('clear 后旧注册失效(重新规划 surface 时的白名单重建)', async () => {
    const execFn = vi.fn();
    const gate = createActionGate(execFn);
    gate.register(entityOf('post:post-welcome', ['unpublish']));
    gate.clear();
    expect(
      (await gate.handle(clientAction('unpublish', { rel: 'post:post-welcome' }))).outcome,
    ).toBe('rejected');
    expect(execFn).not.toHaveBeenCalled();
  });
});
