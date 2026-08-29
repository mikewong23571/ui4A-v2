import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
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
    // Phase E 合同补全:集合 links 除 self 外携带 flow 入口链接(向导可达)。
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles' },
      { rel: ['flow'], href: '/api/entity?rel=flow%3Aarticle-drafting' },
    ]);
  });

  it('post:post-welcome:200,actions 含 unpublish/archive,guard-results 逐项注入', async () => {
    const res = await GET(request('?rel=post:post-welcome'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      properties: { rel: string; flow: string; node: string; title: string };
      actions: { name: string; href: string }[];
      'guard-results': {
        action: string;
        blocked: boolean;
        guards: { name: string; pass: boolean }[];
      }[];
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
    expect(unpublish).toMatchObject({
      blocked: false,
      guards: [{ name: 'is-published', pass: true }],
    });
    const archive = entity['guard-results']?.find((entry) => entry.action === 'archive');
    expect(archive?.guards).toEqual([{ name: 'is-published', pass: true }]);
  });

  it('向导实例:200,节点 basic-info,actions 含 next(fields 即节点 schema)', async () => {
    const res = await GET(request('?rel=article-drafting:main'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      properties: { node: string };
      actions: {
        name: string;
        fields: { required: string[]; properties: Record<string, unknown> };
      }[];
    };
    expect(entity.properties.node).toBe('basic-info');
    // next(推进)+ abandon(放弃 → done;向导循环化的可达终态出口,D11)。
    expect(entity.actions.map((action) => action.name)).toEqual(['next', 'abandon']);
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

  it('explicit ?scope= is only a navigation preference and cannot widen or break reads (D51)', async () => {
    // D51:?scope= 不再是授权输入——授予集合内的声明仅作导航偏好;越界值静默
    // 丢弃视为未声明,判权交给受众谓词与既有三段裁决。
    expect((await GET(request('?rel=articles&scope=governance'))).status).toBe(200);
    const forged = await GET(request('?rel=articles&scope=root-admin'));
    expect(forged.status).toBe(200);
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

// ---------------------------------------------------------------------------
// 集合读面查询(T38 FR1/FR2):分页参数;不带参数 = 全量的既有用例零改动。
// ---------------------------------------------------------------------------

describe('GET /api/entity — 集合分页(T38)', () => {
  it('offset 分页:切片成员,properties 声明 count/offset,prev 链接诚实声明', async () => {
    const res = await GET(request('?rel=articles&offset=1'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      properties: { rel: string; count: number; offset: number };
      entities: { properties: { rel: string } }[];
      links: { rel: string[]; href: string }[];
    };
    expect(entity.properties).toEqual({ rel: 'articles', count: 1, offset: 1 });
    expect(entity.entities.map((sub) => sub.properties.rel)).toEqual(['post:first-post']);
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=1' },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['flow'], href: '/api/entity?rel=flow%3Aarticle-drafting' },
    ]);
  });

  it('offset=0:首页全页,无 prev/next(短于页大小,诚实缺链)', async () => {
    const res = await GET(request('?rel=articles&offset=0'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      properties: { count: number; offset: number };
      links: { rel: string[]; href: string }[];
    };
    expect(entity.properties).toEqual({ rel: 'articles', count: 2, offset: 0 });
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['flow'], href: '/api/entity?rel=flow%3Aarticle-drafting' },
    ]);
  });

  it('非法 offset → 400 结构化拒绝(layer/reason)', async () => {
    for (const offset of ['-1', 'abc', '1.5', '99999999999999999999']) {
      const res = await GET(request(`?rel=articles&offset=${offset}`));
      expect(res.status, `offset=${offset}`).toBe(400);
      const body = (await res.json()) as { error: string; layer: string; reason: string };
      expect(body.layer).toBe('query');
      expect(body.reason).toBe('invalid-offset');
      expect(body.error).toContain('offset');
    }
  });

  it('非集合实体 / 非成员集合视图带分页参数 → 400 结构化拒绝', async () => {
    for (const rel of ['post:post-welcome', 'inbox']) {
      const res = await GET(request(`?rel=${rel}&offset=0`));
      expect(res.status, `rel=${rel}`).toBe(400);
      const body = (await res.json()) as { reason: string };
      expect(body.reason).toBe('query-target-not-pageable');
    }
  });

  it('未知集合 rel 带分页参数 → 仍 404(存在性语义优先于查询教育)', async () => {
    const res = await GET(request('?rel=nope&offset=0'));
    expect(res.status).toBe(404);
  });
});
