import { describe, expect, it } from 'vitest';

import type { RejectionRecord, TrailStep } from '../types';
import { createNoProgressGuard, createRepeatedRejectionGuard } from './fail-guard';

const rejection = (over: Partial<RejectionRecord> = {}): RejectionRecord => ({
  rel: 'articles',
  action: 'publish',
  layer: 'guard',
  reason: '字段缺失',
  detail: { code: 'schema' },
  ...over,
});

describe('T36 C2 fail-guard:同一动作同一参数反复被拒的机械收敛(T35 C5 语义不变)', () => {
  it('首次拒绝只计数不终止;第二次同键拒绝产出 repeated_rejection fail 步并终止', async () => {
    const steps: TrailStep[] = [];
    const guard = createRepeatedRejectionGuard(async (step) => {
      steps.push(step);
    });

    const first = await guard.record(1, 'articles', 'publish', { title: 'a' }, rejection());
    expect(first).toBe(false);
    expect(steps).toHaveLength(0);

    const second = await guard.record(
      2,
      'articles',
      'publish',
      { title: 'a' },
      rejection({ reason: '仍是字段缺失' }),
    );
    expect(second).toBe(true);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.step).toBe(2);
    expect(steps[0]!.rel).toBe('articles');
    expect(steps[0]!.outcome).toBe('failed');
    const op = steps[0]!.op as Extract<TrailStep['op'], { kind: 'fail' }>;
    expect(op.kind).toBe('fail');
    expect(op.code).toBe('repeated_rejection');
    expect(op.reason).toContain('2 次');
    expect(op.reason).toContain('仍是字段缺失');
    expect(op.evidence?.[0]).toBe('articles#publish');
    expect(op.evidence?.[1]).toBe('layer:guard');
  });

  it('不同动作或不同参数不累计(各自独立计数)', async () => {
    const guard = createRepeatedRejectionGuard(async () => {});
    expect(await guard.record(1, 'articles', 'publish', { title: 'a' }, rejection())).toBe(false);
    expect(await guard.record(2, 'articles', 'publish', { title: 'b' }, rejection())).toBe(false);
    expect(await guard.record(3, 'articles', 'draft', undefined, rejection())).toBe(false);
  });
});

describe('T36 C2 fail-guard:同一合同处境第三次出现的无进展循环保护(语义不变)', () => {
  const visit = (
    guard: ReturnType<typeof createNoProgressGuard>,
    fail: (step: TrailStep) => Promise<void>,
    step: number,
    lastRejection?: RejectionRecord,
  ) =>
    guard.recordVisit({
      step,
      rel: 'articles',
      actionNames: ['publish', 'draft'],
      successes: 0,
      lastRejection,
      fail,
    });

  it('前两次相同处境不触发;第三次产出 no_progress_loop fail 步并返回原因', async () => {
    const steps: TrailStep[] = [];
    const guard = createNoProgressGuard();
    const fail = async (step: TrailStep): Promise<void> => {
      steps.push(step);
    };

    expect(await visit(guard, fail, 1)).toBeUndefined();
    expect(await visit(guard, fail, 2)).toBeUndefined();
    const op = await visit(guard, fail, 3);
    expect(op?.code).toBe('no_progress_loop');
    expect(op?.reason).toContain('无进展导航循环');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.outcome).toBe('failed');
    expect(steps[0]!.step).toBe(3);
    expect(op?.evidence).toContain('重复处境:articles');
    expect(op?.evidence).toContain('可用动作:publish,draft');
    expect(op?.evidence).toContain('已成功执行:0');
  });

  it('处境签名含最新拒绝身份:拒绝变化后的同 rel 不算同一处境', async () => {
    const guard = createNoProgressGuard();
    const fail = async (): Promise<void> => {};
    expect(await visit(guard, fail, 1, rejection())).toBeUndefined();
    expect(await visit(guard, fail, 2, rejection({ action: 'draft' }))).toBeUndefined();
  });
});
