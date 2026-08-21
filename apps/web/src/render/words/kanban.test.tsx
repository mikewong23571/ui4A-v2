// @vitest-environment jsdom
/**
 * kanban 词条组件测试(T7 Phase B):给 deref 输出(集合成员)→ dnd-kit
 * 看板:成员按节点分列(词条内部投影),卡片摘要来自实体投影;
 * 拖拽是本地视图重组,不触发任何 exec(可提交元素只来自已声明 action)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { derefSpec } from '../deref';

import { articlesCollection, specOf } from './fixtures';
import { KanbanWord } from './kanban';

afterEach(cleanup);

function moderationCollection(): SirenEntity {
  const member = (rel: string, node: string, body: string): SirenEntity => ({
    class: ['flow-instance', 'comment-moderation'],
    rel: ['item'],
    properties: { rel, node, title: node, fields: { body } },
    actions: [],
    links: [],
  });
  return {
    class: ['collection', 'comments'],
    properties: { rel: 'comments', count: 4 },
    actions: [],
    links: [],
    entities: [
      member('comment:c1', 'pending', '好文章'),
      member('comment:c2', 'pending', '学习了'),
      member('comment:c4', 'approved', '赞'),
    ],
  };
}

describe('kanban 词条', () => {
  it('deref 输出 → 看板:成员按节点分列,卡片摘要来自投影', () => {
    const cache = new Map([['comments', moderationCollection()]]);
    const props = derefSpec(specOf('kanban', { columns: { collection: 'comments' } }), cache);
    const { container } = render(<KanbanWord {...props} />);

    const board = container.querySelector('[data-word="kanban"]');
    expect(board).not.toBeNull();
    // 列 = 成员节点值的首次出现序(列头带计数)
    expect(board?.querySelector('[data-column="pending"]')).not.toBeNull();
    expect(board?.querySelector('[data-column="approved"]')).not.toBeNull();
    // 卡片:成员摘要直出(字段值 + 节点)
    expect(screen.getByText(/好文章/)).toBeTruthy();
    expect(screen.getByText(/学习了/)).toBeTruthy();
    expect(screen.getByText(/赞/)).toBeTruthy();
  });

  it('看板零可提交元素(卡片拖拽是本地视图,不经 /api/exec)', () => {
    const cache = new Map([['comments', moderationCollection()]]);
    const props = derefSpec(specOf('kanban', { columns: { collection: 'comments' } }), cache);
    const { container } = render(<KanbanWord {...props} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('form')).toHaveLength(0);
  });

  it('columns 非实体数组 → 响亮抛错', () => {
    expect(() => render(<KanbanWord columns={articlesCollection()} />)).toThrow(
      /kanban 的 columns/,
    );
  });
});
