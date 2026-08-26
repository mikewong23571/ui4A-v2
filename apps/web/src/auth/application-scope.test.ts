import type { EngineSnapshot } from '@ui4a/shared';
import type { SirenEntity, Sitemap } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import {
  assertThreadOwner,
  assertRelInPolicyScope,
  filterEntityForPolicyScope,
  filterSitemapForPolicyScope,
  filterThreadEntityForPrincipal,
  relCoveredByPolicyScope,
} from './application-scope';

const snapshot = {
  instances: {
    'post:p1': { rel: 'post:p1', flow: 'post-status', node: 'published', fields: {} },
    'comment:c1': { rel: 'comment:c1', flow: 'comment-moderation', node: 'pending', fields: {} },
  },
  collections: {
    articles: ['post:p1'],
    comments: ['comment:c1'],
  },
  confirmations: {
    'confirmation:c1': {
      id: 'c1',
      targetRel: 'post:p1',
      targetAction: 'archive',
      proposedBy: { actor: 'agent' },
      status: 'pending',
    },
  },
  definitions: {
    'post-status': {
      name: 'post-status',
      version: 1,
      status: 'active',
      definition: { name: 'post-status', app: 'publishing' },
    },
    'comment-moderation': {
      name: 'comment-moderation',
      version: 1,
      status: 'active',
      definition: { name: 'comment-moderation', app: 'community' },
    },
  },
  activations: {
    'meta/activation:a1': {
      id: 'a1',
      flow: 'post-status',
      version: 2,
      artifact: 'sha256:fixture',
      status: 'pending-approval',
      checks: [],
      requestedBy: { actor: 'human' },
    },
  },
  applications: {
    publishing: { name: 'publishing', title: 'Publishing', intent: 'Publish' },
    community: { name: 'community', title: 'Community', intent: 'Moderate' },
  },
  threads: {
    mine: {
      id: 'mine',
      owner: 'user:mike',
      goal: { text: 'Mine', source: 'message:mine' },
      status: 'open',
      references: { context: [], active: [], approval: [], event: [] },
      recentEventSeqs: [],
    },
    theirs: {
      id: 'theirs',
      owner: 'user:other',
      goal: { text: 'Theirs', source: 'message:theirs' },
      status: 'open',
      references: { context: [], active: [], approval: [], event: [] },
      recentEventSeqs: [],
    },
  },
} as unknown as EngineSnapshot;

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

describe('application-owned policy scope authorization', () => {
  it('binds business instances, aliases, collections, and confirmations to their application', () => {
    for (const rel of ['post:p1', 'flow:post-status', 'articles', 'confirmation:c1']) {
      expect(() =>
        assertRelInPolicyScope({
          snapshot,
          sitemap,
          rel,
          policyScope: 'publishing',
          plane: 'business',
        }),
      ).not.toThrow();
    }
    for (const rel of ['comment:c1', 'flow:comment-moderation', 'comments']) {
      expect(() =>
        assertRelInPolicyScope({
          snapshot,
          sitemap,
          rel,
          policyScope: 'publishing',
          plane: 'business',
        }),
      ).toThrowError('scope_insufficient');
    }
  });

  it('binds Meta flow, activation, and application targets to the same application', () => {
    for (const rel of [
      'meta/flow:post-status',
      'meta/activation:a1',
      'meta/application:publishing',
    ]) {
      expect(() =>
        assertRelInPolicyScope({
          snapshot,
          sitemap,
          rel,
          policyScope: 'publishing',
          plane: 'meta',
        }),
      ).not.toThrow();
    }
    for (const rel of ['meta/flow:comment-moderation', 'meta/application:community']) {
      expect(() =>
        assertRelInPolicyScope({
          snapshot,
          sitemap,
          rel,
          policyScope: 'publishing',
          plane: 'meta',
        }),
      ).toThrowError('scope_insufficient');
    }
  });

  it('returns a policy-scoped sitemap and strips cross-application collection members', () => {
    const scoped = filterSitemapForPolicyScope(sitemap, 'publishing');
    expect(scoped.surfaces.map(({ rel }) => rel)).toEqual(['articles', 'threads']);
    expect(scoped.flows.map(({ name }) => name)).toEqual(['post-status']);
    expect(scoped.applications.map(({ name }) => name)).toEqual(['publishing']);
    expect(scoped.capabilities.map(({ name }) => name)).toEqual(['publish']);

    const collection: SirenEntity = {
      class: ['collection'],
      properties: { count: 2 },
      actions: [],
      links: [],
      entities: [
        {
          class: ['item'],
          href: '/api/entity?rel=post%3Ap1',
          properties: {},
          actions: [],
          links: [],
        },
        {
          class: ['item'],
          href: '/api/entity?rel=comment%3Ac1',
          properties: {},
          actions: [],
          links: [],
        },
      ],
    };
    const filtered = filterEntityForPolicyScope(collection, {
      snapshot,
      sitemap,
      policyScope: 'publishing',
      plane: 'business',
    });
    expect(filtered.entities?.map(({ href }) => href)).toEqual(['/api/entity?rel=post%3Ap1']);
    expect(filtered.properties.count).toBe(1);
  });

  it('treats threads as Application-neutral while enforcing trusted principal ownership', () => {
    for (const policyScope of ['publishing', 'community']) {
      expect(
        relCoveredByPolicyScope(
          { snapshot, sitemap, plane: 'business' },
          'thread:mine',
          policyScope,
        ),
      ).toBe(true);
      expect(() =>
        assertRelInPolicyScope({
          snapshot,
          sitemap,
          rel: 'threads',
          policyScope,
          plane: 'business',
        }),
      ).not.toThrow();
    }
    expect(() => assertThreadOwner(snapshot, 'thread:mine', 'user:mike')).not.toThrow();
    expect(() => assertThreadOwner(snapshot, 'thread:theirs', 'user:mike')).toThrowError(
      'scope_insufficient',
    );

    const collection: SirenEntity = {
      class: ['collection', 'threads'],
      properties: { rel: 'threads', count: 2 },
      actions: [],
      links: [],
      entities: Object.values(snapshot.threads!).map((thread) => ({
        class: ['work-thread', thread.status],
        properties: { id: thread.id, owner: thread.owner },
        actions: [],
        links: [],
      })),
    };
    const mine = filterThreadEntityForPrincipal(collection, snapshot, 'threads', 'user:mike');
    expect(mine.entities?.map((entity) => entity.properties.id)).toEqual(['mine']);
    expect(mine.properties.count).toBe(1);
  });

  it('derives exact-member scope from the surface prefix declaration instead of the rel spelling', () => {
    const applicationOwned: Sitemap = {
      ...sitemap,
      surfaces: [
        ...sitemap.surfaces.filter((surface) => surface.rel !== 'threads'),
        {
          rel: 'owned-work',
          title: 'Owned work',
          collection: true,
          scope: 'application',
          app: 'publishing',
          memberRelPrefix: 'thread:',
        },
      ],
    };
    expect(
      relCoveredByPolicyScope(
        { snapshot, sitemap: applicationOwned, plane: 'business' },
        'thread:mine',
        'community',
      ),
    ).toBe(false);
    expect(
      relCoveredByPolicyScope(
        { snapshot, sitemap: applicationOwned, plane: 'business' },
        'thread:mine',
        'publishing',
      ),
    ).toBe(true);
  });

  it('filters thread members and links through the current Application scope without dropping dangling refs', () => {
    const thread: SirenEntity = {
      class: ['work-thread', 'open'],
      properties: {
        context: ['articles', 'comments', 'meta/flows'],
        active: [
          { rel: 'post:p1', status: 'published', dangling: false },
          { rel: 'comment:c1', status: 'pending', dangling: false },
          { rel: 'external:missing', dangling: true },
        ],
        approval: [
          { rel: 'confirmation:c1', status: 'pending', dangling: false },
          { rel: 'meta/activation:a1', status: 'pending-approval', dangling: false },
        ],
      },
      actions: [],
      links: [
        { rel: ['self'], href: '/api/entity?rel=thread%3Amine' },
        { rel: ['context'], href: '/api/entity?rel=articles' },
        { rel: ['context'], href: '/api/entity?rel=comments' },
        { rel: ['context'], href: '/api/entity?rel=meta%2Fflows' },
        { rel: ['active'], href: '/api/entity?rel=post%3Ap1' },
        { rel: ['active'], href: '/api/entity?rel=comment%3Ac1' },
        { rel: ['active', 'dangling'], href: '/api/entity?rel=external%3Amissing' },
        { rel: ['approval'], href: '/api/entity?rel=confirmation%3Ac1' },
        { rel: ['approval'], href: '/api/entity?rel=meta%2Factivation%3Aa1' },
      ],
    };
    const filtered = filterEntityForPolicyScope(thread, {
      snapshot,
      sitemap,
      policyScope: 'publishing',
      plane: 'business',
    });
    expect(filtered.properties).toMatchObject({
      context: ['articles'],
      active: [
        { rel: 'post:p1', status: 'published', dangling: false },
        { rel: 'external:missing', dangling: true },
      ],
      approval: [{ rel: 'confirmation:c1', status: 'pending', dangling: false }],
    });
    expect(filtered.links.map((link) => link.href)).toEqual([
      '/api/entity?rel=thread%3Amine',
      '/api/entity?rel=articles',
      '/api/entity?rel=post%3Ap1',
      '/api/entity?rel=external%3Amissing',
      '/api/entity?rel=confirmation%3Ac1',
    ]);
  });
});
