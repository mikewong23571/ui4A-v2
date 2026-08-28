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
  CapabilityDefinition,
  DefinitionEntry,
  EngineSnapshot,
  GuardRegistry,
} from '@ui4a/shared';
import { postStatusFlow } from '../core/fixtures';
import { DEFINITION_LIFECYCLE_FLOW } from './lifecycle';
import { project } from '../contract/siren/index';
import type { SirenEntity } from '../contract/siren/index';

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
  extras?: Partial<EngineSnapshot>,
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
      'post-status': {
        name: 'post-status',
        version: 1,
        status: status as DefinitionEntry['status'],
        definition,
      },
    },
    ...extras,
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
    expect(entity.links).toEqual([{ rel: ['self'], href: '/api/entity?rel=meta/self' }]);
    const draftNode = entity.entities!.find((sub) => sub.properties.name === 'draft');
    expect(draftNode?.class).toEqual(['meta', 'node-definition']);
    expect(draftNode?.rel).toEqual(['node']);
    const addAction = draftNode?.entities?.find((sub) => sub.properties.name === 'add-action');
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
      // rel 注入(T22 生产修复):meta 定义实体与业务实体同口径——渲染 deref/
      // 实体缓存一律按 properties.rel 归键,缺 rel 会导致 canvas 全面 deref-failed。
      rel: 'meta/flow:post-status',
      name: 'post-status',
      // T35 S7.1:flow 级 title 随投影携带(声明了才出现,形状稳定口径)——
      // meta 读面以业务标题为主、raw id 退居次要。
      title: '文章状态',
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
      { rel: ['application'], href: '/api/entity?rel=meta/application:default' },
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
        {
          name: 'guards-registered',
          pass: false,
          detail: ['nodes[published].actions[unpublish]: no-such-guard 未注册'],
        },
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
    expect(
      project(snapshotWith('pending-approval'), 'meta/activation:ghost', deps),
    ).toBeUndefined();
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

describe('meta/flow:<name> 版本历史投影(T13 Phase B Task 1;spec 架构决定 2)', () => {
  /** v2 内容:在 v1 克隆上加 pin 动作(模拟 add-action 后的激活内容)。 */
  function v2Flow(): ReturnType<typeof cloneFlow> {
    const flow = cloneFlow();
    const published = flow.nodes.find((node) => node.name === 'published')!;
    published.actions = [
      ...published.actions,
      { name: 'pin', title: '置顶', to: 'published', effect: [{ type: 'transition' as const }] },
    ];
    return flow;
  }

  /** 两版快照:v1 种子 + v2 经 a1 激活(approved;decidedBy human)。 */
  function versionedSnapshot(): EngineSnapshot {
    const v1 = cloneFlow();
    const v2 = v2Flow();
    return metaSnapshot('active', v2, {
      definitions: {
        'post-status': { name: 'post-status', version: 2, status: 'active', definition: v2 },
      },
      definitionVersions: { 'post-status': { 1: v1, 2: v2 } },
      activations: {
        'meta/activation:a1': {
          id: 'a1',
          flow: 'post-status',
          status: 'approved',
          version: 2,
          artifact: 'abc123def456',
          checks: [],
          definition: v2,
          requestedBy: { actor: 'agent', principal: 'user:mike' },
          approvedBy: { actor: 'human', principal: 'local-user' },
        },
      },
    });
  }

  /** definition-version 摘要子实体(class 选择;版本历史区数据源)。 */
  function versionSubEntities(entity: SirenEntity): SirenEntity[] {
    return (entity.entities ?? []).filter((sub) => sub.class.includes('definition-version'));
  }

  it('版本摘要子实体:版本号升序;active 随活跃指针(v2),v1 superseded;来源=种子/激活事件;全文内嵌', () => {
    const snapshot = versionedSnapshot();
    const table = snapshot.definitionVersions!['post-status']!;
    const entity = project(snapshot, 'meta/flow:post-status', deps)!;
    const versions = versionSubEntities(entity);
    expect(versions.map((sub) => sub.properties.version)).toEqual([1, 2]);
    expect(versions[0]!.rel).toEqual(['version']);
    expect(versions[0]!.properties).toEqual({
      version: 1,
      status: 'superseded',
      source: 'definition-seeded',
      definition: table[1],
    });
    expect(versions[1]!.properties).toEqual({
      version: 2,
      status: 'active',
      source: 'definition-activated',
      activation: 'a1',
      'decided-by': { actor: 'human', principal: 'local-user' },
      definition: table[2],
    });
    // 无 href(铁口径):版本子实体是 BIOS 数据面,rule driver 的 navigableRels
    // 会把子实体 href 当 agent 可导航候选——按版本取定义走 properties.definition
    // 内嵌全文(KB 级,体积可控;两版对比 Task 2 取两版子实体即可)。
    expect(versions[0]!.href).toBeUndefined();
    expect(versions[1]!.href).toBeUndefined();
    // 只读:无动作、无 guard-results(历史不可编辑,编辑仍走合同动词)。
    expect(versions[1]!.actions).toEqual([]);
    expect(versions[1]!['guard-results']).toBeUndefined();
  });

  it('种子态(仅 v1 无激活):单版本子实体,active + source definition-seeded + 种子全文', () => {
    const seeded = metaSnapshot('active', cloneFlow(), {
      definitionVersions: { 'post-status': { 1: cloneFlow() } },
    });
    const entity = project(seeded, 'meta/flow:post-status', deps)!;
    const versions = versionSubEntities(entity);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.properties).toEqual({
      version: 1,
      status: 'active',
      source: 'definition-seeded',
      definition: seeded.definitionVersions!['post-status']![1],
    });
  });

  it('历史表缺项(老日志/fixture 快照):回退条目活跃指针与条目定义,单版本 active、无 source 字段', () => {
    const snapshot = metaSnapshot('active');
    const entity = project(snapshot, 'meta/flow:post-status', deps)!;
    const versions = versionSubEntities(entity);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.properties).toEqual({
      version: 1,
      status: 'active',
      // 回退口径与 activeDefinitionOf 同:条目 definition(seed 后未编辑时与活跃内容同文)。
      definition: snapshot.definitions!['post-status']!.definition,
    });
  });

  it('节点子实体不受版本子实体影响(节点表/拓扑按 class 选择的前提)', () => {
    const entity = project(versionedSnapshot(), 'meta/flow:post-status', deps)!;
    const nodes = (entity.entities ?? []).filter((sub) => sub.class.includes('node-definition'));
    expect(nodes.map((sub) => sub.properties.name)).toEqual(['published', 'offline', 'archived']);
  });

  it('无独立版本 rel(meta/flow:<name>@<v> 按未知名 → undefined):读取走 flow 实体内嵌全文', () => {
    const snapshot = versionedSnapshot();
    expect(project(snapshot, 'meta/flow:post-status@1', deps)).toBeUndefined();
    expect(project(snapshot, 'meta/flow:ghost@1', deps)).toBeUndefined();
  });
});

// capability 投影夹具(T13 Phase C Task 3;两个 describe 共用:实体 + 集合)。
const draftCapability: CapabilityDefinition = {
  name: 'draft',
  title: '工件起草',
  kind: 'extract',
  intent: '价值载体字段的草稿工件起草。',
  input: '字段语义与上下文工件。',
  output: '草稿工件候选集。',
};
const notifyCapability: CapabilityDefinition = {
  name: 'notify',
  title: '确认门送达',
  kind: 'effect',
  intent: '确认挂起后的通知送达。',
};

/** capability 快照:capabilities 表两条目(一条全量字段、一条缺省可选字段)。 */
function capabilitySnapshot(): EngineSnapshot {
  return {
    instances: {},
    collections: {},
    capabilities: { draft: draftCapability, notify: notifyCapability },
  };
}

describe('meta/capability:<name> 投影(T13 Phase C Task 3;spec 架构决定 3)', () => {
  it('属性表形状:class meta/capability-definition,properties {name,title,kind,intent,input,output}', () => {
    const entity = project(capabilitySnapshot(), 'meta/capability:draft', deps)!;
    expect(entity.class).toEqual(['meta', 'capability-definition']);
    expect(entity.properties).toEqual({
      rel: 'meta/capability:draft',
      name: 'draft',
      title: '工件起草',
      kind: 'extract',
      intent: '价值载体字段的草稿工件起草。',
      input: '字段语义与上下文工件。',
      output: '草稿工件候选集。',
    });
  });

  it('只读:无动作、guard-results 空;links 仅 self', () => {
    const entity = project(capabilitySnapshot(), 'meta/capability:draft', deps)!;
    expect(entity.actions).toEqual([]);
    expect(entity['guard-results']).toEqual([]);
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=meta/capability:draft' },
    ]);
  });

  it('可选 input/output 缺省不出现(形状稳定口径,同 confirmation 投影)', () => {
    const entity = project(capabilitySnapshot(), 'meta/capability:notify', deps)!;
    expect(entity.properties).toEqual({
      rel: 'meta/capability:notify',
      name: 'notify',
      title: '确认门送达',
      kind: 'effect',
      intent: '确认挂起后的通知送达。',
    });
  });

  it('未知 capability 名 → undefined(HTTP 层映射 404)', () => {
    expect(project(capabilitySnapshot(), 'meta/capability:ghost', deps)).toBeUndefined();
  });
});

describe('meta/capabilities 集合投影', () => {
  it('全部 capability 为子实体(rel=item + 直达 href),properties 含 count', () => {
    const entity = project(capabilitySnapshot(), 'meta/capabilities', deps)!;
    expect(entity.class).toEqual(['collection', 'meta/capabilities']);
    expect(entity.properties).toMatchObject({ rel: 'meta/capabilities', count: 2 });
    expect(entity.entities).toHaveLength(2);
    expect(entity.entities![0]!.rel).toEqual(['item']);
    expect(entity.entities![0]!.href).toBe('/api/entity?rel=meta/capability:draft');
    expect(entity.entities![0]!.properties).toMatchObject({ name: 'draft', kind: 'extract' });
  });

  it('capabilities 表缺省(过渡期)→ 空目录 count 0(面在场,成员为空)', () => {
    const entity = project({ instances: {}, collections: {} }, 'meta/capabilities', deps)!;
    expect(entity.class).toEqual(['collection', 'meta/capabilities']);
    expect(entity.properties).toMatchObject({ rel: 'meta/capabilities', count: 0 });
    expect(entity.entities).toEqual([]);
  });
});
