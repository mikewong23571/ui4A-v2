import { createActor } from 'xstate';
import { describe, expect, it } from 'vitest';

import { commentModerationFlow, postStatusFlow } from './fixtures';
import { canSendEvent, canTransition, createFlowMachine } from './machine';

describe('createFlowMachine(XState v5 运行时构造)', () => {
  it('初始快照 value = flow.initial', () => {
    const actor = createActor(createFlowMachine(postStatusFlow));
    actor.start();
    expect(actor.getSnapshot().value).toBe('published');
    actor.stop();
  });

  it('节点 meta 携带 title(界面清单推导的输入)', () => {
    const machine = createFlowMachine(postStatusFlow);
    const state = machine.resolveState({ value: 'published', context: undefined });
    expect(state.getMeta()).toBeTruthy();
  });
});

describe('canTransition(转移合法性由 machine 运行时校验)', () => {
  it('声明的边返回 true(published --unpublish--> offline)', () => {
    expect(canTransition(postStatusFlow, 'published', 'offline')).toBe(true);
  });

  it('另一条声明的边也成立(published --archive--> archived)', () => {
    expect(canTransition(postStatusFlow, 'published', 'archived')).toBe(true);
  });

  it('未声明的方向返回 false(offline 无法回到 published)', () => {
    expect(canTransition(postStatusFlow, 'offline', 'published')).toBe(false);
  });

  it('终态无出边(archived → 任意已存在节点 false)', () => {
    expect(canTransition(postStatusFlow, 'archived', 'published')).toBe(false);
    expect(canTransition(postStatusFlow, 'archived', 'offline')).toBe(false);
  });

  it('from 节点不存在返回 false(不抛错)', () => {
    expect(canTransition(postStatusFlow, 'ghost', 'offline')).toBe(false);
  });

  it('to 节点不存在返回 false(不抛错)', () => {
    expect(canTransition(postStatusFlow, 'published', 'ghost')).toBe(false);
  });

  it('自环动作合法(pending --flag--> pending)', () => {
    expect(canTransition(commentModerationFlow, 'pending', 'pending')).toBe(true);
  });

  it('跨节点但无动作直达的方向返回 false(pending → approved 需经 approve,直接 pending→approved 为 true;approved→rejected 为 false)', () => {
    expect(canTransition(commentModerationFlow, 'pending', 'approved')).toBe(true);
    expect(canTransition(commentModerationFlow, 'approved', 'rejected')).toBe(false);
  });
});

describe('canSendEvent(事件是否在当前节点可用)', () => {
  it('声明于当前节点的动作事件可用', () => {
    expect(canSendEvent(postStatusFlow, 'published', 'unpublish')).toBe(true);
  });

  it('未声明于当前节点的动作事件不可用', () => {
    expect(canSendEvent(postStatusFlow, 'offline', 'unpublish')).toBe(false);
    expect(canSendEvent(postStatusFlow, 'archived', 'archive')).toBe(false);
  });

  it('节点不存在返回 false(不抛错)', () => {
    expect(canSendEvent(postStatusFlow, 'ghost', 'unpublish')).toBe(false);
  });
});
