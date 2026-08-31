import { describe, expect, it } from 'vitest';

import type { TrailStep } from '@ui4a/agent';

import { finalTurnCitations, parseCitations, trailEntityRefs } from './citations';

describe('canonical chat citations', () => {
  it('strictly accepts FactRef values and deduplicates exact pairs in first-seen order', () => {
    expect(
      parseCitations([
        { rel: 'post:first-post', pointer: '/properties/fields/body' },
        { rel: 'post:first-post', pointer: '/properties/fields/title' },
        { rel: 'post:first-post', pointer: '/properties/fields/body' },
        { rel: 'articles', pointer: '/properties/count' },
      ]),
    ).toEqual([
      { rel: 'post:first-post', pointer: '/properties/fields/body' },
      { rel: 'post:first-post', pointer: '/properties/fields/title' },
      { rel: 'articles', pointer: '/properties/count' },
    ]);
  });

  it.each([
    null,
    {},
    [{ rel: '', pointer: '/properties/count' }],
    [{ rel: 'articles', pointer: 'properties/count' }],
    [{ rel: 'articles', pointer: '/properties/count', invented: true }],
  ])('rejects malformed or non-canonical citation metadata: %j', (value) => {
    expect(() => parseCitations(value)).toThrow(/citation/i);
  });
});

/**
 * 终局引用派生(T40 F-12):trailEntityRefs 从轨迹 executed 步派生实体引用;
 * finalTurnCitations 实现「LLM sources 优先,缺席退守轨迹」的选择语义——
 * 客户端终局消息与服务端 chat-message-appended 持久化共用同一纯函数。
 */
const execStep = (step: number, entityRel: string): TrailStep => ({
  step,
  rel: 'flow:todo-capture',
  op: { kind: 'exec', action: 'add' },
  outcome: 'executed',
  entity: { rel: entityRel, class: ['flow-instance'], actions: [] },
});

describe('trailEntityRefs(T40 F-12)', () => {
  it('只收 executed 步的动作后实体,导航步与无摘要步不收', () => {
    const steps: TrailStep[] = [
      {
        step: 1,
        rel: 'flow:todo-capture',
        op: { kind: 'navigate', rel: 'flow:todo-capture' },
        outcome: 'navigated',
        entity: { rel: 'todo-capture:main', class: ['flow-instance'], actions: ['add'] },
      },
      execStep(2, 'todo-capture:main'),
      execStep(3, 'todo:abc'),
    ];
    expect(trailEntityRefs(steps)).toEqual([
      { rel: 'todo-capture:main', pointer: '/' },
      { rel: 'todo:abc', pointer: '/' },
    ]);
  });

  it('按 rel 去重且上限 4', () => {
    const steps = [
      execStep(1, 'todo:a'),
      execStep(2, 'todo:a'),
      execStep(3, 'todo:b'),
      execStep(4, 'todo:c'),
      execStep(5, 'todo:d'),
      execStep(6, 'todo:e'),
    ];
    expect(trailEntityRefs(steps)).toEqual([
      { rel: 'todo:a', pointer: '/' },
      { rel: 'todo:b', pointer: '/' },
      { rel: 'todo:c', pointer: '/' },
      { rel: 'todo:d', pointer: '/' },
    ]);
  });

  it('零 executed 步(纯回答/拒绝轨迹)派生为空', () => {
    expect(trailEntityRefs([])).toEqual([]);
  });
});

describe('finalTurnCitations(T40 F-12)', () => {
  it('LLM sources 在场优先,不碰轨迹', () => {
    const sources = [{ rel: 'post:x', pointer: '/properties/title' }];
    expect(finalTurnCitations(sources, [execStep(1, 'todo:a')])).toEqual(sources);
  });

  it('sources 缺席或空数组时退守轨迹派生', () => {
    expect(finalTurnCitations(undefined, [execStep(1, 'todo:a')])).toEqual([
      { rel: 'todo:a', pointer: '/' },
    ]);
    expect(finalTurnCitations([], [execStep(1, 'todo:a')])).toEqual([
      { rel: 'todo:a', pointer: '/' },
    ]);
  });
});
