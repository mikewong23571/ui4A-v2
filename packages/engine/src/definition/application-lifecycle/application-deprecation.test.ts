/**
 * application-lifecycle deprecate 裁决路径(T52 Phase 3;D71.2/D71.6,TDD 红→绿)。
 *
 * 语义合同:停用是直连 meta 动作(非 Draft),宿主为镜像 definition-lifecycle
 * 的常量伪流;human-only + requires-confirmation high;default 不可停用
 * (guard 拒绝留痕 I6);成功裁决原子产出事件对(action-executed +
 * application-deprecated)。
 *
 * I5 口径:seeded + deprecate 事件对的 log 全量重放与在线快照一致——实例节点 /
 * applications 删键 / definitions 级联逐表一致;deprecatedApplications 审计表
 * 只在 fold 侧物化(审计条目的 seq 由日志层分配,纯引擎无从得知——fold 是
 * 停用审计的唯一物化点,在线路径不得预物化,防止双写漂移)。
 */
import { describe, expect, it } from 'vitest';

import type { ApplicationDefinition } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { commentModerationFlow, postStatusFlow } from '../../core/fixtures';
import { approveConfirmation } from '../../execution/confirmation';
import { fold, type LogEvent } from '../../projection/fold/index';
import type { FoldSnapshot } from '../../projection/fold/index';
import { definitionSeedEvent, executeMeta } from '../meta';
import type { MetaDeps } from '../meta';
import { withLifecycleFlows } from '../lifecycle';

const deps: MetaDeps = { guards: seedGuardRegistry };

/** 注入的严确认策略(仅测试:builtin/随附 Cedar 对 human 直通,该路径生产默认不可达)。 */
const strictDeps: MetaDeps = {
  guards: seedGuardRegistry,
  policy: () => ({ required: true, reason: 'test:always 策略要求确认', policy: 'test:always' }),
};

const defaultApp: ApplicationDefinition = {
  name: 'default',
  title: '默认应用',
  intent: '无归属 flow 的兜底归组',
};

const publishingApp: ApplicationDefinition = {
  name: 'publishing',
  title: '内容发布',
  intent: '内容起草与发布',
};

/** application-seeded 日志事件(boot 装载形状;detail 持定义全文)。 */
function applicationSeedEvent(seq: number, app: ApplicationDefinition): LogEvent {
  return {
    seq,
    kind: 'application-seeded',
    rel: `meta/application:${app.name}`,
    detail: { name: app.name, definition: app },
  };
}

interface Seeded {
  snapshot: FoldSnapshot;
  log: LogEvent[];
}

/** 种子场景:default + publishing 两 app + 各归属一条 flow 定义。 */
function seeded(): Seeded {
  const log: LogEvent[] = [
    applicationSeedEvent(1, defaultApp),
    applicationSeedEvent(2, publishingApp),
    definitionSeedEvent(3, { ...postStatusFlow, app: 'publishing' }),
    definitionSeedEvent(4, commentModerationFlow), // app 缺省 → 'default'
  ];
  return { snapshot: fold(log, { flows: {} }), log };
}

/** 对 publishing 发起 deprecate(human 直连路径)。 */
function deprecatePublishing(
  snapshot: FoldSnapshot,
  options?: { actor?: 'human' | 'agent'; reason?: string; deps?: MetaDeps; app?: string },
) {
  return executeMeta(
    {
      rel: `meta/application:${options?.app ?? 'publishing'}`,
      action: 'deprecate',
      actor: options?.actor ?? 'human',
      principal: 'user:mike',
      ...(options?.reason !== undefined ? { params: { reason: options.reason } } : {}),
    },
    snapshot,
    options?.deps ?? deps,
  );
}

describe('deprecate — human 直连路径(事件对 + 在线级联)', () => {
  it('成功裁决原子产出事件对 [action-executed, application-deprecated],detail {name/reason?/commandId}', () => {
    const { snapshot } = seeded();
    const outcome = deprecatePublishing(snapshot, { reason: '走查残留清理' });
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;

    expect(outcome.events.map((event) => event.kind)).toEqual([
      'action-executed',
      'application-deprecated',
    ]);
    const executed = outcome.events[0]!;
    expect(executed).toMatchObject({
      rel: 'meta/application:publishing',
      action: 'deprecate',
      actor: 'human',
      principal: 'user:mike',
      to: 'deprecated',
    });
    const detail = outcome.events[1]!.detail as {
      name: string;
      reason?: string;
      commandId: string;
    };
    expect(detail).toEqual({
      name: 'publishing',
      reason: '走查残留清理',
      commandId: 'application-deprecate:publishing',
    });
  });

  it('在线快照:实例节点→deprecated;applications 删该键(其余不动);同 app 定义级联置废;default 侧不动', () => {
    const { snapshot } = seeded();
    const outcome = deprecatePublishing(snapshot);
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;

    expect(outcome.snapshot.instances['meta/application:publishing']?.node).toBe('deprecated');
    expect(outcome.snapshot.instances['meta/application:default']?.node).toBe('active');
    expect(outcome.snapshot.applications).toEqual({ default: defaultApp });
    expect(outcome.snapshot.definitions?.['post-status']?.status).toBe('deprecated');
    expect(outcome.snapshot.definitions?.['comment-moderation']?.status).toBe('active');
    // 审计表只在 fold 侧物化(seq 属日志层);在线路径不预物化,防止双写漂移。
    expect((outcome.snapshot as FoldSnapshot).deprecatedApplications).toBeUndefined();
  });

  it('reason 可选:缺省通过且 detail 不携带 reason;空串视同未提供', () => {
    const { snapshot } = seeded();
    const withoutReason = deprecatePublishing(snapshot);
    expect(withoutReason.kind).toBe('executed');
    if (withoutReason.kind !== 'executed') return;
    expect(withoutReason.events[1]!.detail).toEqual({
      name: 'publishing',
      commandId: 'application-deprecate:publishing',
    });

    const fresh = seeded();
    const emptyReason = deprecatePublishing(fresh.snapshot, { reason: '' });
    expect(emptyReason.kind).toBe('executed');
    if (emptyReason.kind !== 'executed') return;
    expect((emptyReason.events[1]!.detail as { reason?: string }).reason).toBeUndefined();
  });
});

describe('deprecate — 裁决层拒绝(拒绝即数据 I6,由调用方入日志)', () => {
  it('default 地板(D71.6):meta/application:default → guard-failed application-not-default,状态不变', () => {
    const { snapshot } = seeded();
    const outcome = deprecatePublishing(snapshot, { app: 'default' });
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('application-not-default=false');
    // 状态不变:default 仍 active、applications 不动、无 app=default 的定义级联。
    expect(snapshot.instances['meta/application:default']?.node).toBe('active');
    expect(snapshot.applications).toEqual({ default: defaultApp, publishing: publishingApp });
    expect(snapshot.definitions?.['comment-moderation']?.status).toBe('active');
  });

  it('agent 发起 → guard-failed actor-is-human(human-only,先于确认门)', () => {
    const { snapshot } = seeded();
    const outcome = deprecatePublishing(snapshot, { actor: 'agent' });
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('actor-is-human=false');
    expect(snapshot.instances['meta/application:publishing']?.node).toBe('active');
  });

  it('已停用实体的第二次 deprecate → undeclared(节点无声明,US5 stale-action 口径)', () => {
    const { snapshot } = seeded();
    const first = deprecatePublishing(snapshot);
    if (first.kind !== 'executed') throw new Error('前置失败:首次 deprecate 应通过');
    const second = deprecatePublishing(first.snapshot);
    expect(second).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    if (second.kind !== 'rejected') return;
    expect(second.reason).toContain('未声明于节点 "deprecated"');
  });

  it('未知 application rel / 非 deprecate 动作 → undeclared(声明层第 1 层)', () => {
    const { snapshot } = seeded();
    expect(
      executeMeta(
        { rel: 'meta/application:ghost', action: 'deprecate', actor: 'human' },
        snapshot,
        deps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    expect(
      executeMeta(
        { rel: 'meta/application:publishing', action: 'revive', actor: 'human' },
        snapshot,
        deps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });
});

describe('I5 — seeded + deprecate 事件对的全量重放', () => {
  it('全量重放:实例节点/applications 删键/deprecatedApplications 审计/definitions 级联一致;幂等', () => {
    const { snapshot, log } = seeded();
    const outcome = deprecatePublishing(snapshot, { reason: '走查残留清理' });
    if (outcome.kind !== 'executed') throw new Error('前置失败:deprecate 应通过');
    const fullLog: LogEvent[] = [
      ...log,
      ...outcome.events.map((event, index) => ({ ...event, seq: 10 + index })),
    ];

    const replayed = fold(fullLog, { flows: {} });
    expect(replayed.instances['meta/application:publishing']?.node).toBe('deprecated');
    expect(replayed.applications).toEqual({ default: defaultApp });
    expect(replayed.deprecatedApplications).toEqual({
      publishing: { name: 'publishing', reason: '走查残留清理', seq: 11 },
    });
    expect(replayed.definitions?.['post-status']?.status).toBe('deprecated');
    expect(replayed.definitions?.['comment-moderation']?.status).toBe('active');

    // 与在线快照逐表一致(审计表除外——seq 属日志层,fold 是唯一物化点)。
    expect(replayed.instances).toEqual(outcome.snapshot.instances);
    expect(replayed.applications).toEqual(outcome.snapshot.applications);
    expect(replayed.definitions).toEqual(outcome.snapshot.definitions);

    // 幂等:重复停用事件(防御性重放)不改变快照,审计首写为准。
    const duplicated: LogEvent[] = [...fullLog, { ...fullLog[5]!, seq: 99 }];
    expect(fold(duplicated, { flows: {} })).toEqual(replayed);
  });

  it('分段折叠一致:种子段 → 停用段(增量 fold 的根基)', () => {
    const { snapshot, log } = seeded();
    const outcome = deprecatePublishing(snapshot);
    if (outcome.kind !== 'executed') throw new Error('前置失败:deprecate 应通过');
    const deprecateLog = outcome.events.map((event, index) => ({ ...event, seq: 10 + index }));

    const whole = fold([...log, ...deprecateLog], { flows: {} });
    const segmented = fold(deprecateLog, { flows: {} }, fold(log, { flows: {} }));
    expect(segmented).toEqual(whole);
  });
});
describe('确认门 — 挂起语义(注入严策略;builtin/随附 Cedar 对 human 直通)', () => {
  it('active 应用首次 deprecate 被严策略拦下 → suspended:pending 确认实体,效果不应用', () => {
    const { snapshot, log } = seeded();
    const suspended = deprecatePublishing(snapshot, { reason: '清理', deps: strictDeps });
    expect(suspended.kind).toBe('suspended');
    if (suspended.kind !== 'suspended') return;

    expect(suspended.confirmation).toMatchObject({
      id: 'c1',
      targetRel: 'meta/application:publishing',
      targetAction: 'deprecate',
      proposedBy: { actor: 'human', principal: 'user:mike' },
      policyReason: 'test:always 策略要求确认',
    });
    expect(suspended.snapshot.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'pending',
      riskLevel: 'high',
    });
    // 挂起不应用效果:实例仍在 active,applications 不动。
    expect(suspended.snapshot.instances['meta/application:publishing']?.node).toBe('active');
    expect(suspended.snapshot.applications).toEqual({
      default: defaultApp,
      publishing: publishingApp,
    });

    // 挂起路径的 fold 同构(confirmation-requested 物化 pending 实体)。
    const suspendedLog = suspended.events.map((event, index) => ({ ...event, seq: 10 + index }));
    expect(fold([...log, ...suspendedLog], { flows: {} })).toEqual(suspended.snapshot);
  });

  it('确认后批准:效果经 applyEffects 应用(节点→deprecated);确认链路只重放目标动作效果、不产 meta 伴随事件(机制事实,与 definition approve 同口径)', () => {
    const { snapshot, log } = seeded();
    const suspended = deprecatePublishing(snapshot, { reason: '清理', deps: strictDeps });
    if (suspended.kind !== 'suspended') throw new Error('前置失败:期望 suspended');

    const approved = approveConfirmation(
      suspended.snapshot,
      'c1',
      { actor: 'human', principal: 'user:admin' },
      { flows: withLifecycleFlows({}), guards: seedGuardRegistry },
    );
    expect(approved.kind).toBe('confirmed');
    if (approved.kind !== 'confirmed') return;

    // 委托语义生效:节点迁移到 deprecated。
    expect(approved.snapshot.instances['meta/application:publishing']?.node).toBe('deprecated');
    // 机制事实(如实钉测):approveConfirmation 只重放目标动作效果,
    // 事件链为 [confirmation-approved, action-executed]——不产 application-deprecated
    // 伴随事件,也不做 applications 删键/定义级联(与 definition approve 在确认
    // 链路不产 definition-activated 同口径;内置/随附 Cedar 策略对 human 直通,
    // 该路径仅在更严策略下可达,fold 与在线在该链路上仍逐字段同构)。
    expect(approved.events.map((event) => event.kind)).toEqual([
      'confirmation-approved',
      'action-executed',
    ]);
    expect(approved.snapshot.applications).toEqual({
      default: defaultApp,
      publishing: publishingApp,
    });

    // 该链路的 fold 同构:confirmation-requested/approved/action-executed 重放
    // 与在线批准快照逐字段一致(无伴随事件,故两边都无级联——不产生漂移)。
    const suspendedLog = suspended.events.map((event, index) => ({ ...event, seq: 10 + index }));
    const approvedLog = approved.events.map((event, index) => ({ ...event, seq: 20 + index }));
    expect(fold([...log, ...suspendedLog, ...approvedLog], { flows: {} })).toEqual(
      approved.snapshot,
    );
  });
});
