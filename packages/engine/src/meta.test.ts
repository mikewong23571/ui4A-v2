/**
 * meta 编辑动词过同一 judge(T4 Phase A Task 2,TDD 红→绿)。
 *
 * 口径(spec 架构决定 3):编辑动词 = 普通 action,声明在 definition-lifecycle
 * 对应状态的节点上,过同一三层裁决(声明→guard→schema)+ 效果(meta-edit);
 * 非法定义被拒的留痕形态与业务拒绝同构(layer/reason,I6)。
 * 自举:definition-lifecycle 自身的编辑动词也走同一 judge。
 * 事件族:definition-seeded / definition-edited / definition-revised /
 * definition-deprecated 全入 fold;重放后 definitions 状态与在线一致(I5)。
 */
import { describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { judge } from './judge';
import type { JudgeResult } from './judge';
import { articleDraftingFlow, postStatusFlow, seedSnapshot } from './fixtures';
import { fold, type LogEvent } from './fold';
import { DEFINITION_LIFECYCLE_FLOW } from './lifecycle';
import { definitionSeedEvent, executeMeta } from './meta';

const deps = { guards: seedGuardRegistry };

/** 从种子事件折叠出带定义表的快照(definition-seeded 是 Phase B boot 的引擎级预演)。 */
function seededSnapshot(
  events: readonly LogEvent[],
  extra: EngineSnapshot = seedSnapshot,
): EngineSnapshot {
  return fold(events, { flows: {} }, extra);
}

const seedPostStatus = definitionSeedEvent(1, postStatusFlow);
const seedArticle = definitionSeedEvent(2, articleDraftingFlow);

describe('definition-seeded 事件与 fold', () => {
  it('seed 建立 definitions 表条目 + lifecycle 实例(node=active),版本 1', () => {
    const snapshot = seededSnapshot([seedPostStatus]);
    expect(snapshot.definitions?.['post-status']).toMatchObject({
      name: 'post-status',
      version: 1,
      status: 'active',
      definition: postStatusFlow,
    });
    expect(snapshot.instances['meta/flow:post-status']).toMatchObject({
      rel: 'meta/flow:post-status',
      flow: 'definition-lifecycle',
      node: 'active',
      fields: {},
    });
  });

  it('seed 幂等:重复 definition-seeded 不覆盖既有条目', () => {
    const snapshot = seededSnapshot([seedPostStatus, { ...seedPostStatus, seq: 9 }]);
    expect(Object.keys(snapshot.definitions ?? {})).toEqual(['post-status']);
    expect(snapshot.definitions?.['post-status'].version).toBe(1);
  });

  it('detail 载荷不完整 → 响亮抛错(日志完整性守卫)', () => {
    const broken: LogEvent = { seq: 1, kind: 'definition-seeded', rel: 'meta/flow:x' };
    expect(() => fold([broken], { flows: {} })).toThrow(/definition-seeded.*detail|detail/i);
  });
});

describe('revise(active → draft,开工作副本)', () => {
  it('revise:实例与条目入 draft,bornBy=当前版本,version 不变(版本号在 approve 落实)', () => {
    const snapshot = seededSnapshot([seedPostStatus]);
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'revise', actor: 'agent', principal: 'user:mike' },
      snapshot,
      deps,
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.snapshot.instances['meta/flow:post-status']?.node).toBe('draft');
    expect(outcome.snapshot.definitions?.['post-status']).toMatchObject({
      status: 'draft',
      version: 1,
      bornBy: 1,
    });
    expect(outcome.events.map((e) => e.kind)).toEqual([
      'action-executed',
      'definition-revised',
    ]);
    expect(outcome.events[1]).toMatchObject({
      kind: 'definition-revised',
      rel: 'meta/flow:post-status',
      action: 'revise',
      actor: 'agent',
    });
  });

  it('revise 未声明于 draft 节点:重复 revise → undeclared(顺序铁律第 1 层)', () => {
    const snapshot = seededSnapshot([seedPostStatus]);
    const first = executeMeta({ rel: 'meta/flow:post-status', action: 'revise' }, snapshot, deps);
    expect(first.kind).toBe('executed');
    const second = executeMeta(
      { rel: 'meta/flow:post-status', action: 'revise' },
      (first as Extract<typeof first, { kind: 'executed' }>).snapshot,
      deps,
    );
    expect(second).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });

  it('definition-revised 入 fold:重放后条目与在线一致', () => {
    const snapshot = seededSnapshot([seedPostStatus]);
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'revise', actor: 'human' },
      snapshot,
      deps,
    );
    if (outcome.kind !== 'executed') throw new Error('revise 应通过');
    const log: LogEvent[] = [seedPostStatus, ...outcome.events.map((e, i) => ({ ...e, seq: 10 + i }))];
    expect(fold(log, { flows: {} }, seedSnapshot)).toEqual(outcome.snapshot);
  });
});

describe('add-node / add-action(编辑动词 = 普通 exec 语义)', () => {
  function draftOf(events: readonly LogEvent[], flowName: string): EngineSnapshot {
    const snapshot = seededSnapshot(events);
    const revised = executeMeta(
      { rel: `meta/flow:${flowName}`, action: 'revise', actor: 'agent' },
      snapshot,
      deps,
    );
    if (revised.kind !== 'executed') throw new Error('revise 应通过');
    return revised.snapshot;
  }

  it('add-node 通过:工作副本追加节点,事件链 action-executed + definition-edited', () => {
    const draft = draftOf([seedPostStatus], 'post-status');
    const outcome = executeMeta(
      {
        rel: 'meta/flow:post-status',
        action: 'add-node',
        params: { name: 'scheduled', title: '定时' },
        actor: 'agent',
        principal: 'user:mike',
      },
      draft,
      deps,
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    const entry = outcome.snapshot.definitions?.['post-status'];
    const added = entry?.definition.nodes.find((n) => n.name === 'scheduled');
    expect(added).toMatchObject({ name: 'scheduled', title: '定时', actions: [] });
    // 实例仍在 draft;旧快照不被改动(不可变产出)。
    expect(outcome.snapshot.instances['meta/flow:post-status']?.node).toBe('draft');
    expect(draft.definitions?.['post-status'].definition.nodes).toHaveLength(3);
    expect(outcome.events.map((e) => e.kind)).toEqual(['action-executed', 'definition-edited']);
    expect(outcome.events[1]).toMatchObject({
      kind: 'definition-edited',
      rel: 'meta/flow:post-status',
      action: 'add-node',
      actor: 'agent',
      detail: { name: 'post-status', op: 'add-node', params: { name: 'scheduled', title: '定时' } },
    });
  });

  it('add-node 缺 name → schema-invalid(schema 层第 3 层)', () => {
    const draft = draftOf([seedPostStatus], 'post-status');
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'add-node', params: { title: 'x' } },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
  });

  it('add-node 同名节点 → guard-failed(node-not-exists)', () => {
    const draft = draftOf([seedPostStatus], 'post-status');
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'add-node', params: { name: 'published' } },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('node-not-exists=false');
  });

  it('add-action 通过(S2 场景:ready 节点加 pin,to: done,guards: [])', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const outcome = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: {
          node: 'ready',
          action: { name: 'pin', title: '置顶', to: 'done', guards: [] },
        },
        actor: 'agent',
        principal: 'user:mike',
      },
      draft,
      deps,
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    const ready = outcome.snapshot.definitions?.['article-drafting'].definition.nodes.find(
      (n) => n.name === 'ready',
    );
    const pin = ready?.actions.find((a) => a.name === 'pin');
    expect(pin).toMatchObject({
      name: 'pin',
      title: '置顶',
      method: 'POST',
      to: 'done',
      guards: [],
      effect: [{ type: 'transition', to: 'done' }],
    });
  });

  it('add-action 的 to 指向不存在节点 → guard-failed(to-exists)——S2 非负例引擎级', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const outcome = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: {
          node: 'ready',
          action: { name: 'pin', title: '置顶', to: 'ghost-node', guards: [] },
        },
        actor: 'agent',
      },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('to-exists=false');
    // 拒绝即数据:detail 为逐项 guard 求值结果(与业务拒绝同构)。
    const evaluations = outcome.detail as Array<{ name: string; pass: boolean }>;
    expect(evaluations.find((e) => e.name === 'to-exists')?.pass).toBe(false);
    expect(evaluations.find((e) => e.name === 'node-exists')?.pass).toBe(true);
  });

  it('add-action 目标节点不存在 → guard-failed(node-exists)', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const outcome = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: { node: 'ghost', action: { name: 'pin', title: 'p', to: 'done' } },
      },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('node-exists=false');
  });

  it('add-action 声明未注册 guard → guard-failed(guards-registered,fail-closed)', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const outcome = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: {
          node: 'ready',
          action: { name: 'pin', title: 'p', to: 'done', guards: ['no-such-guard'] },
        },
      },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('guards-registered=false');
  });

  it('add-action 声明未知效果类型 → guard-failed(effect-known)', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const outcome = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: {
          node: 'ready',
          action: { name: 'pin', title: 'p', to: 'done', effect: [{ type: 'teleport' }] },
        },
      },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('effect-known=false');
  });

  it('add-action 同名动作重复声明 → guard-failed(action-not-exists)', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const outcome = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: {
          node: 'ready',
          action: { name: 'publish', title: '又发布', to: 'done' },
        },
      },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('action-not-exists=false');
  });

  it('add-action 缺 action 载荷 → schema-invalid', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const outcome = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'add-action', params: { node: 'ready' } },
      draft,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
  });

  it('编辑动词在 active 状态未声明 → undeclared(declaration 层先于 guard 层)', () => {
    const active = seededSnapshot([seedPostStatus]);
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'add-node', params: { name: 'x' } },
      active,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });

  it('非法定义拒绝形态与业务拒绝同构(layer/reason 结构一致)', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const metaRejection = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: { node: 'ready', action: { name: 'pin', title: 'p', to: 'ghost' } },
      },
      draft,
      deps,
    );
    // 业务侧同层拒绝(评论 approve 的 guard is-pending 失败 → guard-failed 带 detail)。
    const businessRejection: JudgeResult = judge(
      { rel: 'comment:c1', action: 'approve' },
      seedSnapshot,
      {
        flows: { 'comment-moderation': {
          name: 'comment-moderation',
          initial: 'pending',
          nodes: [
            {
              name: 'pending',
              actions: [{ name: 'approve', title: '通过', to: 'approved', guards: ['is-pending'] }],
            },
            { name: 'approved', actions: [] },
          ],
        } },
        guards: { ...seedGuardRegistry, 'is-pending': () => false },
      },
    );
    expect(businessRejection).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    expect(metaRejection.kind).toBe(businessRejection.kind);
    // 同构:键集一致(kind/layer/reason/detail),layer 与 reason 语义同位。
    expect(Object.keys(metaRejection).sort()).toEqual(Object.keys(businessRejection).sort());
    expect(metaRejection).toHaveProperty('layer');
    expect(metaRejection).toHaveProperty('reason');
  });

  it('编辑事件族入 fold:seed→revise→add-node→add-action 重放后与在线一致(I5)', () => {
    const draft = draftOf([seedArticle], 'article-drafting');
    const edits = [
      executeMeta(
        {
          rel: 'meta/flow:article-drafting',
          action: 'add-action',
          params: { node: 'ready', action: { name: 'pin', title: '置顶', to: 'done', guards: [] } },
          actor: 'agent',
          principal: 'user:mike',
        },
        draft,
        deps,
      ),
    ];
    const executed = edits[0]!;
    if (executed.kind !== 'executed') throw new Error('add-action 应通过');
    const more = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-node',
        params: { name: 'scheduled' },
        actor: 'human',
      },
      executed.snapshot,
      deps,
    );
    if (more.kind !== 'executed') throw new Error('add-node 应通过');

    // 在线链路的全部事件(seed→revise→add-action→add-node)+ 一条拒绝留痕(no-op)。
    const log: LogEvent[] = [
      seedArticle,
      { seq: 10, kind: 'action-rejected', rel: 'meta/flow:article-drafting', action: 'add-action', actor: 'agent', reason: 'guard 不满足: to-exists=false' },
      ...reviseEvents(),
      ...executed.events.map((e, i) => ({ ...e, seq: 20 + i })),
      ...more.events.map((e, i) => ({ ...e, seq: 30 + i })),
    ];
    expect(fold(log, { flows: {} }, seedSnapshot)).toEqual(more.snapshot);
  });
});

/** revise 事件(seq 由外层补)。 */
function reviseEvents(): LogEvent[] {
  const snapshot = seededSnapshot([seedArticle]);
  const outcome = executeMeta(
    { rel: 'meta/flow:article-drafting', action: 'revise', actor: 'agent' },
    snapshot,
    deps,
  );
  if (outcome.kind !== 'executed') throw new Error('revise 应通过');
  return outcome.events.map((e, i) => ({ ...e, seq: 11 + i }));
}

describe('deprecate(no-live-instances)', () => {
  it('有在途业务实例 → guard-failed(no-live-instances)', () => {
    // seedSnapshot 带两篇 published 文章(published 非 terminal)。
    const snapshot = seededSnapshot([seedPostStatus]);
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'deprecate', actor: 'human' },
      snapshot,
      deps,
    );
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('no-live-instances=false');
  });

  it('全部实例都在 terminal 节点 → 通过;definition-deprecated 入 fold 一致', () => {
    const seeded = seededSnapshot([seedPostStatus]);
    const allArchived: EngineSnapshot = {
      ...seeded,
      instances: {
        ...seeded.instances,
        'post:post-welcome': { ...seeded.instances['post:post-welcome']!, node: 'archived' },
        'post:post-getting-started': {
          ...seeded.instances['post:post-getting-started']!,
          node: 'archived',
        },
      },
    };
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'deprecate', actor: 'human' },
      allArchived,
      deps,
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.snapshot.instances['meta/flow:post-status']?.node).toBe('deprecated');
    expect(outcome.snapshot.definitions?.['post-status'].status).toBe('deprecated');
    expect(outcome.events.map((e) => e.kind)).toEqual([
      'action-executed',
      'definition-deprecated',
    ]);
    const log: LogEvent[] = [seedPostStatus, ...outcome.events.map((e, i) => ({ ...e, seq: 5 + i }))];
    expect(fold(log, { flows: {} }, allArchived)).toEqual(outcome.snapshot);
  });
});

describe('lifecycle 自举(DoD 3)', () => {
  it('definition-lifecycle 自身的编辑动词过同一 judge(self 实例 add-node → accepted)', () => {
    // 把 lifecycle 常量自身作为一份 seed 定义(测试专构造;生产中 meta/self 只读)。
    const selfSeed = definitionSeedEvent(1, DEFINITION_LIFECYCLE_FLOW, { status: 'draft' });
    const snapshot = seededSnapshot([selfSeed]);
    const verdict = judge(
      {
        rel: 'meta/flow:definition-lifecycle',
        action: 'add-node',
        params: { name: 'extra', title: '额外' },
        actor: 'agent',
      },
      snapshot,
      { flows: { 'definition-lifecycle': DEFINITION_LIFECYCLE_FLOW }, guards: seedGuardRegistry },
    );
    expect(verdict.kind).toBe('accepted');
    if (verdict.kind !== 'accepted') return;
    // 同一 judge:声明取自 lifecycle 常量 draft 节点,guard/schema 照常三层。
    expect(verdict.action.name).toBe('add-node');
    expect(verdict.schema.properties).toHaveProperty('name');

    // executeMeta 同样通过:自举的完整闭环。
    const outcome = executeMeta(
      {
        rel: 'meta/flow:definition-lifecycle',
        action: 'add-node',
        params: { name: 'extra' },
        actor: 'agent',
      },
      snapshot,
      deps,
    );
    expect(outcome.kind).toBe('executed');
  });

  it('executeMeta 不依赖业务 flow 注册表(deps 只有谓词注册表)', () => {
    const snapshot = seededSnapshot([seedPostStatus]);
    const outcome = executeMeta(
      { rel: 'meta/flow:post-status', action: 'revise' },
      snapshot,
      { guards: seedGuardRegistry },
    );
    expect(outcome.kind).toBe('executed');
  });
});
