import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { planGenericPresentationSurface } from './generic';

const post: SirenEntity = {
  class: ['flow-instance'],
  properties: {
    rel: 'post:first-post',
    node: 'published',
    title: '已发布',
    identity: '第一篇',
    status: 'published',
    fields: { title: '第一篇', body: '完整正文', category: 'essay' },
    presentation: {
      fields: [
        { path: 'properties.fields.title', title: '文章标题', role: 'identity' },
        { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
        { path: 'properties.fields.category', title: '分类', role: 'metadata' },
      ],
    },
  },
  actions: [],
  links: [],
};

describe('generic Presentation runtime plan', () => {
  it('hydrates identity/body/status/metadata while keeping facts out of A2UI components', () => {
    const plan = planGenericPresentationSurface('post:first-post', post, 'definition-v1');
    const components = JSON.stringify(plan.bundle.messages[2]);
    const data = JSON.stringify(plan.bundle.messages[1]);

    expect(plan.bundle.issues).toEqual([]);
    expect(components).not.toContain('完整正文');
    expect(components).not.toContain('第一篇');
    expect(data).toContain('完整正文');
    expect(data).toContain('第一篇');
    expect(data).toContain('published');
    expect(data).toContain('essay');
    expect(data).not.toContain('已发布');
  });

  it('binds a Flow alias request to the canonical entity rel returned by Siren', () => {
    const flow = {
      ...post,
      properties: { ...post.properties, rel: 'article-drafting:main' },
    };
    const plan = planGenericPresentationSurface('flow:article-drafting', flow, 'definition-v1');
    expect(plan.bundle.issues).toEqual([]);
    expect(JSON.stringify(plan.surface)).toContain('article-drafting:main');
    expect(JSON.stringify(plan.surface)).not.toContain('$slot');
  });
});
