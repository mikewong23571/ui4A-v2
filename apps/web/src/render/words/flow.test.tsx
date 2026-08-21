// @vitest-environment jsdom
/**
 * flow 词条组件测试(T7 Phase B):给 deref 输出(拓扑实体)→ React Flow
 * 图:节点标签与边拓扑来自实体数据(节点位置确定性分层,重放一致)。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { stubBrowserApis } from '@/test/browser-stubs';

import { derefSpec } from '../deref';

import { graphEntity, specOf } from './fixtures';
import { FlowWord, layeredLayout } from './flow';

// React Flow 在浏览器依赖 ResizeObserver/DOMMatrixReadOnly——jsdom 缺失,
// 统一注入极简 stub(零测量;布局断言走纯函数 layeredLayout)。
stubBrowserApis();

afterEach(cleanup);

describe('flow 词条', () => {
  it('deref 输出 → 拓扑图:节点标签可见(节点/边来自实体数据)', () => {
    const cache = new Map([['sitemap:main', graphEntity()]]);
    const props = derefSpec(specOf('flow', { graph: { ref: 'entity:sitemap:main' } }), cache);
    const { container } = render(<FlowWord {...props} />);

    const flow = container.querySelector('[data-word="flow"]');
    expect(flow).not.toBeNull();
    const text = flow?.textContent ?? '';
    expect(text).toContain('首页');
    expect(text).toContain('文章');
    expect(text).toContain('文章详情');
    expect(text).toContain('收件箱');
  });

  it('确定性分层布局:同输入同位置(BFS 深度 × 层内序)', () => {
    const graph = graphEntity();
    const layout = layeredLayout(graph);
    expect(layout.get('home')).toEqual({ x: 0, y: 0 });
    // articles/inbox 深度 1,按节点声明序分层
    expect(layout.get('articles')).toEqual({ x: 220, y: 0 });
    expect(layout.get('inbox')).toEqual({ x: 220, y: 96 });
    expect(layout.get('article')).toEqual({ x: 440, y: 0 });
    // 稳定性:重复计算结果一致
    expect(layeredLayout(graph)).toEqual(layout);
  });

  it('graph 实体缺 nodes/edges → 响亮抛错', () => {
    expect(() =>
      render(<FlowWord graph={{ class: [], properties: { rel: 'x' }, actions: [], links: [] }} />),
    ).toThrow(/flow 的 graph/);
  });
});
