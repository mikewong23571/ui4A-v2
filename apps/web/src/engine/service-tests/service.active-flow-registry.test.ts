/**
 * T52 Phase 1 任务 3:activeFlowList 口径修订(TDD 红→绿)。
 *
 * 语义:status='deprecated' 的 flow 定义退出「活跃 flow 注册表」。activeFlowList
 * 是业务 exec/judge/project/sitemap flows 注册表的唯一组装来源(service.ts
 * bootEngine 内闭包,难以脱离真库独立实例化)——经 service 的可观察面验证:
 * 定义经既有 deprecate 动作置废后,sitemap flows 不再含该 flow,flow:<name>
 * 读面回到 404 诚实;其余 flow 不受影响。
 * 层次依据:activeDefinitionOf 保持「条目当前版本内容」的版本指针语义
 * (bundle 导出/受众归属/在途实例裁决等 status 无关调用方),deprecated 的
 * 排除只落在注册表组装层——该指针语义在 meta.test.ts deprecate 段有钉测。
 * 真库(docker PG);beforeEach TRUNCATE + reset 后重 seed,测试自清理。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('activeFlowList 口径:deprecated 退出活跃注册表(T52 Phase 1 任务 3)', () => {
  it('置废后 sitemap flows 与 flow:<name> 读面不再含该 flow;其余 flow 不受影响', async () => {
    const engine = await getEngine(pool);
    // todo-item 无业务 seed 实例 → no-live-instances 直接过(deprecate 既有动作)。
    expect(engine.getSitemap().flows.map((flow) => flow.name)).toContain('todo-item');
    // 零实例 flow 的 flow:<name> 读面 = 只读实例集合(count=0,定义仍在注册表)。
    expect(await engine.getEntity('flow:todo-item')).toBeDefined();

    const outcome = await engine.exec({
      rel: 'meta/flow:todo-item',
      action: 'deprecate',
      actor: 'human',
    });
    expect(outcome.kind).toBe('accepted');
    expect(engine.getSnapshot().definitions?.['todo-item']?.status).toBe('deprecated');

    const names = engine.getSitemap().flows.map((flow) => flow.name);
    expect(names).not.toContain('todo-item');
    expect(names).toContain('todo-capture');
    expect(names).toContain('post-status');
    // 注册表派生的读面:定义不在活跃集 → flowInstancesCollection 不再兑现 → 404。
    expect(await engine.getEntity('flow:todo-item')).toBeUndefined();
  });

  it('未置废的 draft/pending 条目不误伤:活跃注册表仍按当前版本指针组装', async () => {
    // 反向锚:过滤必须精确针对 deprecated,不得波及草稿窗口的条目
    // (revise 后条目 status=draft,activeDefinitionOf 仍解析最后激活内容)。
    const engine = await getEngine(pool);
    const revised = await engine.exec({
      rel: 'meta/flow:post-status',
      action: 'revise',
      actor: 'agent',
    });
    expect(revised.kind).toBe('accepted');
    expect(engine.getSnapshot().definitions?.['post-status']?.status).toBe('draft');
    expect(engine.getSitemap().flows.map((flow) => flow.name)).toContain('post-status');
  });
});
