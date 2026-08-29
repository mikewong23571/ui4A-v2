import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '../../contract/siren/index';
import {
  planGenericSurface,
  validateSurfaceTree,
  type SurfaceCatalog,
  type SurfaceNode,
  type SurfaceRepeatNode,
  type SurfaceTree,
} from './index';

/**
 * T38 集合查询词汇的 generic 规划测试(自 surface.test.ts 沿功能边界拆出,
 * GR3:文件 ≤800 有效行)。口径:pattern 全部目录声明驱动,零实体特判。
 */

// 无集合查询 pattern 的基线目录(与 surface.test.ts 的模块级 catalog 同 fixture,
// 「未声明 pattern → 零形状漂移」对照用)。
const catalog: SurfaceCatalog = {
  id: 'catalog:baseline',
  version: '7',
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
  },
};

describe('T38 集合查询词汇(generic 规划;目录 pattern 声明驱动,零实体特判)', () => {
  const collectionQueryCatalog: SurfaceCatalog = {
    id: 'catalog:collection-query',
    version: '1',
    words: {
      'member-card': {
        roles: ['identity'],
        pattern: 'member-card',
        bindings: {
          label: { sources: ['item'], required: true },
          rel: { sources: ['item'], required: true },
          status: { sources: ['item'] },
          detail: { sources: ['item'] },
          actions: { sources: ['item'] },
          guardResults: { sources: ['item'] },
          fields: { sources: ['item'] },
        },
      },
      'member-table': {
        roles: ['identity'],
        pattern: 'member-table',
        bindings: {
          label: { sources: ['item'], required: true },
          rel: { sources: ['item'], required: true },
          status: { sources: ['item'] },
          detail: { sources: ['item'] },
          actions: { sources: ['item'] },
          guardResults: { sources: ['item'] },
          fields: { sources: ['item'] },
          presentations: { sources: ['item'] },
        },
      },
      'collection-filters': {
        roles: ['relation'],
        pattern: 'collection-filters',
        bindings: { declarations: { sources: ['property'], required: true } },
      },
      'page-links': {
        roles: ['relation'],
        pattern: 'page-links',
        bindings: { links: { sources: ['links'], required: true } },
      },
    },
  };

  const member: SirenEntity = {
    class: ['post'],
    properties: { rel: 'post:p1', identity: '第一篇', fields: { title: '第一篇' } },
    actions: [{ name: 'publish', title: '发布', method: 'POST', href: '/exec', fields: {} }],
    links: [],
    'guard-results': [],
  };

  function collectionEntity(
    overrides: Partial<Pick<SirenEntity, 'properties' | 'links'>> = {},
  ): SirenEntity {
    return {
      class: ['collection', 'articles'],
      properties: { rel: 'articles', count: 1, ...overrides.properties },
      actions: [],
      links: overrides.links ?? [{ rel: ['self'], href: '/api/entity?rel=articles' }],
      entities: [member],
    };
  }

  const plan = (source: SirenEntity, target: SurfaceCatalog = collectionQueryCatalog) =>
    planGenericSurface('articles', source, target, {
      entityVersion: 'entity-v1',
      intent: 'read',
      density: 'table',
    });

  const relationSlotChild = (surface: SurfaceTree): SurfaceNode => {
    // relation 槽的 child 直接持有 repeat(裸 repeat 或包裹 stack)。
    const holdsRepeatDirectly = (node: SurfaceNode): boolean =>
      node.kind === 'repeat' ||
      (node.kind === 'layout' && node.children.some((child) => child.kind === 'repeat'));
    let found: SurfaceNode | undefined;
    const visit = (node: SurfaceNode): void => {
      if (found !== undefined) return;
      if (node.kind === 'slot' && holdsRepeatDirectly(node.child)) {
        found = node.child;
        return;
      }
      if (node.kind === 'layout') node.children.forEach(visit);
      if (node.kind === 'slot') visit(node.child);
    };
    visit(surface.root);
    if (found === undefined) throw new Error('surface must contain a repeat');
    return found;
  };

  const repeatOf = (child: SurfaceNode): SurfaceRepeatNode => {
    if (child.kind === 'repeat') return child;
    if (child.kind === 'layout') {
      const inner = child.children.find(
        (node): node is SurfaceRepeatNode => node.kind === 'repeat',
      );
      if (inner !== undefined) return inner;
    }
    throw new Error('relation child must contain a repeat');
  };

  it('声明过滤维度 → 过滤词以 properties.presentation.filters 属性绑定入树,repeat 与分页词包裹为 stack', () => {
    const source = collectionEntity({
      properties: {
        rel: 'articles',
        count: 1,
        presentation: {
          filters: [
            { field: 'status', title: '状态', values: [{ value: 'draft', title: '草稿' }] },
          ],
        },
      },
    });
    const child = relationSlotChild(plan(source));
    expect(child).toMatchObject({ kind: 'layout', layout: 'stack', role: 'relation' });
    if (child.kind !== 'layout') throw new Error('unreachable');
    expect(child.children).toHaveLength(3);
    const [filters, repeat, pageLinks] = child.children;
    expect(filters).toMatchObject({
      kind: 'word',
      word: 'collection-filters',
      role: 'relation',
      bindings: {
        declarations: {
          kind: 'property',
          subject: 'articles',
          path: 'properties.presentation.filters',
        },
      },
    });
    expect(repeat).toMatchObject({ kind: 'repeat' });
    expect(pageLinks).toMatchObject({
      kind: 'word',
      word: 'page-links',
      role: 'relation',
      bindings: { links: { kind: 'links', subject: 'articles' } },
    });
    expect(validateSurfaceTree(plan(source), collectionQueryCatalog).valid).toBe(true);
  });

  it('无过滤维度声明 → 只规划分页词(诚实缺省,零过滤零件)', () => {
    const child = relationSlotChild(plan(collectionEntity()));
    expect(child).toMatchObject({ kind: 'layout', layout: 'stack' });
    if (child.kind !== 'layout') throw new Error('unreachable');
    expect(child.children).toHaveLength(2);
    expect(child.children[0]).toMatchObject({ kind: 'repeat' });
    expect(child.children[1]).toMatchObject({ kind: 'word', word: 'page-links' });
  });

  it('目录未声明集合查询 pattern → 树形状与历史版本一致(repeat 独占 relation 槽)', () => {
    const source = collectionEntity({
      properties: {
        rel: 'articles',
        count: 1,
        presentation: {
          filters: [
            { field: 'status', title: '状态', values: [{ value: 'draft', title: '草稿' }] },
          ],
        },
      },
    });
    const child = relationSlotChild(plan(source, catalog));
    expect(child).toMatchObject({ kind: 'repeat' });
  });

  it('member-table 目录声明 presentations → repeat item 携带概览绑定;未声明的 member-card 不携带', () => {
    const tableRepeat = repeatOf(relationSlotChild(plan(collectionEntity())));
    expect(tableRepeat.item).toMatchObject({
      kind: 'word',
      word: 'member-table',
      bindings: {
        fields: { kind: 'item', path: 'properties.fields' },
        presentations: { kind: 'item', path: 'properties.presentation.fields' },
      },
    });

    const cardSource = collectionEntity();
    const cardPlan = planGenericSurface('articles', cardSource, collectionQueryCatalog, {
      entityVersion: 'entity-v1',
      intent: 'read',
    });
    const cardRepeat = repeatOf(relationSlotChild(cardPlan));
    expect(cardRepeat.item).toMatchObject({ kind: 'word', word: 'member-card' });
    const cardItem = cardRepeat.item;
    expect(cardItem.kind === 'word' ? cardItem.bindings.presentations : undefined).toBeUndefined();
  });
});
