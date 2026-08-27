// @vitest-environment jsdom
/**
 * table 词条组件测试(T7 Phase B):给 deref 输出(集合成员实体数组)→
 * TanStack Table 组件树含每行的字段值与列头;caption 字段引用直出。
 * 列零硬编码:从成员 properties.fields 的键并集派生(投影声明什么就显示什么)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { derefSpec } from '../deref';

import { articlesCache, articlesCollection, specOf } from './fixtures';
import { TableWord } from './table';

afterEach(cleanup);

describe('table 词条', () => {
  it('deref 输出 → 表格含字段列头与每行值(列从 fields 键并集派生)', () => {
    const props = derefSpec(specOf('table', { rows: { collection: 'articles' } }), articlesCache());
    render(<TableWord {...props} />);

    // 列头 = 成员 fields 键并集 + 节点列(投影声明什么显示什么)
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('category')).toBeTruthy();
    expect(screen.getByText('节点')).toBeTruthy();
    // 每行:字段值 + 节点
    expect(screen.getByText('欢迎来到 UI4A')).toBeTruthy();
    expect(screen.getByText('tech')).toBeTruthy();
    expect(screen.getByText('第一篇')).toBeTruthy();
    expect(screen.getByText('essay')).toBeTruthy();
    expect(screen.getAllByText('published')).toHaveLength(2);
  });

  it('caption 字段引用 → 表标题直出(引用值,零字面)', () => {
    const cache = articlesCache();
    const collection = articlesCollection();
    cache.set('caption-source', {
      ...collection,
      properties: { ...collection.properties, name: '文章一览' },
    });
    const props = derefSpec(
      specOf('table', {
        rows: { collection: 'articles' },
        caption: { field: 'caption-source.name' },
      }),
      cache,
    );
    render(<TableWord {...props} />);
    expect(screen.getByText('文章一览')).toBeTruthy();
  });

  it('rows 非实体数组 → 响亮抛错(缺数据不造数据)', () => {
    expect(() => render(<TableWord rows="articles" />)).toThrow(/table 的 rows/);
  });
});
