import type { Sitemap } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { filterSitemapForPolicyScope } from '../../../auth/application-scope';

import { filterSitemapForPolicyScopes } from './sitemap-scope-union';

// 多 policy scope 用户(如 granted=[publishing, community])的发现文档并集语义:
// - 并集 = 逐 scope 过滤后按稳定键去重(surfaces→rel、其余→name,先到先得);
// - 顺序确定 = granted 顺序;单 scope 时与单 scope 过滤完全一致(行为不变)。

const sitemap: Sitemap = {
  version: 'fixture',
  surfaces: [
    { rel: 'articles', title: 'Articles', collection: true, app: 'publishing' },
    { rel: 'comments', title: 'Comments', collection: true, app: 'community' },
    {
      rel: 'threads',
      title: 'Work Threads',
      collection: true,
      scope: 'principal',
      memberRelPrefix: 'thread:',
    },
  ],
  flows: [
    {
      name: 'post-status',
      title: 'Post',
      app: 'publishing',
      initial: 'published',
      nodes: [],
      edges: [],
    },
    {
      name: 'comment-moderation',
      title: 'Comment',
      app: 'community',
      initial: 'pending',
      nodes: [],
      edges: [],
    },
  ],
  applications: [
    { name: 'publishing', title: 'Publishing', intent: 'Publish', flows: [] },
    { name: 'community', title: 'Community', intent: 'Moderate', flows: [] },
  ],
  capabilities: [
    {
      name: 'publish',
      title: 'Publish',
      kind: 'effect',
      intent: 'publish',
      scope: { applications: ['publishing'], flows: ['post-status'] },
    },
    {
      name: 'moderate',
      title: 'Moderate',
      kind: 'effect',
      intent: 'moderate',
      scope: { applications: ['community'], flows: ['comment-moderation'] },
    },
  ],
};

describe('filterSitemapForPolicyScopes(granted 并集)', () => {
  it('merges per-scope filtered sitemaps into the granted union with stable keys', () => {
    const union = filterSitemapForPolicyScopes(sitemap, ['publishing', 'community']);
    expect(union.version).toBe('fixture:publishing+community');
    // 顺序 = granted 顺序逐 scope 拼接后去重;principal 面(threads)只保留一次。
    expect(union.surfaces.map(({ rel }) => rel)).toEqual(['articles', 'threads', 'comments']);
    expect(union.flows.map(({ name }) => name)).toEqual(['post-status', 'comment-moderation']);
    expect(union.applications.map(({ name }) => name)).toEqual(['publishing', 'community']);
    expect(union.capabilities.map(({ name }) => name)).toEqual(['publish', 'moderate']);
  });

  it('keeps a capability shared by several granted scopes once (first scope wins)', () => {
    const shared: Sitemap = {
      ...sitemap,
      capabilities: [
        ...sitemap.capabilities,
        {
          name: 'notify',
          title: 'Notify',
          kind: 'effect',
          intent: 'notify',
          scope: { applications: ['publishing', 'community'], flows: [] },
        },
      ],
    };
    const union = filterSitemapForPolicyScopes(shared, ['publishing', 'community']);
    expect(union.capabilities.map(({ name }) => name)).toEqual(['publish', 'notify', 'moderate']);
  });

  it('single-scope union equals the single-scope filter (behavior unchanged)', () => {
    expect(filterSitemapForPolicyScopes(sitemap, ['publishing'])).toEqual(
      filterSitemapForPolicyScope(sitemap, 'publishing'),
    );
  });

  it('union order follows granted order deterministically', () => {
    const reversed = filterSitemapForPolicyScopes(sitemap, ['community', 'publishing']);
    expect(reversed.version).toBe('fixture:community+publishing');
    // 每个 scope 的过滤结果都含 principal 面(threads);去重保留 granted 顺序中的
    // 首次出现,故 community 部分内 comments→threads 先于 publishing 的 articles。
    expect(reversed.surfaces.map(({ rel }) => rel)).toEqual(['comments', 'threads', 'articles']);
    expect(reversed.capabilities.map(({ name }) => name)).toEqual(['moderate', 'publish']);
  });
});
