import type { EngineSnapshot } from '@ui4a/shared';
import type { FlowDefinition, SirenEntity, Sitemap } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { project } from '@ui4a/engine';

import { filterEntityForGrantedApplications } from '../../../auth/application-scope';

// T38 FR3 D51 回归(apps/web/src/auth 直层 GR3 满员,随实体合同面落位):
// 过滤/分页是读面参数,不是鉴权输入——同一 fixture 上,带参与无参读取的
// 逐行授权投影完全一致,无跨 principal 泄漏面变化。
describe('filterEntityForGrantedApplications × 集合读面查询(D51 回归,T38)', () => {
  const postFlow: FlowDefinition = {
    name: 'post-status',
    app: 'publishing',
    title: '文章状态',
    initial: 'published',
    nodes: [
      { name: 'published', title: '已发布', actions: [] },
      { name: 'offline', title: '已下线', actions: [] },
    ],
  };
  const commentFlow: FlowDefinition = {
    name: 'comment-moderation',
    app: 'community',
    title: '评论审核',
    initial: 'pending',
    nodes: [{ name: 'pending', title: '待处理', actions: [] }],
  };
  // 同一集合混装 publishing/community 成员:audience 差异是逐行裁决的试金石。
  const mixedSnapshot: EngineSnapshot = {
    instances: {
      'post:p1': { rel: 'post:p1', flow: 'post-status', node: 'published', fields: {} },
      'post:p2': { rel: 'post:p2', flow: 'post-status', node: 'offline', fields: {} },
      'comment:c1': { rel: 'comment:c1', flow: 'comment-moderation', node: 'pending', fields: {} },
      'comment:c2': { rel: 'comment:c2', flow: 'comment-moderation', node: 'pending', fields: {} },
    },
    collections: {
      mixed: ['post:p1', 'comment:c1', 'post:p2', 'comment:c2'],
    },
    definitions: {
      'post-status': {
        name: 'post-status',
        version: 1,
        status: 'active' as const,
        definition: postFlow,
      },
      'comment-moderation': {
        name: 'comment-moderation',
        version: 1,
        status: 'active' as const,
        definition: commentFlow,
      },
    },
  };
  const flows = { 'post-status': postFlow, 'comment-moderation': commentFlow };
  const context = {
    snapshot: mixedSnapshot,
    sitemap: {
      version: 't',
      surfaces: [],
      flows: [],
      applications: [],
      capabilities: [],
    } as Sitemap,
    plane: 'business' as const,
    grantedApplications: ['publishing'],
  };
  const rowsOf = (entity: SirenEntity | undefined): Map<string, string> => {
    // project 可能返回 undefined(未知 rel);此处断言三读法全部命中。
    const rows = new Map<string, string>();
    for (const child of entity?.entities ?? []) rows.set(child.href ?? '', JSON.stringify(child));
    return rows;
  };

  it('逐行投影一致:全量/过滤/分页三种读法的可见行集合关系正确且行内容逐字节相同', () => {
    const assertEntity = (entity: SirenEntity | undefined): SirenEntity => {
      if (entity === undefined) throw new Error('mixed 集合应可投影');
      return entity;
    };
    const full = filterEntityForGrantedApplications(
      assertEntity(project(mixedSnapshot, 'mixed', { flows, guards: {} })),
      context,
    );
    const filtered = filterEntityForGrantedApplications(
      assertEntity(
        project(
          mixedSnapshot,
          'mixed',
          { flows, guards: {} },
          {
            offset: 0,
            filter: [{ dimension: 'status', value: 'pending' }],
          },
        ),
      ),
      context,
    );
    const paged = filterEntityForGrantedApplications(
      assertEntity(
        project(mixedSnapshot, 'mixed', { flows, guards: {} }, { offset: 1, filter: [] }),
      ),
      context,
    );

    const fullRows = rowsOf(full);
    // 行级内容逐字节一致:同一 rel 的行无论经哪种读法,投影完全相同。
    for (const rows of [rowsOf(filtered), rowsOf(paged)]) {
      for (const [href, json] of rows) {
        expect(fullRows.get(href)).toBeDefined();
        expect(json).toBe(fullRows.get(href));
      }
    }
    // 可见行集合关系:过滤行/分页行 ⊆ 全量行(无凭空行,零泄漏面变化)。
    const relsOf = (rows: Map<string, string>): Set<string> =>
      new Set(
        [...rows.keys()].map(
          (href) => new URL(href, 'https://ui4a.invalid').searchParams.get('rel') ?? '',
        ),
      );
    const fullRels = relsOf(fullRows);
    const isSubset = (subset: Set<string>, superset: Set<string>): boolean =>
      [...subset].every((rel) => superset.has(rel));
    expect(isSubset(relsOf(rowsOf(filtered)), fullRels)).toBe(true);
    expect(isSubset(relsOf(rowsOf(paged)), fullRels)).toBe(true);
    // 授权裁剪逐行不变:community 行在三种读法中同样缺席(publishing 授予)。
    for (const rows of [rowsOf(filtered), rowsOf(paged)]) {
      for (const href of rows.keys()) {
        expect(href).not.toContain('comment:');
      }
    }
    // 授权后的 count = 可见行数(与无参读法同一口径,无总数字段泄漏)。
    expect(full?.properties.count).toBe(2);
    expect(paged?.properties.count).toBe(1);
    expect(filtered?.properties.count).toBe(0);
  });
});
