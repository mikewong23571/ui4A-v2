/**
 * 机械 diff 纯数据(T4 Phase C Task 1,TDD 红→绿)。
 *
 * 铁律 5"审批渲染路径零 AI":审批者看到的 diff 由**引擎**在 submit 时计算,
 * 结构化纯数据(deep-object-diff 的 added/deleted/updated 三视角 + 前后全文),
 * 随 activation 实体物化、随 definition-submitted 事件入日志(载荷即真相,
 * fold 重放不重算)。渲染器(react-diff-view,内建)只做 纯数据 → 组件树,
 * 不经过任何被审批者提供的渲染器,也不依赖任何 AI/LLM。
 */
import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { articleDraftingFlow, seedSnapshot } from '../core/fixtures';
import { definitionDiff } from './definition-diff';
import { fold, type LogEvent } from '../projection/fold/index';
import { definitionSeedEvent, executeMeta } from './meta';

const deps = { guards: seedGuardRegistry };

function cloneFlow(flow: FlowDefinition): FlowDefinition {
  return JSON.parse(JSON.stringify(flow)) as FlowDefinition;
}

describe('definitionDiff(纯数据)', () => {
  it('差异三视角:added 含新动作全文、updated 持新值、deleted 持删除值;before/after 全文携带', () => {
    const before = cloneFlow(articleDraftingFlow);
    const after = cloneFlow(articleDraftingFlow);
    after.title = '文章起草(修订)';
    const ready = after.nodes.find((node) => node.name === 'ready')!;
    ready.actions.push({ name: 'pin', title: '置顶', to: 'done', guards: [] });
    // 删除一个既有动作(deleted 视角持被删子树)。
    const basic = after.nodes.find((node) => node.name === 'basic-info')!;
    basic.actions.pop();

    const result = definitionDiff(before, after);
    expect(result.algorithm).toBe('deep-object-diff');
    // 前后全文携带:渲染器无须回查任何注册表(自包含审计载荷)。
    expect(result.before).toEqual(before);
    expect(result.after).toEqual(after);
    // added:新增动作的子树(deep-object-diff 以嵌套对象表达路径,数字键=下标)。
    expect(result.changed.added).toEqual({
      nodes: { 3: { actions: { 1: { name: 'pin', title: '置顶', to: 'done', guards: [] } } } },
    });
    // deleted:数组元素移除——deep-object-diff 对数组按下标比对,被删下标记为
    // 缺席(undefined 占位,JSON 序列化后留空路径);旧值由渲染器从 before
    // 按同路径机械取回(见 changed.deleted 的路径形状)。
    expect(result.changed.deleted).toEqual({ nodes: { 0: { actions: {} } } });
    // updated:title 变更(持新值;旧值由渲染器从 before 按路径机械取回)。
    // 数组变长/变短也会在下标层留下痕迹(deep-object-diff 把数组当对象比对)。
    expect(result.changed.updated).toMatchObject({
      title: '文章起草(修订)',
      nodes: { 0: { actions: {} } },
    });
  });

  it('纯数据断言:JSON 可序列化、可往返、确定性(同输入同输出)', () => {
    const before = cloneFlow(articleDraftingFlow);
    const after = cloneFlow(articleDraftingFlow);
    after.initial = after.initial; // 无差异基线之一
    after.nodes[0]!.actions[0]!.title = '新标题';

    const first = definitionDiff(before, after);
    const second = definitionDiff(before, after);
    expect(JSON.parse(JSON.stringify(first))).toEqual(second); // 往返一致
    expect(first).toEqual(second); // 确定性
    expect(JSON.stringify(first)).not.toContain('function'); // 无函数成分
  });

  it('无差异:三视角全空(空对象)', () => {
    const flow = cloneFlow(articleDraftingFlow);
    const result = definitionDiff(flow, cloneFlow(flow));
    expect(result.changed).toEqual({ added: {}, deleted: {}, updated: {} });
  });
});

describe('submit 时引擎侧计算 diff(executeMeta 集成)', () => {
  /** seed → revise → add-action(pin)→ submit 的完整链(与 meta-approve.test 同口径)。 */
  function pendingApproval(): { snapshot: EngineSnapshot; log: LogEvent[] } {
    const seed = definitionSeedEvent(1, articleDraftingFlow);
    let snapshot = fold([seed], { flows: {} }, seedSnapshot);
    const log: LogEvent[] = [seed];
    const steps = [
      { rel: 'meta/flow:article-drafting', action: 'revise', actor: 'agent' as const },
      {
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        actor: 'agent' as const,
        params: {
          node: 'ready',
          action: { name: 'pin', title: '置顶', to: 'done', guards: [] },
        },
      },
      { rel: 'meta/flow:article-drafting', action: 'submit', actor: 'agent' as const },
    ];
    let seq = 10;
    for (const step of steps) {
      const outcome = executeMeta(
        { ...step, params: 'params' in step ? step.params : undefined },
        snapshot,
        deps,
      );
      if (outcome.kind !== 'executed') throw new Error(`${step.action} 应通过`);
      snapshot = outcome.snapshot;
      log.push(...outcome.events.map((event) => ({ ...event, seq: seq++ })));
    }
    return { snapshot, log };
  }

  it('activation.diff:基线 = 出生活跃定义(v1 种子),候选 = 草稿全文;含 pin 增量', () => {
    const { snapshot } = pendingApproval();
    const activation = snapshot.activations?.['meta/activation:a1'];
    expect(activation?.diff).toBeDefined();
    expect(activation!.diff!.algorithm).toBe('deep-object-diff');
    // before = 提交时的活跃定义(seed v1,无 pin);after = 草稿(含 pin)。
    expect(activation!.diff!.before).toEqual(articleDraftingFlow);
    expect(JSON.stringify(activation!.diff!.after)).toContain('pin');
    expect(activation!.diff!.after).toEqual(activation!.definition);
    expect(JSON.stringify(activation!.diff!.changed.added)).toContain('pin');
  });

  it('diff 随 definition-submitted 入日志(detail.activation.diff),fold 重放不重算即还原(I5)', () => {
    const { snapshot, log } = pendingApproval();
    const submitted = log.find((event) => event.kind === 'definition-submitted');
    const detail = submitted?.detail as { activation?: { diff?: unknown } };
    expect(detail.activation?.diff).toEqual(snapshot.activations?.['meta/activation:a1']?.diff);

    // 重放:diff 从载荷还原,不重算(注册表漂移不影响审计数据)。
    const replayed = fold(log, { flows: {} }, seedSnapshot);
    expect(replayed).toEqual(snapshot);
    expect(replayed.activations?.['meta/activation:a1']?.diff).toEqual(
      snapshot.activations?.['meta/activation:a1']?.diff,
    );
  });

  it('无差异修订(revise 后直接 submit):diff 三视角全空,仍物化', () => {
    const seed = definitionSeedEvent(1, articleDraftingFlow);
    let snapshot = fold([seed], { flows: {} }, seedSnapshot);
    for (const step of ['revise', 'submit'] as const) {
      const outcome = executeMeta(
        { rel: 'meta/flow:article-drafting', action: step, actor: 'agent' },
        snapshot,
        deps,
      );
      if (outcome.kind !== 'executed') throw new Error(`${step} 应通过`);
      snapshot = outcome.snapshot;
    }
    const activation = snapshot.activations?.['meta/activation:a1'];
    expect(activation?.diff?.changed).toEqual({ added: {}, deleted: {}, updated: {} });
    expect(activation?.diff?.before).toEqual(activation?.diff?.after);
  });
});
