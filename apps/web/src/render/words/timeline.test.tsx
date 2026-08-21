// @vitest-environment jsdom
/**
 * timeline 词条组件测试(T7 Phase B):给 deref 输出(集合成员,append 序即
 * 时间序)→ react-chrono 时间线:每个成员一条目,摘要来自实体投影(零 AI)。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubBrowserApis } from '@/test/browser-stubs';

import { derefSpec } from '../deref';

import { articlesCache, eventMember, specOf } from './fixtures';
import { TimelineWord } from './timeline';

// react-chrono 在浏览器依赖 matchMedia/IntersectionObserver/ResizeObserver
// ——jsdom 缺失,统一注入极简 stub(test/browser-stubs)。
stubBrowserApis();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stubBrowserApis();
});

describe('timeline 词条', () => {
  it('deref 输出 → 时间线:每个成员一条目(seq 为标题,摘要来自投影)', () => {
    const cache = articlesCache();
    cache.set('events', {
      class: ['collection', 'events'],
      properties: { rel: 'events', count: 3 },
      actions: [],
      links: [],
      entities: [
        eventMember(1, 'seed', 'seed:business-domain'),
        eventMember(2, 'action-executed', 'post:post-welcome', 'unpublish'),
        eventMember(3, 'confirmation-approved', 'confirmation:c1', 'approve'),
      ],
    });
    const props = derefSpec(specOf('timeline', { events: { collection: 'events' } }), cache);
    const { container } = render(<TimelineWord {...props} />);

    const timeline = container.querySelector('[data-word="timeline"]')!;
    expect(timeline).not.toBeNull();
    const text = timeline.textContent ?? '';
    // 条目标题:成员 seq(append 序即时间序)
    expect(text).toContain('1');
    expect(text).toContain('2');
    expect(text).toContain('3');
    // 成员摘要(投影字段直出,零 AI)
    expect(text).toContain('action-executed');
    expect(text).toContain('post:post-welcome');
    expect(text).toContain('confirmation:c1');
  });

  it('caption 字段引用 → 时间线标题直出', () => {
    const cache = articlesCache();
    const articles = articlesCache().get('articles')!;
    cache.set('caption-source', { ...articles, properties: { ...articles.properties, name: '最近事件' } });
    const props = derefSpec(
      specOf('timeline', {
        events: { collection: 'articles' },
        caption: { field: 'caption-source.name' },
      }),
      cache,
    );
    const { container } = render(<TimelineWord {...props} />);
    expect(container.querySelector('[data-word="timeline"]')?.textContent).toContain('最近事件');
  });

  it('events 非实体数组 → 响亮抛错', () => {
    expect(() => render(<TimelineWord events={42} />)).toThrow(/timeline 的 events/);
  });
});
