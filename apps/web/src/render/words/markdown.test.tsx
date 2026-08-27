// @vitest-environment jsdom
/**
 * markdown 词条组件测试(T7 Phase B):给 deref 输出(实体,正文来自字段
 * 引用)→ react-markdown 渲染:标题/加粗等结构来自实体数据(正文零 AI)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { derefSpec } from '../deref';

import { markdownEntity, specOf } from './fixtures';
import { MarkdownWord } from './markdown';

afterEach(cleanup);

describe('markdown 词条', () => {
  it('deref 输出 → 正文结构渲染(h1/strong 来自实体字段)', () => {
    const cache = new Map([
      ['post:post-welcome', markdownEntity('# 欢迎来到 UI4A\n\n**界面即合同**的演示正文。')],
    ]);
    const props = derefSpec(
      specOf('markdown', { entity: { ref: 'entity:post:post-welcome' } }),
      cache,
    );
    const { container } = render(<MarkdownWord {...props} />);

    expect(container.querySelector('[data-word="markdown"] h1')?.textContent).toBe('欢迎来到 UI4A');
    expect(screen.getByText('界面即合同').tagName).toBe('STRONG');
  });

  it('entity 缺正文字段(body/content)→ 响亮抛错(缺内容不造内容)', () => {
    expect(() =>
      render(
        <MarkdownWord
          entity={{ class: [], properties: { rel: 'x', fields: {} }, actions: [], links: [] }}
        />,
      ),
    ).toThrow(/markdown 的 entity/);
  });
});
