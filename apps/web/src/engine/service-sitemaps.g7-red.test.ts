import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';

import { createSitemapReaders } from './service-sitemaps';

describe('T39 G7 Red: installed Application collection ownership', () => {
  it('keeps comments in community from its explicit comment-moderation declaration', () => {
    const commentModeration: FlowDefinition = {
      name: 'comment-moderation',
      title: '评论审核',
      app: 'community',
      initial: 'pending',
      collections: [{ collection: 'comments', filters: [{ field: 'status', title: '状态' }] }],
      nodes: [
        { name: 'pending', title: '待处理', actions: [] },
        { name: 'approved', title: '已通过', actions: [] },
      ],
    };
    const snapshot: EngineSnapshot = {
      instances: {},
      collections: { comments: [] },
      applications: {
        community: { name: 'community', title: '社区互动', intent: '评论与社区互动' },
      },
    };
    const readers = createSitemapReaders(
      () => snapshot,
      () => [commentModeration],
    );

    expect(readers.currentSitemap().surfaces.filter(({ rel }) => rel === 'comments')).toEqual([
      expect.objectContaining({
        rel: 'comments',
        title: '评论',
        collection: true,
        pageable: true,
        app: 'community',
      }),
    ]);
  });
});
