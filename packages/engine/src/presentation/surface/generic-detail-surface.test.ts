import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '../../contract/siren/index';
import {
  planGenericSurface,
  type SemanticRegionRole,
  type SurfaceCatalog,
  type SurfaceNode,
  type SurfaceTree,
} from './index';

/**
 * T40 Phase C(F-02/F-03):实体详情读面契约——状态词与列表同一合同数据源(节点
 * 标题任务语)、声明字段按 presentation role 分层进入、未声明/未填字段不出现。
 * 全部经通用渲染机器,零 per-class/per-app 分支;断言只读合同数据与绑定路径。
 * semanticHints 由调用方(web 层 semanticHintsOf)从合同投影供给,本测试模拟
 * 该翻译边界。
 */

const catalog: SurfaceCatalog = {
  id: 'catalog:detail-fields',
  version: '1',
  words: {
    prose: {
      roles: ['identity', 'primary-content', 'metadata'],
      bindings: { value: { sources: ['property', 'item'], required: true } },
    },
    state: {
      roles: ['status'],
      bindings: { value: { sources: ['property'], required: true } },
    },
    controls: {
      roles: ['actions'],
      bindings: { actions: { sources: ['actions'], required: true } },
    },
    references: {
      roles: ['relation'],
      bindings: { links: { sources: ['links'], required: true } },
    },
    'member-link': {
      roles: ['identity'],
      pattern: 'member-link',
      bindings: {
        label: { sources: ['item'], required: true },
        rel: { sources: ['item'], required: true },
        status: { sources: ['item'] },
        detail: { sources: ['item'] },
      },
    },
  },
};

/** 模拟 web 层 semanticHintsOf:合同 presentation.fields → {path: role}。 */
function semanticHintsOf(entity: SirenEntity): Record<string, SemanticRegionRole> {
  const presentation = entity.properties.presentation as
    { fields?: Array<{ path: string; role: SemanticRegionRole }> } | undefined;
  return Object.fromEntries(
    (presentation?.fields ?? []).map(({ path, role }): [string, SemanticRegionRole] => [
      path,
      role,
    ]),
  );
}

/** 树序收集词位绑定(kind=property 或 item),保留 role/kind/path。 */
function bindingPaths(surface: SurfaceTree): Array<{ role: string; kind: string; path: string }> {
  const result: Array<{ role: string; kind: string; path: string }> = [];
  const visit = (node: SurfaceNode): void => {
    if (node.kind === 'word') {
      for (const binding of Object.values(node.bindings)) {
        if (binding.kind === 'property' || binding.kind === 'item') {
          result.push({ role: node.role, kind: binding.kind, path: binding.path });
        }
      }
    }
    if (node.kind === 'layout') node.children.forEach(visit);
    if (node.kind === 'slot') visit(node.child);
    if (node.kind === 'repeat') visit(node.item);
  };
  visit(surface.root);
  return result;
}

function plan(rel: string, entity: SirenEntity, intent = 'read'): SurfaceTree {
  return planGenericSurface(rel, entity, catalog, {
    entityVersion: 'entity-v1',
    intent,
    semanticHints: semanticHintsOf(entity),
  });
}

describe('T40 F-02 状态词:详情与列表同一合同数据源(节点标题任务语)', () => {
  const instance: SirenEntity = {
    class: ['flow-instance', 'todo-item'],
    properties: {
      rel: 'todo:ui',
      flow: 'todo-item',
      node: 'open',
      title: '进行中',
      identity: '写报告',
      status: 'open',
      fields: { title: '写报告' },
      presentation: {
        fields: [{ path: 'properties.fields.title', title: '待办标题', role: 'identity' }],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=todo%3Aui' }],
  };

  it('详情状态词绑节点标题(中文),裸 node 枚举不再直出', () => {
    const paths = bindingPaths(plan('todo:ui', instance)).map(({ path }) => path);
    expect(paths).toContain('properties.title');
    expect(paths).not.toContain('properties.node');
  });

  it('列表成员与详情同一状态数据源:都取 properties.title', () => {
    const collection: SirenEntity = {
      class: ['collection', 'todos'],
      properties: { rel: 'todos', title: '待办', count: 1 },
      actions: [],
      links: [],
      entities: [{ ...instance, rel: ['item'], href: '/api/entity?rel=todo%3Aui' }],
    };
    const listBindings = bindingPaths(plan('todos', collection));
    // 成员词(member-link)的 status 绑定 = 节点标题(既有 itemStatusPath 口径)。
    expect(
      listBindings.some(
        ({ role, kind, path }) =>
          role === 'identity' && kind === 'item' && path === 'properties.title',
      ),
    ).toBe(true);
    // 详情状态词同源:property 绑定同一合同字段。
    const detailBindings = bindingPaths(plan('todo:ui', instance));
    expect(
      detailBindings.some(
        ({ role, kind, path }) =>
          role === 'status' && kind === 'property' && path === 'properties.title',
      ),
    ).toBe(true);
  });

  it('回退链 title → status → node,纯结构判定;无 node 实体不产生状态词', () => {
    const withTitle: SirenEntity = {
      class: ['flow-instance'],
      properties: { rel: 'r:one', node: 'open', title: '进行中', status: 'open' },
      actions: [],
      links: [],
    };
    expect(
      bindingPaths(plan('r:one', withTitle)).some(
        ({ role, path }) => role === 'status' && path === 'properties.title',
      ),
    ).toBe(true);

    const withoutTitle: SirenEntity = {
      class: ['flow-instance'],
      properties: { rel: 'r:two', node: 'open', status: 'open' },
      actions: [],
      links: [],
    };
    expect(
      bindingPaths(plan('r:two', withoutTitle)).some(
        ({ role, path }) => role === 'status' && path === 'properties.status',
      ),
    ).toBe(true);

    const onlyNode: SirenEntity = {
      class: ['flow-instance'],
      properties: { rel: 'r:three', node: 'open' },
      actions: [],
      links: [],
    };
    expect(
      bindingPaths(plan('r:three', onlyNode)).some(
        ({ role, path }) => role === 'status' && path === 'properties.node',
      ),
    ).toBe(true);

    const noNode: SirenEntity = {
      class: ['collection', 'col'],
      properties: { rel: 'col', count: 0 },
      actions: [],
      links: [],
    };
    expect(bindingPaths(plan('col', noNode)).some(({ role }) => role === 'status')).toBe(false);
  });
});

describe('T40 F-03 字段分层:声明字段按角色进入详情,未声明/未填字段不出现', () => {
  it('read 预算放量:全部声明的 primary-content 与 metadata 进入详情层', () => {
    const entity: SirenEntity = {
      class: ['flow-instance', 'post-status'],
      properties: {
        rel: 'post:alpha',
        node: 'published',
        title: '已发布',
        status: 'published',
        identity: 'Alpha',
        fields: {
          title: 'Alpha',
          body: '正文内容',
          summary: '一句话摘要',
          category: 'tech',
        },
        presentation: {
          fields: [
            { path: 'properties.fields.title', role: 'identity' },
            { path: 'properties.fields.body', role: 'primary-content' },
            { path: 'properties.fields.summary', role: 'primary-content' },
            { path: 'properties.fields.category', role: 'metadata' },
          ],
        },
      },
      actions: [],
      links: [],
    };
    const paths = bindingPaths(plan('post:alpha', entity)).map(({ path }) => path);
    expect(paths).toEqual([
      'properties.fields.title',
      'properties.title',
      'properties.fields.body',
      'properties.fields.summary',
      'properties.fields.category',
    ]);
  });

  it('未声明字段不进入详情层(不发明、不渲染空壳)', () => {
    const entity: SirenEntity = {
      class: ['flow-instance'],
      properties: {
        rel: 'record:junk',
        node: 'open',
        title: '进行中',
        fields: { title: 'Alpha', junk: 'JUNK' },
        hidden: 'SECRET',
        presentation: {
          fields: [{ path: 'properties.fields.title', role: 'identity' }],
        },
      },
      actions: [],
      links: [],
    };
    const paths = bindingPaths(plan('record:junk', entity)).map(({ path }) => path);
    expect(paths).toContain('properties.fields.title');
    expect(paths).not.toContain('properties.fields.junk');
    expect(paths).not.toContain('properties.hidden');
  });

  it('未填的声明字段不渲染空壳词位(有值才规划)', () => {
    const entity: SirenEntity = {
      class: ['flow-instance', 'todo-item'],
      properties: {
        rel: 'todo:ui',
        node: 'open',
        title: '进行中',
        fields: { title: '写报告' },
        presentation: {
          fields: [
            { path: 'properties.fields.title', role: 'identity' },
            { path: 'properties.fields.note', role: 'primary-content' },
          ],
        },
      },
      actions: [],
      links: [],
    };
    const paths = bindingPaths(plan('todo:ui', entity)).map(({ path }) => path);
    expect(paths).not.toContain('properties.fields.note');
  });
});
