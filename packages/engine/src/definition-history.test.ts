/**
 * 定义版本历史(T4 Phase B Task 1,TDD 红→绿)。
 *
 * spec 架构决定 5 / arch-brief §10 三手段之"实例按出生版本走完"的数据基础:
 * - fold 把 definition-seeded / definition-activated 的定义全文沉淀进
 *   snapshot.definitionVersions(flow → version → 定义),definitions 条目只持
 *   "活跃指针"(name/version/status + 工作副本);
 * - activeDefinitionOf(snapshot, name) = definitionVersions[活跃版本]:
 *   草稿/待批窗口里活跃内容不随工作副本漂移(活跃定义只在 approve 时移动);
 * - 迁移序(既有实例先于定义入日志)由 definition-seeded 回溯盖 bornVersion。
 */
import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { articleDraftingFlow, postStatusFlow, seedSnapshot } from './fixtures';
import { fold, type LogEvent } from './fold';
import { activeDefinitionOf, definitionSeedEvent, executeMeta } from './meta';

const deps = { guards: seedGuardRegistry };

/** 从事件折叠(在线路径的起点同构:fixture + 定义种子事件)。 */
function foldFrom(
  events: readonly LogEvent[],
  initial: EngineSnapshot = seedSnapshot,
): EngineSnapshot {
  return fold(events, { flows: {} }, initial);
}

function withSeq(events: Array<Omit<LogEvent, 'seq'>>): LogEvent[] {
  return events.map((event, index) => ({ ...event, seq: index + 1 }));
}

describe('definitionVersions:fold 沉淀定义全文', () => {
  it('definition-seeded:definitionVersions 落 v1 全文', () => {
    const snapshot = foldFrom([definitionSeedEvent(1, postStatusFlow)]);
    expect(snapshot.definitionVersions?.['post-status']?.[1]).toEqual(postStatusFlow);
  });

  it('迁移序(实例先于定义):definition-seeded 回溯盖 bornVersion,其他 flow 不动', () => {
    const snapshot = foldFrom([definitionSeedEvent(1, postStatusFlow)]);
    // seedSnapshot 里 post-status 实例 ×2 获得出生版本;article/comment 不动。
    expect(snapshot.instances['post:post-welcome']?.bornVersion).toBe(1);
    expect(snapshot.instances['post:post-getting-started']?.bornVersion).toBe(1);
    expect(snapshot.instances['article-drafting:main']?.bornVersion).toBeUndefined();
    expect(snapshot.instances['comment:c1']?.bornVersion).toBeUndefined();
  });

  it('重复 definition-seeded(幂等)不重复盖戳也不覆盖历史', () => {
    const first = definitionSeedEvent(1, postStatusFlow);
    const snapshot = foldFrom([first, { ...first, seq: 9 }]);
    expect(Object.keys(snapshot.definitionVersions?.['post-status'] ?? {})).toEqual(['1']);
  });

  it('增量 fold:definitionVersions 随 initial 快照携带', () => {
    const seeded = foldFrom([definitionSeedEvent(1, postStatusFlow)]);
    const carried = fold([], { flows: {} }, seeded);
    expect(carried.definitionVersions).toEqual(seeded.definitionVersions);
  });
});

describe('activeDefinitionOf:活跃指针不随草稿漂移', () => {
  it('seeded 即活跃:v1 全文', () => {
    const snapshot = foldFrom([definitionSeedEvent(1, postStatusFlow)]);
    expect(activeDefinitionOf(snapshot, 'post-status')).toEqual(postStatusFlow);
  });

  it('revise + add-action 草稿窗口:活跃定义仍是 v1(新动作不进业务平面)', () => {
    let snapshot = foldFrom([definitionSeedEvent(1, postStatusFlow)]);
    const revised = executeMeta(
      { rel: 'meta/flow:post-status', action: 'revise', actor: 'human' },
      snapshot,
      deps,
    );
    if (revised.kind !== 'executed') throw new Error('revise 应通过');
    const edited = executeMeta(
      {
        rel: 'meta/flow:post-status',
        action: 'add-action',
        actor: 'agent',
        params: {
          node: 'published',
          action: { name: 'feature', title: '加精', to: 'archived' },
        },
      },
      revised.snapshot,
      deps,
    );
    if (edited.kind !== 'executed') throw new Error('add-action 应通过');
    snapshot = edited.snapshot;

    const active = activeDefinitionOf(snapshot, 'post-status') as FlowDefinition;
    expect(active).toEqual(postStatusFlow); // v1:无 feature
    // 工作副本已有 feature(条目 definition 是草稿)。
    const draft = snapshot.definitions?.['post-status']?.definition as FlowDefinition;
    expect(draft.nodes[0]?.actions.map((action) => action.name)).toContain('feature');
  });

  it('approve:definitionVersions 保留 v1 与 v2,活跃指针 → v2', () => {
    let snapshot = foldFrom([definitionSeedEvent(1, postStatusFlow)]);
    for (const [action, params] of [
      ['revise', {}],
      [
        'add-action',
        { node: 'published', action: { name: 'feature', title: '加精', to: 'archived' } },
      ],
      ['submit', {}],
    ] as const) {
      const outcome = executeMeta(
        {
          rel: 'meta/flow:post-status',
          action,
          actor: 'agent',
          ...(Object.keys(params).length > 0 ? { params } : {}),
        },
        snapshot,
        deps,
      );
      if (outcome.kind !== 'executed') throw new Error(`${action} 应通过`);
      snapshot = outcome.snapshot;
    }
    const approved = executeMeta(
      { rel: 'meta/flow:post-status', action: 'approve', actor: 'human' },
      snapshot,
      deps,
    );
    if (approved.kind !== 'executed') throw new Error('approve 应通过');
    snapshot = approved.snapshot;

    const versions = snapshot.definitionVersions?.['post-status'] ?? {};
    expect(versions[1]).toEqual(postStatusFlow);
    expect((versions[2] as FlowDefinition).nodes[0]?.actions.map((a) => a.name)).toContain(
      'feature',
    );
    expect(activeDefinitionOf(snapshot, 'post-status')).toEqual(versions[2]);
  });

  it('全链重放一致(I5):definitionVersions 与 bornVersion 参与在线/重放双轨', () => {
    const seed = definitionSeedEvent(1, articleDraftingFlow);
    const run = (
      initial: EngineSnapshot,
    ): { snapshot: EngineSnapshot; log: Omit<LogEvent, 'seq'>[] } => {
      const log: Omit<LogEvent, 'seq'>[] = [seed];
      let snapshot = fold([seed], { flows: {} }, initial);
      for (const [action, params] of [
        ['revise', undefined],
        ['add-action', { node: 'ready', action: { name: 'pin', title: '置顶', to: 'done' } }],
        ['submit', undefined],
        ['approve', undefined],
      ] as const) {
        const outcome = executeMeta(
          {
            rel: 'meta/flow:article-drafting',
            action,
            actor: action === 'approve' ? 'human' : 'agent',
            ...(params !== undefined ? { params } : {}),
          },
          snapshot,
          deps,
        );
        if (outcome.kind !== 'executed') throw new Error(`${action} 应通过`);
        snapshot = outcome.snapshot;
        log.push(...outcome.events.map((event) => ({ ...event })));
      }
      return { snapshot, log };
    };
    const online = run(seedSnapshot);
    const replayed = foldFrom(withSeq(online.log));
    expect(replayed.definitionVersions).toEqual(online.snapshot.definitionVersions);
    expect(replayed.instances['article-drafting:main']?.bornVersion).toBe(1);
    expect(fold(withSeq(online.log), { flows: {} }, seedSnapshot)).toEqual(online.snapshot);
  });
});
