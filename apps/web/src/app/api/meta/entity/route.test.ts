import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '../../../../db/events';
import { getPool } from '../../../../db/pool';
import { resetEngineForTests } from '../../../../engine/service';
import { GET as businessEntityGet } from '../../entity/route';

import { GET } from './route';

// /_meta/api/entity 契约测试(T4 Phase B Task 2,TDD 红→绿):
// - rel 以 meta/ 前缀路由到引擎 meta 投影(同引擎同日志;快照即真相);
// - href 以 /_meta 为前缀(站点自洽:留在定义层);
// - 跨站规则:非 meta rel → 404;业务站 /api/entity 对 meta rel → 404(不混站)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('GET /_meta/api/entity', () => {
  it('meta/flows:200,定义集合四实体,子实体直达 /_meta href', async () => {
    const res = await GET(new Request('http://localhost:3100/_meta/api/entity?rel=meta/flows'));

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      class: string[];
      properties: { rel: string; count: number };
      entities: { href: string; properties: { name: string; status: string } }[];
      links: { rel: string[]; href: string }[];
    };
    expect(entity.class).toEqual(['collection', 'meta/flows']);
    expect(entity.properties).toEqual({ rel: 'meta/flows', count: 5 });
    expect(entity.entities.map((sub) => sub.properties.name)).toEqual([
      'article-drafting',
      'post-status',
      'comment-moderation',
      'software-change',
      'writing-request',
    ]);
    expect(entity.entities[1]?.href).toBe('/_meta/api/entity?rel=meta/flow:post-status');
    expect(entity.links).toEqual([{ rel: ['self'], href: '/_meta/api/entity?rel=meta/flows' }]);
  });

  it('meta/flow:post-status:A.2 定义实体形状(properties/entities/actions=活跃态编辑动词)', async () => {
    const res = await GET(
      new Request('http://localhost:3100/_meta/api/entity?rel=meta/flow:post-status'),
    );

    expect(res.status).toBe(200);
    const entity = (await res.json()) as {
      class: string[];
      properties: {
        name: string;
        version: number;
        status: string;
        initial: string;
        terminal: string[];
      };
      entities: {
        properties: { name: string };
        entities?: { properties: { name: string; to?: string } }[];
      }[];
      actions: { name: string; href: string }[];
      'guard-results': { action: string; blocked: boolean }[];
    };
    expect(entity.class).toEqual(['meta', 'flow-definition']);
    expect(entity.properties).toEqual({
      name: 'post-status',
      version: 1,
      status: 'active',
      initial: 'published',
      terminal: ['archived'],
    });
    const published = entity.entities.find((sub) => sub.properties.name === 'published');
    expect(published?.entities?.map((action) => action.properties.name)).toEqual([
      'unpublish',
      'archive',
    ]);
    // 活跃态编辑动词:A.4 active 节点声明(revise/deprecate)。
    expect(entity.actions.map((action) => action.name)).toEqual(['revise', 'deprecate']);
    expect(entity.actions[0]?.href).toBe('/_meta/api/exec');
  });

  it('跨站规则:非 meta rel → 404;缺 rel → 400;未知 meta rel → 404', async () => {
    expect(
      (await GET(new Request('http://localhost:3100/_meta/api/entity?rel=post:post-welcome')))
        .status,
    ).toBe(404);
    expect((await GET(new Request('http://localhost:3100/_meta/api/entity'))).status).toBe(400);
    expect(
      (await GET(new Request('http://localhost:3100/_meta/api/entity?rel=meta/flow:nope'))).status,
    ).toBe(404);
  });

  it('业务站 /api/entity 对 meta rel → 404(跨站不混,进入定义层必须显式意图)', async () => {
    const res = await businessEntityGet(
      new Request('http://localhost:3100/api/entity?rel=meta/flow:post-status'),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('_meta');
  });
});
