/**
 * 在途实例按出生定义走完(T4 Phase B Task 3,TDD 红→绿;spec 验收 4)。
 *
 * 出生版本戳(arch-brief §10 三手段之一):
 * - append 效果派生新实例时盖 bornVersion(= 当时该 flow 定义的活跃版本);
 * - judge / 投影 / transition 校验按 instance.bornVersion 从 versions 注册表
 *   解析定义(缺省回退活跃注册表——未盖戳实例与既有语义一致);
 * - fold.applyExecuted 以快照 definitionVersions 为主源重放业务事件
 *  (定义来自日志,常量仅兜底)。
 */
import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition, GuardRegistry } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { applyEffects } from './effects';
import { executeWithGates } from './execute';
import { fold, type LogEvent } from './fold';
import { definitionSeedEvent, executeMeta } from './meta';
import { project } from './siren';
import { seedSnapshot } from './fixtures';

const guards: GuardRegistry = { ...seedGuardRegistry };

/** v1:published 有 legacy-pin(→ pinned);v2:published 有 feature(→ archived)。 */
const postStatusV1: FlowDefinition = {
  name: 'post-status',
  title: '文章状态',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      actions: [
        { name: 'unpublish', title: '下线', to: 'offline' },
        { name: 'legacy-pin', title: '旧版置顶', to: 'pinned' },
      ],
    },
    { name: 'offline', actions: [{ name: 'republish', title: '再上线', to: 'published' }] },
    { name: 'pinned', actions: [] },
    { name: 'archived', actions: [] },
  ],
};
const postStatusV2: FlowDefinition = {
  ...postStatusV1,
  nodes: [
    postStatusV1.nodes[0]!,
    postStatusV1.nodes[1]!,
    { name: 'pinned', actions: [] },
    { name: 'archived', actions: [] },
  ].map((node) =>
    node.name === 'published'
      ? { ...node, actions: [node.actions[0]!, { name: 'feature', title: '加精', to: 'archived' }] }
      : node,
  ),
};

/** 既有快照:post:old(出生于 v1 的在途实例,已盖戳)。 */
function baseSnapshot(): EngineSnapshot {
  return {
    ...seedSnapshot,
    instances: {
      ...seedSnapshot.instances,
      'post:old': {
        rel: 'post:old',
        flow: 'post-status',
        node: 'published',
        fields: {},
        bornVersion: 1,
      },
    },
    definitions: {
      'post-status': {
        name: 'post-status',
        version: 1,
        status: 'active',
        definition: postStatusV1,
      },
    },
    definitionVersions: { 'post-status': { 1: postStatusV1 } },
    activations: {},
  };
}

const activeDeps = (snapshot: EngineSnapshot) => ({
  flows: {
    'post-status':
      snapshot.definitionVersions!['post-status']![snapshot.definitions!['post-status']!.version]!,
  },
  guards,
  versions: snapshot.definitionVersions,
});

describe('append 盖戳(新实例出生版本)', () => {
  it('append 派生实例带 bornVersion=目标 flow 当前活跃版本', () => {
    const snapshot = baseSnapshot();
    const outcome = applyEffects(
      {
        rel: 'article-drafting:main',
        action: 'publish',
        params: { title: 'New' },
        actor: 'human',
      },
      [
        {
          type: 'append',
          collection: 'articles',
          'resource-type': 'post',
          name: 'new',
          flow: 'post-status',
          node: 'published',
        },
      ],
      snapshot,
      { flows: {} },
    );
    expect(outcome.snapshot.instances['post:new']?.bornVersion).toBe(1);
    expect(outcome.snapshot.instances['post:new']?.flow).toBe('post-status');
  });
});

describe('judge/投影/transition 按出生版本解析', () => {
  /** v2 激活后的快照(指针 v2;历史保留 v1)。 */
  function activatedSnapshot(): EngineSnapshot {
    return {
      ...baseSnapshot(),
      definitions: {
        'post-status': {
          name: 'post-status',
          version: 2,
          status: 'active',
          definition: postStatusV2,
        },
      },
      definitionVersions: { 'post-status': { 1: postStatusV1, 2: postStatusV2 } },
    };
  }

  it('在途实例(born v1):v2 独有动作 undeclared;v1 独有动作可执行且按 v1 迁移', () => {
    const snapshot = activatedSnapshot();
    const deps = activeDeps(snapshot);

    const feature = executeWithGates(
      { rel: 'post:old', action: 'feature', actor: 'agent' },
      snapshot,
      deps,
    );
    // 若错误解析到活跃 v2,feature 会被接受——这是判别器。
    expect(feature).toMatchObject({ kind: 'rejected', layer: 'undeclared' });

    const legacy = executeWithGates(
      { rel: 'post:old', action: 'legacy-pin', actor: 'agent' },
      snapshot,
      deps,
    );
    expect(legacy.kind).toBe('executed');
    if (legacy.kind !== 'executed') return;
    expect(legacy.snapshot.instances['post:old']?.node).toBe('pinned'); // v1 的边:pinned 存在于 v1
  });

  it('投影按出生版本:在途实例 actions 来自 v1(无 feature)', () => {
    const snapshot = activatedSnapshot();
    const entity = project(snapshot, 'post:old', {
      flows: { 'post-status': postStatusV2 },
      guards,
      versions: snapshot.definitionVersions,
    });
    expect(entity?.actions.map((action) => action.name)).toEqual(['unpublish', 'legacy-pin']);
    expect(entity?.properties).toMatchObject({ node: 'published' });
  });

  it('未盖戳实例回退活跃定义(既有语义不破坏)', () => {
    const snapshot: EngineSnapshot = {
      ...activatedSnapshot(),
      instances: {
        ...activatedSnapshot().instances,
        'post:old': { rel: 'post:old', flow: 'post-status', node: 'published', fields: {} },
      },
    };
    const entity = project(snapshot, 'post:old', {
      flows: { 'post-status': postStatusV2 },
      guards,
      versions: snapshot.definitionVersions,
    });
    expect(entity?.actions.map((action) => action.name)).toEqual(['unpublish', 'feature']);
  });
});

describe('fold.applyExecuted 以快照定义为主源(常量仅兜底)', () => {
  it('v1 在途实例的动作在 v2 激活后重放仍按 v1(与在线同构,flows 传空表判别)', () => {
    // 日志:definition-seeded(v1)→ 业务 seed(post:old 等)→ 激活链(v2)→ 在途动作。
    const defSeed = definitionSeedEvent(1, postStatusV1);
    const instances = {
      ...seedSnapshot.instances,
      'post:old': { rel: 'post:old', flow: 'post-status', node: 'published', fields: {} },
    };
    const businessSeed: LogEvent = {
      seq: 2,
      kind: 'seed',
      rel: 'seed:test',
      detail: { instances, collections: seedSnapshot.collections },
    };
    let snapshot = fold([defSeed, businessSeed], { flows: {} });
    expect(snapshot.instances['post:old']?.bornVersion).toBe(1); // append 盖戳口径:applySeed
    const log: Omit<LogEvent, 'seq'>[] = [defSeed, businessSeed];
    for (const [action, params] of [
      ['revise', undefined],
      [
        'add-action',
        { node: 'published', action: { name: 'feature', title: '加精', to: 'archived' } },
      ],
      ['submit', undefined],
      ['approve', undefined],
    ] as const) {
      const outcome = executeMeta(
        {
          rel: 'meta/flow:post-status',
          action,
          actor: action === 'approve' ? 'human' : 'agent',
          ...(params !== undefined ? { params } : {}),
        },
        snapshot,
        { guards },
      );
      if (outcome.kind !== 'executed') throw new Error(`${action} 应通过`);
      snapshot = outcome.snapshot;
      log.push(...outcome.events);
    }
    expect(snapshot.definitions?.['post-status']?.version).toBe(2);

    // 在线业务 exec:post:old(born v1)按 v1 执行 legacy-pin。
    const online = executeWithGates(
      { rel: 'post:old', action: 'legacy-pin', actor: 'agent' },
      snapshot,
      activeDeps(snapshot),
    );
    if (online.kind !== 'executed') throw new Error('legacy-pin 应通过(按出生定义)');
    log.push(...online.events);

    // 重放:flows 传空表——applyExecuted 只能从快照 definitionVersions 解析。
    const replayed = fold(
      log.map((event, index) => ({ ...event, seq: index + 1 })),
      { flows: {} },
    );
    expect(replayed.instances['post:old']?.node).toBe('pinned');
    expect(replayed.instances['post:old']?.bornVersion).toBe(1);
    expect(replayed).toEqual(online.snapshot);
  });
});
