/**
 * meta 平面 Siren 投影(T4 Phase A Task 1,TDD 红→绿)。
 *
 * A.2 定义实体形状(arch-brief §10 原样节选):
 *   class ["meta","flow-definition"],properties {name,version,status,initial,terminal},
 *   entities[] = node-definition 子实体(内嵌 action-definition),actions = 编辑动词,
 *   links self。
 * meta/self = definition-lifecycle 自身定义的只读视图(+种子 guard 集)。
 * 投影口径与 confirmation 同:guard 以空参数求值,依赖参数的谓词 fail-closed。
 */
import { describe, expect, it } from 'vitest';

import type {
  ActivationSnapshot,
  DefinitionEntry,
  EngineSnapshot,
  GuardRegistry,
} from '@ui4a/shared';
import { postStatusFlow } from './fixtures';
import { DEFINITION_LIFECYCLE_FLOW } from './lifecycle';
import { project } from './siren';
import type { SirenEntity } from './siren';

/** 与种子谓词同义的测试注册表(真实实现 Task 2 入 @ui4a/shared;空参数 vacuous)。 */
const metaTestGuards: GuardRegistry = {
  'is-draft': (ctx) => ctx.instance.node === 'draft',
  'is-active': (ctx) => ctx.instance.node === 'active',
  'node-not-exists': () => true,
  'node-exists': () => true,
  'to-exists': () => true,
  'guards-registered': () => true,
  'effect-known': () => true,
  'action-not-exists': () => true,
  'no-live-instances': () => true,
  'actor-is-human': (ctx) => ctx.actor === 'human',
};

const deps = {
  flows: { 'definition-lifecycle': DEFINITION_LIFECYCLE_FLOW } as const,
  guards: metaTestGuards,
};

/** 造一个 meta 快照:post-status 的 lifecycle 实例(node = 状态)+ definitions 表。 */
function metaSnapshot(
  status: DefinitionEntry['status'] | 'validating',
  definition: ReturnType<typeof cloneFlow> = cloneFlow(),
): EngineSnapshot {
  return {
    instances: {
      'meta/flow:post-status': {
        rel: 'meta/flow:post-status',
        flow: 'definition-lifecycle',
        node: status,
        fields: {},
      },
    },
    collections: {},
    definitions: {
      // validating 是瞬态,定义条目实际不持久化该状态;投影按审计视图宽容处理。
      'post-status': { name: 'post-status', version: 1, status: status as DefinitionEntry['status'], definition },
    },
  };
}

function cloneFlow() {
  return JSON.parse(JSON.stringify(postStatusFlow)) as typeof postStatusFlow;
}

describe('meta/self 投影(definition-lifecycle 自身定义,只读)', () => {
  it('A.2 形状:class meta/flow-definition,properties 含 name/version/status/initial/terminal + 种子 guard 集', () => {
    const entity = project(metaSnapshot('active'), 'meta/self', deps);
    expect(entity).toBeDefined();
    expect(entity!.class).toEqual(['meta', 'flow-definition']);
    expect(entity!.properties).toMatchObject({
      name: 'definition-lifecycle',
      version: 1,
      status: 'active',
      initial: 'draft',
      terminal: ['rejected', 'deprecated'],
    });
    expect(entity!.properties.guards).toEqual(
      expect.arrayContaining(['is-draft', 'node-exists', 'to-exists', 'actor-is-human']),
    );
  });

  it('只读:无 actions;entities 携带 node-definition(含 action-definition 子实体)', () => {
    const entity = project(metaSnapshot('active'), 'meta/self', deps)!;
    expect(entity.actions).toEqual([]);
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=meta/self' },
    ]);
    const draftNode = entity.entities!.find(
      (sub) => sub.properties.name === 'draft',
    );
    expect(draftNode?.class).toEqual(['meta', 'node-definition']);
    expect(draftNode?.rel).toEqual(['node']);
    const addAction = draftNode?.entities?.find(
      (sub) => sub.properties.name === 'add-action',
    );
    expect(addAction?.class).toEqual(['meta', 'action-definition']);
    expect(addAction?.properties).toMatchObject({
      name: 'add-action',
      method: 'POST',
      guards: [
        'is-draft',
        'node-exists',
        'to-exists',
        'guards-registered',
        'effect-known',
        'action-not-exists',
      ],
    });
  });
});

describe('meta/flow:<name> 投影(A.2 定义实体)', () => {
  it('draft 状态:properties {name,version,status,initial,terminal};actions = 编辑动词(add-node/add-action/submit)', () => {
    const entity = project(metaSnapshot('draft'), 'meta/flow:post-status', deps)!;
    expect(entity.class).toEqual(['meta', 'flow-definition']);
    expect(entity.properties).toEqual({
      name: 'post-status',
      version: 1,
      status: 'draft',
      initial: 'published',
      // terminal = 无出边节点:offline(无动作)与 archived(A.2 示例只列 archived,
      // 此处按推导口径:published --unpublish--> offline 也是终态)。
      terminal: ['offline', 'archived'],
    });
    expect(entity.actions.map((a) => a.name)).toEqual(['add-node', 'add-action', 'submit']);
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=meta/flow:post-status' },
    ]);
  });

  it('entities:节点子实体(含 action-definition 声明全文:to/guards/requires-confirmation/effect)', () => {
    const entity = project(metaSnapshot('draft'), 'meta/flow:post-status', deps)!;
    const published = entity.entities!.find((sub) => sub.properties.name === 'published')!;
    expect(published.class).toEqual(['meta', 'node-definition']);
    expect(published.properties).toEqual({ name: 'published', title: '已发布' });
    const archive = published.entities!.find((sub) => sub.properties.name === 'archive')!;
    expect(archive.properties).toMatchObject({
      name: 'archive',
      title: '归档',
      method: 'POST',
      to: 'archived',
      guards: [],
      'requires-confirmation': 'high',
      effect: [{ type: 'transition', to: 'archived' }],
    });
  });

  it('active 状态:actions = revise/deprecate(A.2 原样)', () => {
    const entity = project(metaSnapshot('active'), 'meta/flow:post-status', deps)!;
    expect(entity.properties).toMatchObject({ status: 'active', version: 1 });
    expect(entity.actions.map((a) => a.name)).toEqual(['revise', 'deprecate']);
  });

  it('guard-results 逐项注入(同一谓词的两个投影):空参数求值下编辑动词全部放行', () => {
    const entity = project(metaSnapshot('draft'), 'meta/flow:post-status', deps)!;
    const byAction = Object.fromEntries(
      entity['guard-results']!.map((entry) => [entry.action, entry]),
    );
    // 投影口径(与业务谓词一致):依赖参数的谓词对空参数 vacuous pass——
    // 真正裁决在 exec 时(to-exists 等以实参求值,拒绝带原因回流)。
    expect(byAction.submit.blocked).toBe(false);
    expect(byAction['add-node'].blocked).toBe(false);
    expect(byAction['add-action'].blocked).toBe(false);
  });

  it('rejected/validating/pending-approval 状态:无编辑动作(审计视图;approve/reject 在 activation 实体)', () => {
    for (const status of ['rejected', 'validating', 'pending-approval'] as const) {
      const entity = project(metaSnapshot(status), 'meta/flow:post-status', deps)!;
      expect(entity.actions, `status=${status}`).toEqual([]);
      expect(entity['guard-results'], `status=${status}`).toEqual([]);
    }
  });

  it('未知定义名 → undefined(HTTP 层映射 404)', () => {
    expect(project(metaSnapshot('active'), 'meta/flow:ghost', deps)).toBeUndefined();
  });

  it('lifecycle 实例同 rel 不走业务实例投影(meta 前缀优先,定义层显式意图)', () => {
    // meta/flow:post-status 同时是 instances 表里的 lifecycle 实例;
    // 投影必须是定义实体,而不是 flow-instance 视图。
    const entity: SirenEntity | undefined = project(
      metaSnapshot('draft'),
      'meta/flow:post-status',
      deps,
    );
    expect(entity!.class).not.toContain('flow-instance');
  });
});

describe('meta/flows 集合投影', () => {
  it('全部定义实体为子实体(rel=item + 直达 href),properties 含 count', () => {
    const entity = project(metaSnapshot('active'), 'meta/flows', deps)!;
    expect(entity.class).toEqual(['collection', 'meta/flows']);
    expect(entity.properties).toMatchObject({ rel: 'meta/flows', count: 1 });
    expect(entity.entities).toHaveLength(1);
    expect(entity.entities![0].rel).toEqual(['item']);
    expect(entity.entities![0].href).toBe('/api/entity?rel=meta/flow:post-status');
    expect(entity.entities![0].properties).toMatchObject({ name: 'post-status', status: 'active' });
  });
});

describe('meta/activation:<id> 激活实体投影(A.2 激活请求形状)', () => {
  function activationSnapshot(
    status: 'pending-approval' | 'approved' | 'rejected',
  ): ActivationSnapshot {
    return {
      id: 'a1',
      flow: 'post-status',
      status,
      version: 2,
      artifact: 'abc123def456',
      checks: [
        { name: 'edge-targets-exist', pass: true },
        { name: 'guards-registered', pass: false, detail: ['nodes[published].actions[unpublish]: no-such-guard 未注册'] },
      ],
      definition: cloneFlow(),
      // 机械 diff 纯数据(T4 Phase C):引擎在 submit 时计算,投影原样携带——
      // 审批者看到的 diff 来自内建渲染,不经过被审批者的任何渲染器(铁律 5)。
      diff: {
        algorithm: 'deep-object-diff',
        before: cloneFlow(),
        after: cloneFlow(),
        changed: {
          added: { nodes: { 2: { actions: { 1: { name: 'pin', title: '置顶' } } } } },
          deleted: {},
          updated: { title: '文章状态(v2)' },
        },
      },
      requestedBy: { actor: 'agent', principal: 'user:mike' },
      ...(status === 'approved' ? { approvedBy: { actor: 'human' } } : {}),
      ...(status === 'rejected' ? { rejectedReason: '理由' } : {}),
    };
  }

  function snapshotWith(status: 'pending-approval' | 'approved' | 'rejected'): EngineSnapshot {
    const snapshot = metaSnapshot('pending-approval');
    return {
      ...snapshot,
      activations: { 'meta/activation:a1': activationSnapshot(status) },
    };
  }

  it('pending:properties{id,status,artifact,checks,requested-by,version,flow};actions approve/reject', () => {
    const entity = project(snapshotWith('pending-approval'), 'meta/activation:a1', deps)!;
    expect(entity.class).toEqual(['meta', 'activation', 'pending-approval']);
    expect(entity.properties).toMatchObject({
      id: 'a1',
      status: 'pending-approval',
      artifact: 'abc123def456',
      checks: activationSnapshot('pending-approval').checks,
      'requested-by': { actor: 'agent', principal: 'user:mike' },
      version: 2,
      flow: 'post-status',
    });
    expect(entity.actions.map((a) => a.name)).toEqual(['approve', 'reject']);
    // 机械 diff 原样入 properties(纯数据;渲染在 BIOS 内建面,零 AI)。
    expect(entity.properties.diff).toEqual(activationSnapshot('pending-approval').diff);
    // reject 的 reason 字段 schema 必填且非空。
    const rejectAction = entity.actions[1]!;
    expect(rejectAction.fields).toMatchObject({
      required: ['reason'],
      properties: { reason: { minLength: 1 } },
    });
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=meta/activation:a1' },
      { rel: ['target'], href: '/api/entity?rel=meta/flow:post-status' },
    ]);
  });

  it('guard-results:approve/reject 的 actor-is-human 在投影 fail-closed(同一谓词的两个投影)', () => {
    const entity = project(snapshotWith('pending-approval'), 'meta/activation:a1', deps)!;
    for (const entry of entity['guard-results']!) {
      expect(entry.blocked).toBe(true);
      expect(entry.reason).toContain('actor-is-human=false');
    }
  });

  it('已决策(approved/rejected)是审计视图:无动作、无 guard-results', () => {
    for (const status of ['approved', 'rejected'] as const) {
      const entity = project(snapshotWith(status), 'meta/activation:a1', deps)!;
      expect(entity.actions, status).toEqual([]);
      expect(entity['guard-results'], status).toEqual([]);
      expect(entity.properties).toMatchObject({ status });
    }
  });

  it('未知激活 id → undefined;meta/activations = 待审队列(仅 pending)', () => {
    expect(project(snapshotWith('pending-approval'), 'meta/activation:ghost', deps)).toBeUndefined();
    const queue = project(snapshotWith('pending-approval'), 'meta/activations', deps)!;
    expect(queue.class).toEqual(['collection', 'meta/activations']);
    expect(queue.properties).toMatchObject({ rel: 'meta/activations', count: 1 });
    expect(queue.entities![0].href).toBe('/api/entity?rel=meta/activation:a1');

    const decidedOnly = {
      ...snapshotWith('approved'),
      activations: { 'meta/activation:a1': activationSnapshot('approved') },
    };
    expect(project(decidedOnly, 'meta/activations', deps)!.properties).toMatchObject({ count: 0 });
  });
});
