// @vitest-environment jsdom
/**
 * detail 词条组件测试(T7 Phase B):给 deref 输出(实体引用)→ 详情卡:
 * properties/actions/links 四件组装直出;动作走 ActionRunner(data-action)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { derefSpec } from '../deref';

import { articlesCollection, specOf } from './fixtures';
import { DetailWord } from './detail';

afterEach(cleanup);

function detailEntity(): ReturnType<typeof articlesCollection> {
  return {
    class: ['flow-instance', 'post-status'],
    properties: {
      rel: 'post:post-welcome',
      node: 'published',
      title: '已发布',
      fields: { title: '欢迎来到 UI4A', category: 'tech' },
    },
    actions: [{ name: 'unpublish', title: '下线', method: 'POST', href: '/api/exec', fields: { type: 'object', properties: {} } }],
    links: [{ rel: ['collection'], href: '/api/entity?rel=articles' }],
    'guard-results': [],
  };
}

describe('detail 词条', () => {
  it('deref 输出 → 详情卡:属性/字段/链接/动作直出', async () => {
    const cache = new Map([['post:post-welcome', detailEntity()]]);
    const props = derefSpec(
      specOf('detail', { entity: { ref: 'entity:post:post-welcome' } }),
      cache,
    );
    const { container } = render(<DetailWord {...props} />);

    const view = container.querySelector('[data-word="detail"]');
    expect(view).not.toBeNull();
    // properties 直出(rel/node + 扁平 fields 行)
    expect(screen.getByText('post:post-welcome')).toBeTruthy();
    expect(screen.getByText('published')).toBeTruthy();
    expect(screen.getByText(/欢迎来到 UI4A/)).toBeTruthy();
    // 链接(合同 href → 页面路由)
    expect(screen.getByText('articles')).toBeTruthy();
    // 动作(ActionRunner,data-action 标注)
    expect(await screen.findByRole('button', { name: '下线' })).toBeTruthy();
    expect(container.querySelector('[data-action="unpublish"]')).not.toBeNull();
  });

  it('entity 非实体 → 响亮抛错', () => {
    expect(() => render(<DetailWord entity="post:post-welcome" />)).toThrow(
      /detail 的 entity/,
    );
  });
});
