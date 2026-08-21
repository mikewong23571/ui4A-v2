/**
 * 激活不变式检查器(T4 Phase A Task 3,TDD 红→绿;T10 Phase A Task 3 增第七条)。
 *
 * A.5 种子集(spec 架构决定 4)+ T10 spec 架构决定 3,七项逐条:
 *   edge-targets-exist / guards-registered / field-types-known / effect-known /
 *   initial-exists / terminal-reachable / app-known。
 * submit 时全跑:checks 全过 → pending-approval(activation 实体);
 * 有 fail → 回 draft + 校验报告入事件(definition-submitted detail)。
 */
import { describe, expect, it } from 'vitest';

import type { ApplicationDefinition, EngineSnapshot, FlowDefinition } from '@ui4a/shared';
import { metaFlowRel, seedGuardRegistry } from '@ui4a/shared';

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
        'app-known',
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
// app-known(T10 第七条;spec 架构决定 3):flow.app(归一化后)必须指向
// 已激活 application;applications 注册表未提供 → vacuous pass(过渡期)。
// ---------------------------------------------------------------------------

describe('validateDefinition — app-known(T10 第七条)', () => {
  const activeApps: ReadonlySet<string> = new Set(['default', 'publishing']);
  const withApps = { ...registries, applications: activeApps };

  it('applications 提供且 app 命中 → pass', () => {
    const flow: FlowDefinition = { ...postStatusFlow, app: 'publishing' };
    const check = byName(validateDefinition(flow, withApps))['app-known'];
    expect(check.pass).toBe(true);
    expect(check.detail).toBeUndefined();
  });

  it('app 指向未激活 application → fail,detail 列违规', () => {
    const flow: FlowDefinition = { ...postStatusFlow, app: 'nonexistent' };
    const check = byName(validateDefinition(flow, withApps))['app-known'];
    expect(check.pass).toBe(false);
    expect(check.detail?.join('\n')).toContain('nonexistent');
  });

  it('app 显式空串 → fail(parse 不拒,归一化原样保留,由本检查兜底)', () => {
    const flow: FlowDefinition = { ...postStatusFlow, app: '' };
    const check = byName(validateDefinition(flow, withApps))['app-known'];
    expect(check.pass).toBe(false);
    expect(check.detail?.join('\n')).toContain('空串');
  });

  it('app 缺省归一化为 default:集合含 default → pass,不含 → fail', () => {
    // postStatusFlow 未声明 app(缺省即 'default')。
    expect(byName(validateDefinition(postStatusFlow, withApps))['app-known'].pass).toBe(true);
    const noDefault = { ...registries, applications: new Set(['publishing']) };
    expect(byName(validateDefinition(postStatusFlow, noDefault))['app-known'].pass).toBe(false);
  });

  it('未提供 applications(过渡期)→ vacuous pass,且检查仍在 checks 列表', () => {
    const flow: FlowDefinition = { ...postStatusFlow, app: 'nonexistent' };
    const checks = checksOf(flow);
    const check = byName(checks)['app-known'];
    expect(check, 'app-known 应始终出现在 checks 列表').toBeDefined();
    expect(check.pass).toBe(true);
    expect(check.detail).toBeUndefined();
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

/** seed → revise → 得到 draft 快照与日志前缀(flow 可换,app-known 集成用)。 */
function draftFlow(flow: FlowDefinition): { snapshot: EngineSnapshot; log: LogEvent[] } {
  const seed = definitionSeedEvent(1, flow);
  const snapshot = snapshotOf([seed]);
  const revised = executeMeta(
    { rel: metaFlowRel(flow.name), action: 'revise', actor: 'agent', principal: 'user:mike' },
    snapshot,
    deps,
  );
  if (revised.kind !== 'executed') throw new Error('revise 应通过');
  return {
    snapshot: revised.snapshot,
    log: [seed, ...revised.events.map((e, i) => ({ ...e, seq: 10 + i }))],
  };
}

function draftArticle(): { snapshot: EngineSnapshot; log: LogEvent[] } {
  return draftFlow(articleDraftingFlow);
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
    expect(detail.checks).toHaveLength(7);
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

// ---------------------------------------------------------------------------
// submit — app-known 接线:快照 applications 表(Phase B 落表;Phase A 仅
// 类型 + 接线)存在 → 键集作已激活 app 注册表;不存在 → vacuous pass。
// 注意:applications 表的 fold 重放是 Phase B 任务,此处不做 fold 一致性断言。
// ---------------------------------------------------------------------------

describe('submit — app-known(快照 applications 表接线)', () => {
  const applications: Record<string, ApplicationDefinition> = {
    default: { name: 'default', title: '默认应用', intent: '无归属 flow 的兜底归组' },
    publishing: { name: 'publishing', title: '发布', intent: '文章生产与发布' },
  };

  it('app 指向未激活 application → checks-fail 回 draft,app-known 留痕,activation 不生成', () => {
    const { snapshot } = draftFlow({ ...articleDraftingFlow, app: 'nonexistent' });
    const withApps: EngineSnapshot = { ...snapshot, applications };
    const submitted = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent' },
      withApps,
      deps,
    );
    expect(submitted.kind).toBe('executed');
    if (submitted.kind !== 'executed') return;
    // checks-fail 既有通道:实例/条目回 draft,无 activation 实体。
    expect(submitted.snapshot.instances['meta/flow:article-drafting']?.node).toBe('draft');
    expect(submitted.snapshot.definitions?.['article-drafting'].status).toBe('draft');
    expect(submitted.snapshot.activations).toEqual({});

    const detail = submitted.events[1]!.detail as {
      passed: boolean;
      checks: Array<{ name: string; pass: boolean; detail?: string[] }>;
    };
    expect(detail.passed).toBe(false);
    const failed = detail.checks.filter((c) => !c.pass);
    expect(failed.map((c) => c.name)).toEqual(['app-known']);
    expect(failed[0]?.detail?.join('\n')).toContain('nonexistent');
  });

  it('app 指向已激活 application → 正常入 pending-approval(activation 物化)', () => {
    const { snapshot } = draftFlow({ ...articleDraftingFlow, app: 'publishing' });
    const withApps: EngineSnapshot = { ...snapshot, applications };
    const submitted = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent' },
      withApps,
      deps,
    );
    if (submitted.kind !== 'executed') throw new Error('submit 应通过');
    expect(submitted.snapshot.instances['meta/flow:article-drafting']?.node).toBe('pending-approval');
    expect(submitted.snapshot.activations?.['meta/activation:a1']).toMatchObject({
      id: 'a1',
      flow: 'article-drafting',
      status: 'pending-approval',
    });
  });

  it('快照无 applications 表(过渡期)→ app-known vacuous pass,submit 不受阻', () => {
    // app 即使指向不存在的 application,无表即不校验(Phase B 后长牙)。
    const { snapshot } = draftFlow({ ...articleDraftingFlow, app: 'nonexistent' });
    const submitted = executeMeta(
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent' },
      snapshot,
      deps,
    );
    if (submitted.kind !== 'executed') throw new Error('submit 应通过');
    expect(submitted.snapshot.instances['meta/flow:article-drafting']?.node).toBe('pending-approval');
    const detail = submitted.events[1]!.detail as {
      checks: Array<{ name: string; pass: boolean }>;
    };
    expect(detail.checks.find((c) => c.name === 'app-known')?.pass).toBe(true);
  });
});
