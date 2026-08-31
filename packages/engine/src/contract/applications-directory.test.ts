import { describe, expect, it } from 'vitest';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';

import { seedSnapshot } from '../core/fixtures';
import { project } from './siren';
import { deriveSitemap } from './sitemap';

const snapshot: EngineSnapshot = {
  ...seedSnapshot,
  applications: {
    default: {
      name: 'default', title: '默认应用', intent: '系统地板',
      cognitive: { version: 1, traits: ['system-fallback'] },
    },
    publishing: { name: 'publishing', title: '内容发布', intent: '发布文章' },
    community: { name: 'community', title: '社区互动', intent: '审核评论' },
  },
};
const deps = { flows: {}, guards: seedGuardRegistry };

describe('authorized application discovery root', () => {
  it('projects a read-only directory from active definitions without a default application', () => {
    const before = structuredClone(snapshot);
    const entity = project(snapshot, 'applications', deps);
    expect(entity).toMatchObject({
      class: ['collection', 'applications'],
      properties: { rel: 'applications', title: '应用', count: 2 },
      actions: [],
      entities: [
        { properties: { name: 'publishing', title: '内容发布', intent: '发布文章' }, href: '/api/entity?rel=application:publishing' },
        { properties: { name: 'community', title: '社区互动', intent: '审核评论' }, href: '/api/entity?rel=application:community' },
      ],
    });
    expect(snapshot).toEqual(before);
    expect(JSON.stringify(entity)).not.toContain('meta/');
  });

  it('makes the neutral root discoverable, including empty installations', () => {
    const sitemap = deriveSitemap([], { applications: snapshot.applications });
    expect(sitemap.surfaces).toContainEqual({
      rel: 'applications', title: '应用', collection: true, scope: 'principal',
    });
    expect(project({ ...seedSnapshot, applications: {} }, 'applications', deps))
      .toMatchObject({ properties: { count: 0 }, entities: [], actions: [] });
  });
});
