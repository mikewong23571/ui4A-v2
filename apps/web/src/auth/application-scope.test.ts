import type { EngineSnapshot } from '@ui4a/shared';
import type { SirenEntity, Sitemap } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import {
  assertRelInPolicyScope,
  filterEntityForPolicyScope,
  filterSitemapForPolicyScope,
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
} as unknown as EngineSnapshot;

const sitemap: Sitemap = {
  version: 'fixture',
  surfaces: [
    { rel: 'articles', title: 'Articles', collection: true, app: 'publishing' },
    { rel: 'comments', title: 'Comments', collection: true, app: 'community' },
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
    expect(scoped.surfaces.map(({ rel }) => rel)).toEqual(['articles']);
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
});
