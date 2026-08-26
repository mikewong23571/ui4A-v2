/**
 * 委托事件族 fold 与 delegations 投影单测(T5 Phase A / Task 2,TDD 红→绿):
 * - fold:delegation-started 物化 running 委托;delegation-step 步数递增
 *   (executed 计成功)且**步号连续无缺口**(缺口/重复/乱序 = 日志完整性破坏,响亮抛错);
 *   终态 completed|failed|max-steps 落 status(重复终态抛错);
 * - 投影:project(rel='delegations') 集合实体(entities[] 各委托:
 *   goal/status/steps/successes,子实体直达 delegation:<id>);
 *   project(rel='delegation:<id>') 单委托实体;空集合 200 形状(count=0);
 * - 快照随行:exec/seed/确认路径产出的新快照不丢 delegations 表。
 */
import { describe, expect, it } from 'vitest';

import { fold, project } from '../index';
import {
  delegationRel,
  DELEGATIONS_REL,
  type DelegationStartedDetail,
  type DelegationStepDetail,
} from './delegation';
import type { LogEvent } from '../projection/fold/index';
import { seedGuardRegistry } from '@ui4a/shared';

const GOAL = { verb: '发布', fields: { title: 't5' } };

let seq = 0;

function event(kind: LogEvent['kind'], detail: unknown, extra: Partial<LogEvent> = {}): LogEvent {
  seq += 1;
  return {
    seq,
    kind,
    rel: delegationRel('wf-1'),
    actor: 'agent',
    principal: 'user:mike',
    channel: 'delegation',
    detail,
    ...extra,
  };
}

function startedDetail(): DelegationStartedDetail {
  return {
    delegationId: 'wf-1',
    goal: GOAL,
    driverKind: 'rule',
    startRel: 'articles',
    principal: 'user:mike',
  };
}

function stepDetail(step: number, outcome: string): DelegationStepDetail {
  return {
    step,
    op:
      outcome === 'executed'
        ? { kind: 'exec', action: 'publish', params: { title: 't5' } }
        : { kind: 'navigate', rel: 'articles' },
    outcome,
  };
}

const deps = { flows: {}, guards: seedGuardRegistry };

describe('fold(委托事件族)', () => {
  it('delegation-started 物化 running 委托(steps=0/successes=0,goal/driverKind/startRel 入快照)', () => {
    const snapshot = fold([event('delegation-started', startedDetail())], deps);
    expect(snapshot.delegations).toEqual({
      'delegation:wf-1': {
        id: 'wf-1',
        goal: GOAL,
        driverKind: 'rule',
        startRel: 'articles',
        principal: 'user:mike',
        status: 'running',
        steps: 0,
        successes: 0,
      },
    });
  });

  it('delegation-step:步数递增,executed 计成功;终态事件落 status 与 summary/reason', () => {
    const snapshot = fold(
      [
        event('delegation-started', startedDetail()),
        event('delegation-step', stepDetail(1, 'navigated')),
        event('delegation-step', stepDetail(2, 'executed')),
        event('delegation-step', stepDetail(3, 'rejected')),
        event('delegation-completed', {
          steps: 3,
          successes: 1,
          summary: '目标完成: publish 已成功',
        }),
      ],
      deps,
    );
    expect(snapshot.delegations?.[delegationRel('wf-1')]).toMatchObject({
      status: 'completed',
      steps: 3,
      successes: 1,
      summary: '目标完成: publish 已成功',
    });
  });

  it('终态三型:failed 带 reason;max-steps 状态独立于 failed(计数以步事件折叠为准)', () => {
    const base = [event('delegation-started', startedDetail())];
    const failed = fold(
      [...base, event('delegation-failed', { steps: 0, successes: 0, reason: '无路可走' })],
      deps,
    );
    expect(failed.delegations?.[delegationRel('wf-1')]).toMatchObject({
      status: 'failed',
      reason: '无路可走',
    });
    seq = 0; // 重置事件序号,重放独立场景
    const maxed = fold(
      [
        event('delegation-started', startedDetail()),
        event('delegation-step', stepDetail(1, 'executed')),
        event('delegation-max-steps', {
          steps: 1,
          successes: 1,
          reason: '达到步数上限 24 未收到 done/fail',
        }),
      ],
      deps,
    );
    expect(maxed.delegations?.[delegationRel('wf-1')]).toMatchObject({
      status: 'max-steps',
      steps: 1,
      successes: 1,
      reason: '达到步数上限 24 未收到 done/fail',
    });
  });

  it('终态计数与步事件折叠值不一致 → 日志漂移响亮抛错', () => {
    expect(() =>
      fold(
        [
          event('delegation-started', startedDetail()),
          event('delegation-step', stepDetail(1, 'executed')),
          event('delegation-completed', { steps: 2, successes: 1, summary: 'x' }),
        ],
        deps,
      ),
    ).toThrow(/不一致/);
  });

  it('日志完整性:重复 started / 步号缺口 / 重复步号 / 未知委托的 step / 重复终态 均响亮抛错', () => {
    const started = event('delegation-started', startedDetail());
    expect(() => fold([{ ...started }, { ...started, seq: started.seq + 1 }], deps)).toThrow(
      /重复物化/,
    );

    seq = 0;
    expect(() =>
      fold(
        [
          event('delegation-started', startedDetail()),
          event('delegation-step', stepDetail(2, 'executed')), // 缺 step 1
        ],
        deps,
      ),
    ).toThrow(/缺口|连续|step/);

    seq = 0;
    expect(() =>
      fold(
        [
          event('delegation-started', startedDetail()),
          event('delegation-step', stepDetail(1, 'navigated')),
          event('delegation-step', stepDetail(1, 'executed')), // 重复 step 1
        ],
        deps,
      ),
    ).toThrow(/缺口|连续|step/);

    seq = 0;
    expect(() => fold([event('delegation-step', stepDetail(1, 'navigated'))], deps)).toThrow(
      /不存在/,
    );

    seq = 0;
    expect(() =>
      fold(
        [
          event('delegation-started', startedDetail()),
          event('delegation-completed', { steps: 0, successes: 0, summary: 'x' }),
          event('delegation-failed', { steps: 0, successes: 0, reason: 'y' }),
        ],
        deps,
      ),
    ).toThrow(/running/);
  });

  it('载荷不完整(缺 goal.verb / 缺 step)→ 日志完整性抛错', () => {
    expect(() =>
      fold(
        [event('delegation-started', { delegationId: 'wf-1', driverKind: 'rule', startRel: 'a' })],
        deps,
      ),
    ).toThrow(/载荷/);
    seq = 0;
    expect(() =>
      fold(
        [
          event('delegation-started', startedDetail()),
          event('delegation-step', { op: { kind: 'navigate', rel: 'x' }, outcome: 'navigated' }),
        ],
        deps,
      ),
    ).toThrow(/载荷/);
  });

  it('快照随行:增量 fold(initial=带委托的快照)与业务事件重放不丢 delegations 表', () => {
    const first = fold([event('delegation-started', startedDetail())], deps);
    seq = 0;
    const second = fold([event('delegation-step', stepDetail(1, 'executed'))], deps, first);
    expect(second.delegations?.[delegationRel('wf-1')]).toMatchObject({
      status: 'running',
      steps: 1,
      successes: 1,
    });
  });
});

describe('project(delegations 投影)', () => {
  it('空委托表:rel=delegations → 空集合实体(count=0),非 404', () => {
    const entity = project({ instances: {}, collections: {} }, DELEGATIONS_REL, deps);
    expect(entity).toMatchObject({
      class: ['collection', 'delegations'],
      properties: {
        rel: 'delegations',
        title: '在动',
        count: 0,
        presentation: {
          fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
        },
      },
    });
    expect(entity?.entities).toEqual([]);
  });

  it('集合:entities[] 各委托 goal/status/steps/successes,子实体直达 delegation:<id>', () => {
    const snapshot = fold(
      [
        event('delegation-started', startedDetail()),
        event('delegation-step', stepDetail(1, 'executed')),
        event('delegation-completed', { steps: 1, successes: 1, summary: 'done' }),
      ],
      deps,
    );
    const entity = project(snapshot, DELEGATIONS_REL, deps);
    expect(entity?.properties).toEqual({
      rel: 'delegations',
      title: '在动',
      count: 1,
      presentation: {
        fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
      },
    });
    expect(entity?.entities).toHaveLength(1);
    const sub = entity?.entities?.[0];
    expect(sub?.rel).toEqual(['item']);
    expect(sub?.href).toBe('/api/entity?rel=delegation:wf-1');
    expect(sub?.properties).toMatchObject({
      id: 'wf-1',
      goal: GOAL,
      status: 'completed',
      steps: 1,
      successes: 1,
    });
    expect(sub?.class).toEqual(['delegation', 'completed']);
  });

  it('单委托:rel=delegation:<id> 可直达(含 summary);未知 id → undefined', () => {
    const snapshot = fold(
      [
        event('delegation-started', startedDetail()),
        event('delegation-step', stepDetail(1, 'executed')),
        event('delegation-completed', { steps: 1, successes: 1, summary: '目标完成' }),
      ],
      deps,
    );
    const entity = project(snapshot, delegationRel('wf-1'), deps);
    expect(entity?.properties).toMatchObject({
      id: 'wf-1',
      status: 'completed',
      'driver-kind': 'rule',
      'start-rel': 'articles',
      principal: 'user:mike',
      steps: 1,
      successes: 1,
      summary: '目标完成',
    });
    expect(entity?.links).toEqual([{ rel: ['self'], href: '/api/entity?rel=delegation:wf-1' }]);
    expect(project(snapshot, delegationRel('nope'), deps)).toBeUndefined();
  });
});
