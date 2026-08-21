// @vitest-environment jsdom
/**
 * stat 词条组件测试(T9 Phase D):给 deref 输出(字段引用标量)→ shadcn
 * Card 统计卡:value 数值与实体字段逐项相等(主页态势投影的对拍锚点)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { derefSpec } from '../deref';

import { articlesCollection, specOf } from './fixtures';
import { StatWord } from './stat';

afterEach(cleanup);

function statCache(): Map<string, SirenEntity> {
  const articles = articlesCollection();
  return new Map([
    ['articles', articles],
    [
      'metrics',
      {
        class: ['metrics'],
        properties: { rel: 'metrics', pending: 2, label: '待确认' },
        actions: [],
        links: [],
      },
    ],
  ]);
}

describe('stat 词条', () => {
  it('deref 输出 → 统计卡:数值与实体字段一致(label 同源)', () => {
    const props = derefSpec(
      specOf('stat', {
        value: { field: 'metrics.pending' },
        label: { field: 'metrics.label' },
      }),
      statCache(),
    );
    render(<StatWord {...props} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('待确认')).toBeTruthy();
  });

  it('value 支持字符串标量(集合 count 等投影值)', () => {
    const props = derefSpec(specOf('stat', { value: { field: 'articles.count' } }), statCache());
    render(<StatWord {...props} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('value 非标量 → 响亮抛错', () => {
    expect(() => render(<StatWord value={{ nested: true }} />)).toThrow(/stat 的 value/);
  });
});
