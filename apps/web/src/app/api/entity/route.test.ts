import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { GET } from './route';

// /api/entity 契约测试(spec FR3 / DoD):
// - 已知 rel → 200 Siren 四件组装(properties/actions/links/guard-results);
// - 集合实体带 entities[] 子实体与直达 href(B2 的导航原料);
// - 未知 rel → 404;缺 rel → 400;db 不可达 → 503。
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const BAD_URL = 'postgres://ui4a:ui4a@localhost:5999/ui4a';
const pool = getPool(REAL_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

function request(query = ''): Request {
  return new Request(`http://localhost:3100/api/entity${query}`);
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('GET /api/entity', () => {
  it('articles 集合:200,count=2,entities 含 post:post-welcome 且可直达', async () => {
    const res = await GET(request('?rel=articles'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      class: string[];
      properties: { rel: string; count: number };
      entities: { rel: string[]; href: string; properties: { rel: string } }[];
      links: { rel: string[]; href: string }[];
    };
    expect(entity.class).toEqual(['collection', 'articles']);
    expect(entity.properties).toEqual({ rel: 'articles', count: 2 });
    expect(entity.entities.map((sub) => sub.properties.rel)).toEqual([
      'post:post-welcome',
      'post:first-post',
    ]);
    // 子实体直达链接:rel 值可作 ?rel= 直接取(B2 点名导航的合同)。
    expect(entity.entities[0]?.href).toBe('/api/entity?rel=post:post-welcome');
    expect(entity.entities[0]?.rel).toEqual(['item']);
    expect(entity.links).toEqual([{ rel: ['self'], href: '/api/entity?rel=articles' }]);
  });

  it('post:post-welcome:200,actions 含 unpublish/archive,guard-results 逐项注入', async () => {
    const res = await GET(request('?rel=post:post-welcome'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      properties: { rel: string; flow: string; node: string; title: string };
      actions: { name: string; href: string }[];
      'guard-results': { action: string; blocked: boolean; guards: { name: string; pass: boolean }[] }[];
    };
    expect(entity.properties).toMatchObject({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
      title: '已发布',
    });
    expect(entity.actions.map((action) => action.name)).toEqual(['unpublish', 'archive']);
    expect(entity.actions.every((action) => action.href === '/api/exec')).toBe(true);
    const unpublish = entity['guard-results']?.find((entry) => entry.action === 'unpublish');
    expect(unpublish).toMatchObject({ blocked: false, guards: [{ name: 'is-published', pass: true }] });
    const archive = entity['guard-results']?.find((entry) => entry.action === 'archive');
    expect(archive?.guards).toEqual([{ name: 'is-published', pass: true }]);
  });

  it('向导实例:200,节点 basic-info,actions 含 next(fields 即节点 schema)', async () => {
    const res = await GET(request('?rel=article-drafting:main'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      properties: { node: string };
      actions: { name: string; fields: { required: string[]; properties: Record<string, unknown> } }[];
    };
    expect(entity.properties.node).toBe('basic-info');
    expect(entity.actions).toHaveLength(1);
    expect(entity.actions[0]?.name).toBe('next');
    expect(entity.actions[0]?.fields.required).toEqual(['title']);
    expect(entity.actions[0]?.fields.properties).toHaveProperty('title');
  });

  it('未知 rel → 404 结构化错误', async () => {
    const res = await GET(request('?rel=nope'));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('nope');
  });

  it('缺 rel 参数 → 400', async () => {
    const res = await GET(request());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('rel');
  });

  it('db 不可达 → 503 JSON,不抛 500', async () => {
    process.env.DATABASE_URL = BAD_URL;
    try {
      const res = await GET(request('?rel=articles'));
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toHaveProperty('error');
    } finally {
      if (REAL_DATABASE_URL === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = REAL_DATABASE_URL;
      }
      resetEngineForTests();
    }
  });
});
