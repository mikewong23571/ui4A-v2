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

// post:first-post 归属 publishing Application;threads 无归属(未知 rel,
// fail-open 交既有三段裁决兜底)。D51 受众谓词:唯一输入 = 凭证授予应用集合
// × 事实归属。
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

describe('getAuthorizedPresentationEntity audience predicate (D51)', () => {
  it('returns the entity when its owning application is granted', async () => {
    const entity = await getAuthorizedPresentationEntity('post:first-post', 'human-alice', [
      'default',
      'publishing',
    ]);
    expect(entity?.properties.title).toBe('first');
  });

  it('returns undefined when no granted application matches the owning application', async () => {
    await expect(
      getAuthorizedPresentationEntity('post:first-post', 'human-alice', ['default', 'development']),
    ).resolves.toBeUndefined();
  });

  it('filters cross-application references by the granted set instead of one frozen scope', async () => {
    const granted = await getAuthorizedPresentationEntity('threads', 'human-alice', ['publishing']);
    // publishing 在授予集合内:跨应用 related 链接保留。
    expect(granted?.links.map((link) => link.href)).toEqual([
      '/api/entity?rel=threads',
      '/api/entity?rel=post:first-post',
    ]);

    const ungranted = await getAuthorizedPresentationEntity('threads', 'human-alice', [
      'development',
    ]);
    // threads 本身无归属(fail-open 可读);越界引用按受众过滤剥离。
    expect(ungranted?.links.map((link) => link.href)).toEqual(['/api/entity?rel=threads']);
  });

  it('keeps the local-demo trust domain bypass with only ownership rechecks', async () => {
    // local-demo 标记不做受众过滤(等价旧本地分支),posting rel 未授予仍可见;
    // thread 属主重审照常(snapshot 无 threads 记录时不拦截)。
    const entity = await getAuthorizedPresentationEntity('post:first-post', 'user:local', [
      'local-demo',
    ]);
    expect(entity?.properties.title).toBe('first');
    expect(entity?.links).toHaveLength(1);
  });
});
