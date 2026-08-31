import { describe, expect, it } from 'vitest';
import { deriveSitemap, project } from '@ui4a/engine';
import { seedGuardRegistry, type EngineSnapshot, type ThreadSnapshot } from '@ui4a/shared';

import {
  filterEntityForGrantedApplications,
  filterThreadEntityForPrincipal,
} from './application-scope';

function workline(id: string, owner: string, source: string, refs: string[]): ThreadSnapshot {
  return {
    id,
    owner,
    goal: { text: id === 'other' ? 'OTHER_OWNER_SECRET' : '发布公告', source },
    status: 'open',
    references: { context: refs, active: refs, approval: refs, event: [] },
    recentEventSeqs: [],
  };
}

const snapshot: EngineSnapshot = {
  instances: {
    'post:secret': {
      rel: 'post:secret',
      flow: 'secret',
      node: 'SECRET_STATUS',
      fields: { title: { value: 'SECRET_TITLE', origin: 'intent' } },
    },
    'post:public': {
      rel: 'post:public',
      flow: 'public',
      node: 'published',
      fields: { title: { value: '公开文章', origin: 'intent' } },
    },
  },
  collections: {},
  applications: {
    publishing: { name: 'publishing', title: '内容发布', intent: '发布文章' },
    editorial: { name: 'editorial', title: '编辑写作', intent: '私密编辑工作' },
  },
  definitions: Object.fromEntries(
    ['secret', 'public'].map((name) => [
      name,
      {
        name,
        version: 1,
        status: 'active' as const,
        definition: {
          name,
          app: name === 'secret' ? 'editorial' : 'publishing',
          title: name,
          initial: 'open',
          nodes: [{ name: 'open', title: 'Open', actions: [] }],
        },
      },
    ]),
  ),
  threads: {
    mine: workline('mine', 'me', 'post:secret', ['post:secret', 'post:public']),
    other: workline('other', 'someone-else', 'message:other', []),
  },
};
const sitemap = deriveSitemap([], {
  applications: snapshot.applications,
  extraSurfaces: [
    { rel: 'threads', title: '工作线', scope: 'principal', memberRelPrefix: 'thread:' },
  ],
});
const context = {
  snapshot,
  sitemap,
  plane: 'business' as const,
  grantedApplications: ['publishing'],
  principal: 'me',
};

describe('working context read authorization', () => {
  it('filters the application discovery root and its count using the same grants', () => {
    const entity = project(snapshot, 'applications', { flows: {}, guards: seedGuardRegistry });
    expect(entity).toBeDefined();
    if (entity === undefined) return;
    const filtered = filterEntityForGrantedApplications(entity, context);
    expect(filtered.properties.count).toBe(1);
    expect(filtered.entities?.map((member) => member.properties.name)).toEqual(['publishing']);
    expect(JSON.stringify(filtered)).not.toContain('私密编辑工作');
  });

  it.each(['thread:mine', 'threads'])(
    'filters real %s projection, including derived status and source',
    (rel) => {
      const entity = project(snapshot, rel, { flows: {}, guards: seedGuardRegistry })!;
      const original = JSON.stringify(entity);
      expect(original).toContain('SECRET_STATUS');
      const filtered = filterEntityForGrantedApplications(entity, context);
      for (const secret of ['post:secret', 'SECRET_STATUS', 'SECRET_TITLE', 'OTHER_OWNER_SECRET']) {
        expect(JSON.stringify(filtered)).not.toContain(secret);
      }
      expect(JSON.stringify(filtered)).toContain('公开文章');
      expect(JSON.stringify(entity)).toBe(original);
      if (rel === 'threads') expect(filtered.properties.count).toBe(1);
    },
  );

  it.each(['thread:other', 'thread:missing', 'other'])(
    'does not expose private or unresolved source %s',
    (source) => {
      const privateSnapshot = {
        ...snapshot,
        threads: {
          ...snapshot.threads,
          mine: workline('mine', 'me', source, ['thread:other', 'thread:missing']),
        },
      };
      const entity = project(privateSnapshot, 'thread:mine', {
        flows: {},
        guards: seedGuardRegistry,
      })!;
      const filtered = filterEntityForGrantedApplications(entity, {
        ...context,
        snapshot: privateSnapshot,
      });
      const json = JSON.stringify(filtered);
      expect(json).not.toContain('OTHER_OWNER_SECRET');
      expect(json).not.toContain('thread:other');
      expect(json).not.toContain('thread:missing');
      expect((filtered.properties.goal as Record<string, unknown>).source).toBeUndefined();
      expect(filtered.properties.context).toEqual([]);
      expect(filtered.properties.resume).toBeUndefined();
    },
  );

  it('keeps ownership filtering in local-demo reads without changing application grants', () => {
    const localSnapshot = {
      ...snapshot,
      threads: {
        ...snapshot.threads,
        mine: workline('mine', 'me', 'thread:other', ['thread:other', 'post:secret']),
      },
    };
    const entity = project(localSnapshot, 'threads', { flows: {}, guards: seedGuardRegistry })!;
    const filtered = filterThreadEntityForPrincipal(entity, localSnapshot, 'threads', 'me');
    expect(JSON.stringify(filtered)).not.toContain('OTHER_OWNER_SECRET');
    expect(JSON.stringify(filtered)).not.toContain('thread:other');
    expect(JSON.stringify(filtered)).toContain('SECRET_TITLE');
    expect(filtered.properties.count).toBe(1);
  });

  it('preserves readable source, resume and related facts', () => {
    const publicSnapshot = {
      ...snapshot,
      threads: {
        mine: workline('mine', 'me', 'post:public', ['post:public']),
      },
    };
    const entity = project(publicSnapshot, 'thread:mine', {
      flows: {},
      guards: seedGuardRegistry,
    })!;
    expect(
      filterEntityForGrantedApplications(entity, { ...context, snapshot: publicSnapshot }),
    ).toEqual(entity);
  });
});
