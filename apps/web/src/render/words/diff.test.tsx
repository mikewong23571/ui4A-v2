// @vitest-environment jsdom
/**
 * diff 词条组件测试(T7 Phase B):给 deref 输出(diff 实体引用)→ 复用
 * 内建机械 diff 渲染(react-diff-view):-/+ 行来自 before/after 全文,
 * 渲染路径零 AI(铁律 5)。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { derefSpec } from '../deref';

import { diffEntity, specOf } from './fixtures';
import { DiffWord } from './diff';

afterEach(cleanup);

describe('diff 词条', () => {
  it('deref 输出 → 机械 diff:- 旧值 / + 新值(路径取回,零 AI)', () => {
    const cache = new Map([['activation:a1', diffEntity()]]);
    const props = derefSpec(specOf('diff', { entity: { ref: 'entity:activation:a1' } }), cache);
    const { container } = render(<DiffWord {...props} />);

    const view = container.querySelector('[data-word="diff"]');
    expect(view).not.toBeNull();
    const text = view?.textContent ?? '';
    expect(text).toContain('old-flow');
    expect(text).toContain('new-flow');
    expect(text).toContain('draft');
    expect(text).toContain('ready');
    // react-diff-view 的删除/新增行标记
    expect(view?.querySelectorAll('.diff-code-delete').length).toBeGreaterThan(0);
    expect(view?.querySelectorAll('.diff-code-insert').length).toBeGreaterThan(0);
  });

  it('entity 缺 diff 载荷 → 响亮抛错', () => {
    expect(() =>
      render(<DiffWord entity={{ class: [], properties: { rel: 'x' }, actions: [], links: [] }} />),
    ).toThrow(/diff 的 entity/);
  });
});
