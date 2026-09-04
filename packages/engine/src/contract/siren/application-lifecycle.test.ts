/**
 * meta 平面应用实体的 lifecycle 动作镜像与存在性隐藏(T52 Phase 3;
 * D71.2/D71.3/D71.6)。
 *
 * 与定义实体(lifecycleActionsForStatus)同构:动作声明取自
 * APPLICATION_LIFECYCLE 常量的对应状态节点;default 地板在 guard-results
 * 投影可见(同一个谓词的两个投影)。
 *
 * 存在性隐藏铁口径(D71.3 + spec §5 US5):实体面只从 applications active
 * 表取数——停用级联删键后 projectMetaApplication 返回 undefined(路由 404),
 * 对所有主体隐藏;禁止从 deprecatedApplications 投影实体(审计经事件日志,
 * 不在实体面;本测试以「折叠出停用态后投影缺位」钉死)。
 */
import { describe, expect, it } from 'vitest';

import type { ApplicationDefinition } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { executeMeta } from '../../definition/meta';
import { fold, type LogEvent } from '../../projection/fold/index';
import type { FoldSnapshot } from '../../projection/fold/index';
import { project } from './project';

const deps = { flows: {}, guards: seedGuardRegistry };

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

/** 两活跃 app + lifecycle 实例的快照(seed 口径)。 */
function activeSnapshot(): FoldSnapshot {
  return fold([applicationSeedEvent(1, defaultApp), applicationSeedEvent(2, publishingApp)], {
    flows: {},
  });
}

/** 种子 → human deprecate publishing → 全量折叠(载荷即真相:删键 + 审计留痕)。 */
function deprecatedLog(): LogEvent[] {
  const seedLog: LogEvent[] = [
    applicationSeedEvent(1, defaultApp),
    applicationSeedEvent(2, publishingApp),
  ];
  const outcome = executeMeta(
    {
      rel: 'meta/application:publishing',
      action: 'deprecate',
      actor: 'human',
      principal: 'user:mike',
    },
    fold(seedLog, { flows: {} }),
    { guards: seedGuardRegistry },
  );
  if (outcome.kind !== 'executed') throw new Error('前置失败:deprecate 应通过');
  return [...seedLog, ...outcome.events.map((event, index) => ({ ...event, seq: 10 + index }))];
}

describe('meta/application:<name> — 动作镜像(实体面只投影 active 表)', () => {
  it('active 应用:actions = [deprecate](APPLICATION_LIFECYCLE 声明;high 确认 + reason 可选)', () => {
    const entity = project(activeSnapshot(), 'meta/application:publishing', deps)!;
    expect(entity.class).toEqual(['meta', 'application-definition']);
    expect(entity.properties).toMatchObject({
      rel: 'meta/application:publishing',
      status: 'active',
    });
    expect(entity.actions.map((action) => action.name)).toEqual(['deprecate']);
    expect(entity.actions[0]).toMatchObject({ 'requires-confirmation': 'high' });
    // reason 可选:fields schema 的 required 不含 reason。
    const fields = entity.actions[0]!.fields as { required?: string[]; properties: unknown };
    expect(fields.required).not.toContain('reason');
    expect(fields.properties).toHaveProperty('reason');
  });

  it('guard-results 逐项注入:actor-is-human 投影 fail-closed(同一谓词的两个投影)', () => {
    const entity = project(activeSnapshot(), 'meta/application:publishing', deps)!;
    const entry = entity['guard-results']![0]!;
    expect(entry.action).toBe('deprecate');
    expect(entry.blocked).toBe(true);
    expect(entry.reason).toContain('actor-is-human=false');
  });

  it('default 地板投影:application-not-default=false 可见(按钮 disabled 与 agent 看到的拒绝同源)', () => {
    const entity = project(activeSnapshot(), 'meta/application:default', deps)!;
    // 动作仍按声明镜像(投影不裁决);地板以 guard-results 呈现。
    expect(entity.actions.map((action) => action.name)).toEqual(['deprecate']);
    const entry = entity['guard-results']![0]!;
    expect(entry.blocked).toBe(true);
    expect(entry.reason).toContain('application-not-default=false');
    expect(entry.reason).toContain('默认应用不可停用');
  });

  it('未知应用(applications 表无键)→ undefined(HTTP 层映射 404)', () => {
    expect(project(activeSnapshot(), 'meta/application:ghost', deps)).toBeUndefined();
  });

  it('快照缺 lifecycle 实例(旧 fixture 形状):动作仍按状态镜像,guard-results 空', () => {
    const snapshot = activeSnapshot();
    const instances = { ...snapshot.instances };
    delete instances['meta/application:publishing'];
    const entity = project({ ...snapshot, instances }, 'meta/application:publishing', deps)!;
    expect(entity.actions.map((action) => action.name)).toEqual(['deprecate']);
    expect(entity['guard-results']).toEqual([]);
  });
});

describe('存在性隐藏(D71.3/US5:停用即出局,审计不在实体面)', () => {
  it('折叠出停用态后:projectApplication 返回 undefined(applications 键被级联删除 → 404)', () => {
    const snapshot = fold(deprecatedLog(), { flows: {} });
    // 审计集留痕(受众解析/烧毁集侧的事实)……
    expect(snapshot.deprecatedApplications).toMatchObject({ publishing: { name: 'publishing' } });
    // ……但实体面不投影它:键已删 → undefined,对所有主体存在性隐藏。
    expect(project(snapshot, 'meta/application:publishing', deps)).toBeUndefined();
    // 其余应用不受影响。
    expect(project(snapshot, 'meta/application:default', deps)).toBeDefined();
  });

  it('deprecatedApplications 命中而 applications 键在(防御形状):仍按 active 表投影,不读审计集', () => {
    const snapshot = activeSnapshot();
    const contradictory: FoldSnapshot = {
      ...snapshot,
      deprecatedApplications: { publishing: { name: 'publishing', seq: 9 } },
    };
    // 实体面只看 active 表;审计集不是实体面数据源。
    expect(project(contradictory, 'meta/application:publishing', deps)).toBeDefined();
  });
});

describe('meta/applications 集合 — 成员只源自 active 键集', () => {
  it('成员 = applications 键集,summary status 恒 active(与单实体同口径)', () => {
    const collection = project(activeSnapshot(), 'meta/applications', deps)!;
    expect(collection.class).toEqual(['collection', 'meta/applications']);
    expect(collection.properties).toMatchObject({ rel: 'meta/applications', count: 2 });
    const members = collection.entities!;
    expect(members.map((member) => member.properties.name)).toEqual(['default', 'publishing']);
    for (const member of members) {
      expect(member.properties.status).toBe('active');
      expect(member.properties).toHaveProperty('title');
    }
  });

  it('停用成员天然出局:折叠出停用态后集合不含该成员(键已删,审计集不进实体面)', () => {
    const snapshot = fold(deprecatedLog(), { flows: {} });
    const collection = project(snapshot, 'meta/applications', deps)!;
    expect(collection.properties).toMatchObject({ count: 1 });
    expect(collection.entities!.map((member) => member.properties.name)).toEqual(['default']);
  });

  it('applications 表缺省(过渡期)→ 空目录 count 0(面在场,成员为空)', () => {
    const collection = project({ instances: {}, collections: {} }, 'meta/applications', deps)!;
    expect(collection.properties).toMatchObject({ rel: 'meta/applications', count: 0 });
    expect(collection.entities).toEqual([]);
  });
});
