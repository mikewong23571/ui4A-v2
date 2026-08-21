/**
 * 激活不变式检查器(T4 Phase A Task 3,TDD 红→绿)。
 *
 * A.5 种子集(spec 架构决定 4),六项逐条:
 *   edge-targets-exist / guards-registered / field-types-known / effect-known /
 *   initial-exists / terminal-reachable。
 * submit 时全跑:checks 全过 → pending-approval(activation 实体);
 * 有 fail → 回 draft + 校验报告入事件(definition-submitted detail)。
 */
import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import {
  articleDraftingFlow,
  commentModerationFlow,
  postStatusFlow,
  seedSnapshot,
} from './fixtures';
import { fold, type LogEvent } from './fold';
import { DEFINITION_LIFECYCLE_FLOW } from './lifecycle';
import { definitionSeedEvent, executeMeta } from './meta';
import { validateDefinition } from './invariants';
import { contentVersion } from './sitemap';

const registries = { guards: seedGuardRegistry };

function checksOf(flow: FlowDefinition) {
  return validateDefinition(flow, registries);
}

function byName(checks: ReturnType<typeof validateDefinition>) {
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

describe('validateDefinition — 合法定义全过', () => {
  it('三个业务域 flow(种子常量)六项全过', () => {
    for (const flow of [articleDraftingFlow, postStatusFlow, commentModerationFlow]) {
      const checks = checksOf(flow);
      expect(checks.map((c) => c.name), flow.name).toEqual([
        'edge-targets-exist',
        'guards-registered',
        'field-types-known',
        'effect-known',
        'initial-exists',
        'terminal-reachable',
      ]);
      expect(checks.every((c) => c.pass), flow.name).toBe(true);
    }
  });

  it('definition-lifecycle 常量自举:自身通过自身的六项不变式', () => {
    // lifecycle 的编辑动词声明(guards 引用 meta 谓词)在种子注册表里可解析。
    const checks = checksOf(DEFINITION_LIFECYCLE_FLOW);
    expect(checks.every((c) => c.pass)).toBe(true);
  });
});

describe('validateDefinition — 六项逐条(非负例)', () => {
  function invalidFlow(mutate: (flow: FlowDefinition) => void): FlowDefinition {
    const flow: FlowDefinition = JSON.parse(JSON.stringify(postStatusFlow));
    mutate(flow);
    return flow;
  }

  it('edge-targets-exist:action.to 指向不存在节点 → fail,detail 列出位置', () => {
    const flow = invalidFlow((f) => {
      f.nodes[0]!.actions[0]!.to = 'ghost';
    });
    const check = byName(checksOf(flow))['edge-targets-exist'];
    expect(check.pass).toBe(false);
    expect(check.detail?.[0]).toContain('ghost');
  });

  it('edge-targets-exist:transition 效果的目标不存在(编辑 guard 的缝隙,深层校验兜底)', () => {
    const flow = invalidFlow((f) => {
      f.nodes[0]!.actions[0]!.effect = [{ type: 'transition', to: 'ghost' }];
    });
    const check = byName(checksOf(flow))['edge-targets-exist'];
    expect(check.pass).toBe(false);
    expect(check.detail?.join('\n')).toContain('ghost');
  });

  it('guards-registered:动作声明未注册 guard → fail', () => {
    const flow = invalidFlow((f) => {
      f.nodes[0]!.actions[0]!.guards = ['no-such-guard'];
    });
    const check = byName(checksOf(flow))['guards-registered'];
    expect(check.pass).toBe(false);
    expect(check.detail?.[0]).toContain('no-such-guard');
  });

  it('field-types-known:未知字段类型 → fail(节点字段/动作字段/流级字段都查)', () => {
    const nodeLevel = invalidFlow((f) => {
      f.nodes[0]!.fields = [{ name: 'x', type: 'colour' as never }];
    });
    expect(byName(checksOf(nodeLevel))['field-types-known'].pass).toBe(false);

    const actionLevel = invalidFlow((f) => {
      f.nodes[0]!.actions[0]!.fields = [{ name: 'x', type: 'colour' as never }];
    });
    expect(byName(checksOf(actionLevel))['field-types-known'].pass).toBe(false);

    const flowLevel = invalidFlow((f) => {
      f.fields = [{ name: 'x', type: 'colour' as never }];
    });
    expect(byName(checksOf(flowLevel))['field-types-known'].pass).toBe(false);
  });

  it('effect-known:未知效果类型 → fail', () => {
    const flow = invalidFlow((f) => {
      f.nodes[0]!.actions[0]!.effect = [{ type: 'teleport' } as never];
    });
    const check = byName(checksOf(flow))['effect-known'];
    expect(check.pass).toBe(false);
    expect(check.detail?.[0]).toContain('teleport');
  });

  it('initial-exists:initial 不在节点集 → fail', () => {
    const flow = invalidFlow((f) => {
      f.initial = 'ghost';
    });
    expect(byName(checksOf(flow))['initial-exists'].pass).toBe(false);
  });

  it('terminal-reachable:纯环(无 terminal)→ fail', () => {
    const flow: FlowDefinition = {
      name: 'cycle',
      initial: 'a',
      nodes: [
        { name: 'a', actions: [{ name: 'go', title: 'g', to: 'b' }] },
        { name: 'b', actions: [{ name: 'back', title: 'b', to: 'a' }] },
      ],
    };
    const check = byName(checksOf(flow))['terminal-reachable'];
    expect(check.pass).toBe(false);
  });

  it('terminal-reachable:有 terminal 但从 initial 不可达 → fail', () => {
    const flow: FlowDefinition = {
      name: 'island',
      initial: 'a',
      nodes: [
        { name: 'a', actions: [{ name: 'loop', title: 'l', to: 'b' }] },
        { name: 'b', actions: [{ name: 'back', title: 'b', to: 'a' }] },
        { name: 'z', actions: [] },
      ],
    };
    expect(byName(checksOf(flow))['terminal-reachable'].pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submit 集成:checks 全过 → pending-approval(activation 实体);
// checks-fail → 回 draft + 校验报告入事件。
// ---------------------------------------------------------------------------

const deps = { guards: seedGuardRegistry };

function snapshotOf(events: readonly LogEvent[]): EngineSnapshot {
  return fold(events, { flows: {} }, seedSnapshot);
}

/** seed → revise → (可选编辑)→ 得到 draft 快照与日志前缀。 */
function draftArticle(): { snapshot: EngineSnapshot; log: LogEvent[] } {
  const seed = definitionSeedEvent(1, articleDraftingFlow);
  const snapshot = snapshotOf([seed]);
  const revised = executeMeta(
    { rel: 'meta/flow:article-drafting', action: 'revise', actor: 'agent', principal: 'user:mike' },
    snapshot,
    deps,
  );
  if (revised.kind !== 'executed') throw new Error('revise 应通过');
  return {
    snapshot: revised.snapshot,
    log: [seed, ...revised.events.map((e, i) => ({ ...e, seq: 10 + i }))],
  };
}

describe('submit — checks 全过 → pending-approval', () => {
  it('合法草稿:实例/条目入 pending-approval,activation 实体物化(A.2 形状)', () => {
    const { snapshot, log } = draftArticle();
    const withEdit = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: { node: 'ready', action: { name: 'pin', title: '置顶', to: 'done', guards: [] } },
        actor: 'agent',
        principal: 'user:mike',
      },
      snapshot,
      deps,
    );
    if (withEdit.kind !== 'executed') throw new Error('add-action 应通过');

    const submitted = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent', principal: 'user:mike' },
      withEdit.snapshot,
      deps,
    );
    expect(submitted.kind).toBe('executed');
    if (submitted.kind !== 'executed') return;
    expect(submitted.events.map((e) => e.kind)).toEqual([
      'action-executed',
      'definition-submitted',
    ]);
    const result = submitted.snapshot;
    expect(result.instances['meta/flow:article-drafting']?.node).toBe('pending-approval');
    expect(result.definitions?.['article-drafting'].status).toBe('pending-approval');

    const activation = result.activations?.['meta/activation:a1'];
    expect(activation).toMatchObject({
      id: 'a1',
      flow: 'article-drafting',
      status: 'pending-approval',
      version: 2,
      requestedBy: { actor: 'agent', principal: 'user:mike' },
    });
    expect(activation?.checks.every((c) => c.pass)).toBe(true);
    expect(activation?.artifact).toBe(contentVersion(activation?.definition));
    // 激活载荷 = 提交时的工作副本全文(approve 据此激活;fold 真相)。
    expect(activation?.definition.nodes.find((n) => n.name === 'ready')?.actions)
      .toContainEqual(expect.objectContaining({ name: 'pin' }));

    // definition-submitted 事件 detail:checks + activation 载荷(机器可重放)。
    const detail = submitted.events[1]!.detail as {
      name: string;
      passed: boolean;
      checks: Array<{ name: string; pass: boolean }>;
      activation: { id: string; version: number };
    };
    expect(detail).toMatchObject({ name: 'article-drafting', passed: true });
    expect(detail.checks).toHaveLength(6);
    expect(detail.activation).toMatchObject({ id: 'a1', version: 2 });

    // fold 全链一致(I5)。
    const fullLog: LogEvent[] = [
      ...log,
      ...withEdit.events.map((e, i) => ({ ...e, seq: 20 + i })),
      ...submitted.events.map((e, i) => ({ ...e, seq: 30 + i })),
    ];
    expect(fold(fullLog, { flows: {} }, seedSnapshot)).toEqual(result);
  });

  it('submit 仅声明于 draft:pending-approval 下重复 submit → undeclared', () => {
    const { snapshot } = draftArticle();
    const first = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent' },
      snapshot,
      deps,
    );
    if (first.kind !== 'executed') throw new Error('submit 应通过');
    const second = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent' },
      first.snapshot,
      deps,
    );
    expect(second).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });
});

describe('submit — checks-fail → 回 draft(校验报告入事件)', () => {
  it('编辑缝隙:add-action 的 effect transition 目标不存在 → 提交时 edge-targets-exist 拒', () => {
    const { snapshot, log } = draftArticle();
    // to=done 过编辑 guard(to-exists 读 action.to),effect 里藏 ghost——
    // 深层校验在 submit 才能看见(A.5 edge-targets-exist 的存在理由)。
    const sneaky = executeMeta(
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: {
          node: 'ready',
          action: { name: 'pin', title: '置顶', to: 'done', guards: [], effect: [{ type: 'transition', to: 'ghost' }] },
        },
        actor: 'agent',
      },
      snapshot,
      deps,
    );
    if (sneaky.kind !== 'executed') throw new Error('add-action 应通过(编辑层合法)');

    const submitted = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent' },
      sneaky.snapshot,
      deps,
    );
    expect(submitted.kind).toBe('executed');
    if (submitted.kind !== 'executed') return;
    // 回 draft(A.4:validating --checks-fail--> draft 附校验报告),无 activation。
    expect(submitted.snapshot.instances['meta/flow:article-drafting']?.node).toBe('draft');
    expect(submitted.snapshot.definitions?.['article-drafting'].status).toBe('draft');
    expect(submitted.snapshot.activations).toEqual({});

    const detail = submitted.events[1]!.detail as {
      passed: boolean;
      checks: Array<{ name: string; pass: boolean; detail?: string[] }>;
    };
    expect(detail.passed).toBe(false);
    const failed = detail.checks.find((c) => !c.pass);
    expect(failed?.name).toBe('edge-targets-exist');
    expect(failed?.detail?.join('\n')).toContain('ghost');

    // fold 一致:失败路径同样由事件重放。
    const fullLog: LogEvent[] = [
      ...log,
      ...sneaky.events.map((e, i) => ({ ...e, seq: 20 + i })),
      ...submitted.events.map((e, i) => ({ ...e, seq: 30 + i })),
    ];
    expect(fold(fullLog, { flows: {} }, seedSnapshot)).toEqual(submitted.snapshot);
  });
});
