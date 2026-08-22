/**
 * 词条 bindSchema 收紧测试(T7 Phase B):每词条的 bind 形状约束(JSON Schema)
 * ——合法 bind 通过,引用节点类型错配(如 rows 用 field 节点)拒绝。
 * 校验与目录 /api/render/catalog 同源(注册表 bindSchema 即目录 schema)。
 */
import { describe, expect, it } from 'vitest';

import { RENDER_WORDS } from './registry';
import type { BindTree } from './spec';
import { validateWordBind } from './word-bind';

describe('词条 bindSchema 校验', () => {
  it('十词条 bindSchema 均为可编译的 JSON Schema(目录同源)', () => {
    for (const word of RENDER_WORDS) {
      const result = validateWordBind({}, word.name);
      // 空 bind 对任何词条都不合法(required 缺失),但校验器本身不抛
      expect(result.valid).toBe(false);
    }
  });

  it('table:rows 集合节点合法;rows 字段节点拒绝;多余键拒绝', () => {
    const valid = validateWordBind({ rows: { collection: 'articles' } }, 'table');
    expect(valid).toEqual({ valid: true });

    const wrongNode = validateWordBind(
      { rows: { field: 'articles.rel' } } satisfies BindTree,
      'table',
    );
    expect(wrongNode.valid).toBe(false);

    const extra = validateWordBind(
      { rows: { collection: 'articles' }, limit: { field: 'articles.count' } } satisfies BindTree,
      'table',
    );
    expect(extra.valid).toBe(false);
  });

  it('chart:series 须带 dimension(聚合数据源);stat:value 为字段节点', () => {
    expect(validateWordBind({ series: { collection: 'articles', dimension: 'articles.fields.category' } }, 'chart')).toEqual({ valid: true });
    expect(
      validateWordBind({ series: { collection: 'articles' } } satisfies BindTree, 'chart').valid,
    ).toBe(false);
    expect(
      validateWordBind({ value: { field: 'metrics.pending' }, label: { field: 'metrics.label' } }, 'stat'),
    ).toEqual({ valid: true });
    expect(validateWordBind({ value: { collection: 'metrics' } } satisfies BindTree, 'stat').valid).toBe(false);
  });

  it('实体引用词条(flow[graph]/form/diff/markdown/detail[entity]):ref 节点', () => {
    expect(validateWordBind({ graph: { ref: 'entity:sitemap:main' } }, 'flow')).toEqual({
      valid: true,
    });
    expect(
      validateWordBind({ graph: { collection: 'sitemap' } } satisfies BindTree, 'flow').valid,
    ).toBe(false);
    for (const word of ['form', 'diff', 'markdown', 'detail']) {
      expect(validateWordBind({ entity: { ref: 'entity:post:post-welcome' } }, word), word).toEqual({
        valid: true,
      });
      expect(
        validateWordBind({ entity: { field: 'post.title' } } satisfies BindTree, word).valid,
        word,
      ).toBe(false);
    }
  });

  it('timeline/kanban:events/columns 为集合节点;caption 可选', () => {
    expect(validateWordBind({ events: { collection: 'events' } }, 'timeline')).toEqual({ valid: true });
    expect(
      validateWordBind(
        { events: { collection: 'events' }, caption: { field: 'events.name' } },
        'timeline',
      ),
    ).toEqual({ valid: true });
    expect(validateWordBind({ columns: { collection: 'comments' } }, 'kanban')).toEqual({ valid: true });
  });

  it('非聚合词条 table/timeline/kanban 禁止 dimension,避免运行时收到聚合条目', () => {
    const cases = [
      ['table', { rows: { collection: 'articles', dimension: 'articles.fields.category' } }],
      ['timeline', { events: { collection: 'events', dimension: 'events.kind' } }],
      ['kanban', { columns: { collection: 'comments', dimension: 'comments.fields.status' } }],
    ] as const;
    for (const [word, bind] of cases) {
      const result = validateWordBind(bind, word);
      expect(result.valid, word).toBe(false);
      if (!result.valid) {
        expect(
          result.errors.some((error) => `${error.path} ${error.message}`.includes('dimension')),
        ).toBe(true);
      }
    }
  });

  it('未知词名 → 校验失败(错误带词名)', () => {
    const result = validateWordBind({ rows: { collection: 'articles' } }, 'nope');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]!.message).toContain('nope');
  });
});
