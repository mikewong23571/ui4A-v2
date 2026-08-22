/**
 * definition-versions 可读投影(T13 Phase B Task 1;spec 架构决定 2 前半):
 * 经 S2 式 revise → add-action → submit → approve 激活 v2 后:
 * - meta/flow:<name> 投影携带版本历史摘要子实体(v1/v2 均在;active 标记随
 *   活跃指针;来源 = definition-seeded / definition-activated + 激活 id 与
 *   审批者——由 activations 表推导,与 definition-activated 事件同口径);
 * - 按版本取定义的读取路径 = 子实体 properties.definition 内嵌该版全文
 *   (KB 级 JSON,体积可控;两版对比 Task 2 取两版子实体即可,无需另开端点);
 * - 版本子实体不挂 href:rule driver 的 navigableRels 会把子实体 href 纳入
 *   agent 可导航候选——版本是 BIOS 数据面,不是 agent 决策面。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { FlowDefinition, SirenEntity } from '@ui4a/engine';

import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { businessFlows } from '../domain/flows';

import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

/** 版本摘要子实体(class 含 definition-version;/meta/flow/<name> 版本历史区数据源)。 */
function versionSubEntities(entity: SirenEntity): SirenEntity[] {
  return (entity.entities ?? []).filter((sub) => sub.class.includes('definition-version'));
}

/** 经 service.exec 走 meta 动作(与 /_meta/api/exec 同一入口)。 */
async function metaExec(
  request: Parameters<Awaited<ReturnType<typeof getEngine>>['exec']>[0],
) {
  const engine = await getEngine(pool);
  return engine.exec(request);
}

/** S2 式激活链:post-status published 节点加 feature → v2 激活。 */
async function activateV2(): Promise<void> {
  for (const [action, params] of [
    ['revise', undefined],
    [
      'add-action',
      { node: 'published', action: { name: 'feature', title: '加精', to: 'archived' } },
    ],
    ['submit', undefined],
    ['approve', undefined],
  ] as const) {
    const outcome = await metaExec({
      rel: 'meta/flow:post-status',
      action,
      actor: action === 'approve' ? 'human' : 'agent',
      ...(action === 'approve' ? { principal: 'local-user' } : {}),
      ...(params !== undefined ? { params } : {}),
    });
    if (outcome.kind !== 'accepted') throw new Error(`${action} 应通过`);
  }
}

describe('definition-versions 可读投影(service 编排;S2 式激活链)', () => {
  it('种子态:仅 v1(active;来源 definition-seeded;全文 = 种子原文;无 href)', async () => {
    const engine = await getEngine(pool);
    const entity = await engine.getMetaEntity('meta/flow:post-status');
    expect(entity).toBeDefined();
    const versions = versionSubEntities(entity!);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.rel).toEqual(['version']);
    expect(versions[0]!.properties).toEqual({
      version: 1,
      status: 'active',
      source: 'definition-seeded',
      definition: businessFlows['post-status'],
    });
    expect(versions[0]!.href).toBeUndefined();
  });

  it('激活 v2 后:v1/v2 均在,active 随 v2;来源与审批者正确(版本序排列)', async () => {
    await activateV2();
    const engine = await getEngine(pool);
    const entity = await engine.getMetaEntity('meta/flow:post-status');
    const versions = versionSubEntities(entity!);
    expect(versions.map((sub) => sub.properties.version)).toEqual([1, 2]);
    expect(versions[0]!.properties).toMatchObject({
      version: 1,
      status: 'superseded',
      source: 'definition-seeded',
    });
    expect(versions[1]!.properties).toMatchObject({
      version: 2,
      status: 'active',
      source: 'definition-activated',
      activation: 'a1',
      'decided-by': { actor: 'human', principal: 'local-user' },
    });
  });

  it('按版本取定义:properties.definition 内嵌全文——v1 = 种子原文(历史不漂移),v2 = 激活内容(含 feature)', async () => {
    await activateV2();
    const engine = await getEngine(pool);
    const entity = await engine.getMetaEntity('meta/flow:post-status');
    const versions = versionSubEntities(entity!);

    // v1 全文 = 种子定义原文(approve 只移指针,历史不漂移;Task 2 的 before)。
    expect(versions[0]!.properties.definition).toEqual(businessFlows['post-status']);

    // v2 全文 = 激活内容(published 节点含 feature;Task 2 的 after)。
    const v2 = versions[1]!.properties.definition as FlowDefinition;
    const published = v2.nodes.find((node) => node.name === 'published')!;
    expect(published.actions.map((action) => action.name)).toContain('feature');
  });

  it('无独立版本 rel:meta/flow:<name>@<v> → undefined(HTTP 层 404;读取走 flow 实体内嵌全文)', async () => {
    const engine = await getEngine(pool);
    expect(await engine.getMetaEntity('meta/flow:post-status@1')).toBeUndefined();
  });
});
