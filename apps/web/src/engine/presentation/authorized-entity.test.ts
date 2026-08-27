import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

const service = vi.hoisted(() => ({
  getEntity: vi.fn(),
  readSnapshot: vi.fn(),
  getSitemap: vi.fn(),
}));

vi.mock('../service', () => ({
  getDb: () => ({ kind: 'test-db' }),
  getEngine: async () => ({
    readSnapshot: service.readSnapshot,
    getSitemap: service.getSitemap,
    getEntity: service.getEntity,
  }),
}));

import { getAuthorizedPresentationEntity } from './authorized-entity';

// post:first-post 归属 publishing Application;threads 是未知 rel,视为被任意
// scope 覆盖,用于观测 granted 数组顺序对覆盖选择的确定性影响。
const SNAPSHOT = {
  instances: { 'post:first-post': { flow: 'post' } },
  definitions: { post: { version: 1, definition: { app: 'publishing' } } },
};
const SITEMAP = { version: 'v', surfaces: [], flows: [], applications: [], capabilities: [] };

function postEntity(): SirenEntity {
  return {
    class: ['post'],
    properties: { title: 'first' },
    links: [{ rel: ['self'], href: '/api/entity?rel=post:first-post' }],
  } as unknown as SirenEntity;
}

function threadsEntity(): SirenEntity {
  return {
    class: ['threads'],
    properties: {},
    links: [
      { rel: ['self'], href: '/api/entity?rel=threads' },
      { rel: ['related'], href: '/api/entity?rel=post:first-post' },
    ],
  } as unknown as SirenEntity;
}

beforeEach(() => {
  service.readSnapshot.mockReset();
  service.readSnapshot.mockResolvedValue(SNAPSHOT);
  service.getSitemap.mockReset();
  service.getSitemap.mockReturnValue(SITEMAP);
  service.getEntity.mockReset();
  service.getEntity.mockImplementation(async (rel: string) =>
    rel === 'post:first-post' ? postEntity() : rel === 'threads' ? threadsEntity() : undefined,
  );
});

describe('getAuthorizedPresentationEntity granted scope coverage selection', () => {
  it('selects the covering granted scope when the frozen scope does not cover the rel', async () => {
    const entity = await getAuthorizedPresentationEntity(
      'post:first-post',
      'human-alice',
      'default',
      ['default', 'publishing'],
    );
    expect(entity?.properties.title).toBe('first');
    // 对照:未传 granted 集合时单一冻结 scope default 不覆盖 publishing rel。
    await expect(
      getAuthorizedPresentationEntity('post:first-post', 'human-alice', 'default'),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when no granted scope covers the rel', async () => {
    await expect(
      getAuthorizedPresentationEntity('post:first-post', 'human-alice', 'default', [
        'default',
        'development',
      ]),
    ).resolves.toBeUndefined();
  });

  it('picks the first covering scope deterministically by granted order', async () => {
    // threads 被任意 scope 覆盖;selected scope 由 granted 顺序决定,并经
    // filterEntityForPolicyScope 可见性过滤可观测(publishing 链接只在
    // publishing scope 下保留)。
    const defaultFirst = await getAuthorizedPresentationEntity(
      'threads',
      'human-alice',
      'default',
      ['default', 'publishing'],
    );
    expect(defaultFirst?.links.map((link) => link.href)).toEqual(['/api/entity?rel=threads']);

    const publishingFirst = await getAuthorizedPresentationEntity(
      'threads',
      'human-alice',
      'default',
      ['publishing', 'default'],
    );
    expect(publishingFirst?.links.map((link) => link.href)).toEqual([
      '/api/entity?rel=threads',
      '/api/entity?rel=post:first-post',
    ]);
  });

  it('keeps local-demo behavior unchanged when granted scopes are present', async () => {
    const entity = await getAuthorizedPresentationEntity('threads', 'user:local', 'local-demo', [
      'local-demo',
    ]);
    // local-demo 不做 scope 过滤,跨 Application 链接原样保留。
    expect(entity?.links).toHaveLength(2);
  });
});
