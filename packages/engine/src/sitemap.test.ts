import { describe, expect, it } from 'vitest';

import {
  articleDraftingFlow,
  commentModerationFlow,
  postStatusFlow,
} from './fixtures';
import { deriveSitemap } from './sitemap';
import type { FlowDefinition } from './types';

const flows = [articleDraftingFlow, postStatusFlow, commentModerationFlow];

describe('deriveSitemap — 结构', () => {
  it('flows 拓扑:节点(名称/标题)与边(from/action/to)完整', () => {
    const sitemap = deriveSitemap(flows);
    const postStatus = sitemap.flows.find((flow) => flow.name === 'post-status');
    expect(postStatus).toMatchObject({ name: 'post-status', title: '文章状态', initial: 'published' });
    expect(postStatus?.nodes.map((node) => `${node.name}:${node.title}`)).toEqual([
      'published:已发布',
      'offline:已下线',
      'archived:已归档',
    ]);
    expect(postStatus?.edges).toEqual([
      { from: 'published', action: 'unpublish', to: 'offline' },
      { from: 'published', action: 'archive', to: 'archived' },
    ]);
  });

  it('节点 action 摘要:name/title/method/to/guards/fields schema', () => {
    const sitemap = deriveSitemap(flows);
    const classification = sitemap.flows
      .find((flow) => flow.name === 'article-drafting')
      ?.nodes.find((node) => node.name === 'classification');
    expect(classification?.actions[0]).toMatchObject({
      name: 'next',
      title: '下一步',
      method: 'POST',
      to: 'content',
      guards: [],
    });
    expect(classification?.actions[0].fields).toMatchObject({
      type: 'object',
      required: ['category'],
    });
    const approve = sitemap.flows
      .find((flow) => flow.name === 'comment-moderation')
      ?.nodes[0].actions.find((action) => action.name === 'approve');
    expect(approve?.guards).toEqual(['is-pending']);
  });

  it('requires-confirmation 进 action 摘要(策略标注可被发现)', () => {
    const sitemap = deriveSitemap(flows);
    const archive = sitemap.flows
      .find((flow) => flow.name === 'post-status')
      ?.nodes[0].actions.find((action) => action.name === 'archive');
    expect(archive?.['requires-confirmation']).toBe('high');
  });

  it('surfaces 界面清单:flow 定义实体 + append 目标集合(去重)', () => {
    const sitemap = deriveSitemap(flows);
    expect(sitemap.surfaces).toEqual(
      expect.arrayContaining([
        { rel: 'flow:article-drafting', title: '文章发布向导' },
        { rel: 'flow:post-status', title: '文章状态' },
        { rel: 'articles', title: 'articles', collection: true },
      ]),
    );
    const articlesSurfaces = sitemap.surfaces.filter((s) => s.rel === 'articles');
    expect(articlesSurfaces).toHaveLength(1);
  });

  it('extraSurfaces 附加额外资源面(种子域的 comments 集合无 append 来源)', () => {
    const sitemap = deriveSitemap(flows, {
      extraSurfaces: [{ rel: 'comments', title: '评论队列', collection: true }],
    });
    expect(sitemap.surfaces).toEqual(
      expect.arrayContaining([{ rel: 'comments', title: '评论队列', collection: true }]),
    );
  });

  it('generatedAt 透传可选;缺省不出现', () => {
    expect(deriveSitemap(flows).generatedAt).toBeUndefined();
    expect(deriveSitemap(flows, { generatedAt: '2026-08-21T00:00:00Z' }).generatedAt).toBe(
      '2026-08-21T00:00:00Z',
    );
  });
});

describe('deriveSitemap — 版本号(内容 hash 短码,缓存键)', () => {
  it('同内容同版本(深拷贝等价)', () => {
    const a = deriveSitemap(flows);
    const b = deriveSitemap(JSON.parse(JSON.stringify(flows)));
    expect(b.version).toBe(a.version);
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('键序无关(canonical JSON 排序):同内容不同插入序同版本;数组序是内容', () => {
    const reordered: FlowDefinition = {
      initial: 'published',
      name: 'post-status',
      nodes: [
        {
          actions: [
            { title: '下线', to: 'offline', name: 'unpublish' },
            { to: 'archived', title: '归档', name: 'archive', 'requires-confirmation': 'high' },
          ],
          name: 'published',
          title: '已发布',
        },
        { actions: [], name: 'offline', title: '已下线' },
        { actions: [], name: 'archived', title: '已归档' },
      ],
      title: '文章状态',
    };
    const a = deriveSitemap([postStatusFlow]);
    const b = deriveSitemap([reordered]);
    expect(b.version).toBe(a.version);

    const swappedActions = JSON.parse(JSON.stringify(postStatusFlow));
    swappedActions.nodes[0].actions.reverse();
    expect(deriveSitemap([swappedActions]).version).not.toBe(a.version);
  });

  it('内容变化 → 版本变化', () => {
    const a = deriveSitemap(flows);
    const mutated = JSON.parse(JSON.stringify(flows));
    mutated[1].nodes[0].actions[0].title = '下线(已改)';
    const b = deriveSitemap(mutated);
    expect(b.version).not.toBe(a.version);
  });

  it('surfaces 变化 → 版本变化(缓存键覆盖界面清单)', () => {
    const a = deriveSitemap(flows);
    const b = deriveSitemap(flows, {
      extraSurfaces: [{ rel: 'comments', title: '评论队列', collection: true }],
    });
    expect(b.version).not.toBe(a.version);
  });
});
