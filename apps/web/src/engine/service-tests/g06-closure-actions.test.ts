/**
 * G06(T54 Phase 5):业务收尾动作——待办「完成后归档」、文章「下线后归档/编辑正文」。
 *
 * - 动作经定义声明落地(bundle 种子;部署站经同形状受治理 Flow Draft 交付);
 *   界面继续从当前 Siren 动作生成,零硬编码业务页;
 * - 人/agent 同门(动作无 actor 守卫,同一裁决器);
 * - born-version 边界:新实例获得新动作,激活前出生的实例守出生合同
 *   (经受治理 Draft 修订钉测:修订新增动作只对新出生实例可见,不偷偷改写
 *   存量实例的 bornVersion);
 * - 编辑保留对象身份(rel 不变)与历史可追溯(事件链完整)。
 */
import { describe, expect, it } from 'vitest';

import { ensureEventsTable, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { ensureDraftTables } from '@ui4a/db/drafts';

import { getEngine, resetEngineForTests } from '../service';
import { executeDraftMeta } from '../drafts/drafts';

const pool = getPool(process.env.DATABASE_URL!);

async function boot() {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  return getEngine(pool);
}

describe('G06 业务收尾动作', () => {
  it('待办:完成后直接归档(done.archive),不经「先重开再归档」绕路;人/agent 同门', async () => {
    const engine = await boot();
    const created = await engine.exec({
      rel: 'flow:todo-capture',
      action: 'add',
      params: { title: 'G06 待办收尾' },
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(created.kind).toBe('accepted');

    const collection = await engine.getEntity('todos');
    const member = collection?.entities?.at(-1);
    expect(member).toBeDefined();
    const rel = member!.properties.rel as string;

    const completed = await engine.exec({
      rel,
      action: 'complete',
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(completed.kind).toBe('accepted');

    // done 节点可直接请求归档；Agent 高风险动作仍需人类决定。
    const archived = await engine.exec({
      rel,
      action: 'archive',
      actor: 'agent',
      principal: 'local-user',
      channel: 'http',
    });
    expect(archived.kind).toBe('suspended');
    if (archived.kind !== 'suspended') throw new Error('expected confirmation');
    expect(engine.getSnapshot().instances[rel]?.node).toBe('done');
    const approved = await engine.exec({
      rel: archived.entity.properties.rel as string,
      action: 'approve',
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(approved.kind).toBe('accepted');
    expect(engine.getSnapshot().instances[rel]?.node).toBe('archived');

    // 历史可追溯:complete → archive 事件链在场。
    const kinds = (await readLog(pool, 0))
      .filter((event) => event.rel === rel)
      .map((event) => `${event.action}:${event.kind}`);
    expect(kinds).toContain('complete:action-executed');
    expect(kinds).toContain('archive:action-executed');
  });

  it('文章:下线后编辑正文(身份保留)再归档', async () => {
    const engine = await boot();
    // 三步向导:basic-info → classification → content → ready → publish。
    const steps: Array<{ action: string; params: Record<string, unknown> }> = [
      { action: 'next', params: { title: 'G06 文章' } },
      { action: 'next', params: { category: 'essay' } },
      { action: 'next', params: { body: '初版正文' } },
      { action: 'publish', params: { title: 'G06 文章' } },
    ];
    let rel = 'flow:article-drafting';
    for (const step of steps) {
      const outcome = await engine.exec({
        rel,
        action: step.action,
        params: step.params,
        actor: 'human',
        principal: 'local-user',
        channel: 'http',
      });
      if (outcome.kind === 'rejected') {
        throw new Error(`向导步骤 ${step.action} 被拒:${outcome.reason}`);
      }
      expect(outcome.kind).toBe('accepted');
      if (outcome.kind === 'accepted') rel = outcome.entity.properties.rel as string;
    }
    const articleRel = rel;

    const unpublished = await engine.exec({
      rel: articleRel,
      action: 'unpublish',
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(unpublished.kind).toBe('accepted');
    expect(engine.getSnapshot().instances[articleRel]?.node).toBe('offline');

    // 下线后编辑正文:字段更新,节点保持 offline,身份(rel)不变。
    const edited = await engine.exec({
      rel: articleRel,
      action: 'edit',
      params: { title: 'G06 文章(修订)', body: '修订后的正文' },
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(edited.kind).toBe('accepted');
    const instance = engine.getSnapshot().instances[articleRel]!;
    expect(instance.node).toBe('offline');
    expect((instance.fields.title as { value: unknown }).value).toBe('G06 文章(修订)');
    expect((instance.fields.body as { value: unknown }).value).toBe('修订后的正文');

    // 下线后归档。
    const archived = await engine.exec({
      rel: articleRel,
      action: 'archive',
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(archived.kind).toBe('accepted');
    expect(engine.getSnapshot().instances[articleRel]?.node).toBe('archived');
    expect(
      (engine.getSnapshot().instances[articleRel]?.fields.title as { value: unknown }).value,
    ).toBe('G06 文章(修订)');
  });

  it('born-version 边界:受治理 Draft 修订新增动作只对修订后出生的实例可见', async () => {
    const engine = await boot();
    // 修订前出生的实例(open)。
    const created = await engine.exec({
      rel: 'flow:todo-capture',
      action: 'add',
      params: { title: '出生版本对照' },
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(created.kind).toBe('accepted');
    const oldRel = (await engine.getEntity('todos'))!.entities!.at(-1)!.properties.rel as string;

    // 受治理 Flow Draft:todo-item open 节点新增 note 动作(测试形状)。
    const current = engine.getSnapshot().definitions!['todo-item']!.definition as unknown as Record<
      string,
      unknown
    > & { nodes: Array<Record<string, unknown>> };
    const payload = JSON.parse(JSON.stringify(current));
    payload.version = (payload.version ?? 1) + 1;
    for (const node of payload.nodes) {
      if (node.name === 'open') {
        (node.actions as unknown[]).push({
          name: 'note',
          title: '备注',
          method: 'POST',
          guards: [],
          fields: [{ name: 'note', type: 'text', semantics: 'intent' }],
          effect: [{ type: 'set-field', field: 'note', 'from-param': 'note', origin: 'body' }],
        });
      }
    }
    const draft = await executeDraftMeta(
      pool,
      engine,
      {
        rel: 'meta/drafts',
        action: 'create',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { kind: 'flow-definition', target: 'todo-item', commandId: 'g06:create', payload },
      },
      { policyScope: 'todo' },
    );
    if (draft.kind === 'rejected') {
      throw new Error(`draft create 被拒:${draft.reason}`);
    }
    expect(draft.kind).toBe('accepted');
    const draftRel = draft.kind === 'accepted' ? String(draft.entity.properties.rel) : '';

    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel: draftRel,
        action: 'submit',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'g06:submit' },
      },
      { policyScope: 'todo' },
    );
    if (submitted.kind === 'rejected') throw new Error(`submit 被拒:${submitted.reason}`);
    expect(submitted.kind).toBe('accepted');
    const activation =
      submitted.kind === 'accepted' ? String(submitted.entity.properties.activation) : '';

    const approved = await executeDraftMeta(
      pool,
      engine,
      {
        rel: activation,
        action: 'approve',
        actor: 'human',
        principal: 'user:mike',
        channel: 'human-renderer',
        params: { commandId: 'g06:approve' },
      },
      { policyScope: 'todo' },
    );
    if (approved.kind === 'rejected') throw new Error(`approve 被拒:${approved.reason}`);
    expect(approved.kind).toBe('accepted');

    // 修订后出生的实例:note 可用(先 another 回到捕捉节点)。
    const another = await engine.exec({
      rel: 'flow:todo-capture',
      action: 'another',
      params: {},
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(another.kind).toBe('accepted');
    const newborn = await engine.exec({
      rel: 'flow:todo-capture',
      action: 'add',
      params: { title: '修订后出生' },
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    if (newborn.kind === 'rejected') throw new Error(`newborn add 被拒:${newborn.reason}`);
    expect(newborn.kind).toBe('accepted');
    const newRel = (await engine.getEntity('todos'))!.entities!.at(-1)!.properties.rel as string;
    const noted = await engine.exec({
      rel: newRel,
      action: 'note',
      params: { note: '新实例可用' },
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(noted.kind).toBe('accepted');

    // 修订前出生的实例:note 未声明于出生版本(结构化拒绝,不改写 bornVersion)。
    const denied = await engine.exec({
      rel: oldRel,
      action: 'note',
      params: { note: '不应生效' },
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    expect(denied).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });
});
