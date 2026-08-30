import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
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
      properties: { rel: string; count: number; presentation: { groupRole: string } };
      entities: {
        href: string;
        properties: {
          name: string;
          status: string;
          presentation: { fields: { path: string }[] };
        };
      }[];
      links: { rel: string[]; href: string }[];
    };
    expect(entity.class).toEqual(['collection', 'meta/flows']);
    expect(entity.properties).toMatchObject({
      rel: 'meta/flows',
      count: 10,
      presentation: { groupRole: 'definition' },
    }); // T35 S9/S10:+todo/ideas
    expect(entity.entities.map((sub) => sub.properties.name)).toEqual([
      'article-drafting',
      'post-status',
      'comment-moderation',
      'software-change',
      'writing-request',
      'agent-definition-authoring',
      // T35 S9/S10:bundle 追加 todo/ideas。
      'todo-capture',
      'todo-item',
      'idea-capture',
      'idea-item',
    ]);
    expect(entity.entities[1]?.href).toBe('/_meta/api/entity?rel=meta/flow:post-status');
    expect(entity.links).toEqual([{ rel: ['self'], href: '/_meta/api/entity?rel=meta/flows' }]);
    expect(entity.entities[0]?.properties.presentation.fields.map((field) => field.path)).toEqual([
      'properties.title',
      'properties.status',
      'properties.version',
    ]);
  });

  it('meta/applications:embedded summaries publish the same declared overview wire', async () => {
    const response = await GET(
      new Request('http://localhost:3100/_meta/api/entity?rel=meta%2Fapplications'),
    );
    expect(response.status).toBe(200);
    const entity = (await response.json()) as {
      properties: { presentation: { groupRole: string } };
      entities: { properties: { presentation: { fields: { path: string }[] } } }[];
    };
    expect(entity.properties.presentation.groupRole).toBe('definition');
    expect(entity.entities[0]?.properties.presentation.fields.map((field) => field.path)).toEqual([
      'properties.title',
      'properties.intent',
      'properties.version',
      'properties.flowCount',
      'properties.capabilityCount',
      'properties.policyCount',
    ]);
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
      // rel 注入(T22 生产修复):与业务实体同口径,canvas deref 按 properties.rel 归键。
      rel: 'meta/flow:post-status',
      name: 'post-status',
      // T35 S7.1:flow 级 title 随投影携带(声明了才出现)。
      title: '文章状态',
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
    expect(
      (entity as unknown as { links: { rel: string[]; href: string; title?: string }[] }).links,
    ).toContainEqual({
      rel: ['application'],
      href: '/_meta/api/entity?rel=meta/application:publishing',
      title: '内容发布',
    });
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

  it('explicit ?scope= is echoed as provenance only; out-of-envelope values are dropped (D51)', async () => {
    const accepted = await GET(
      new Request(
        'http://localhost:3100/_meta/api/entity?rel=meta%2Fagent-definitions&scope=governance',
      ),
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('x-ui4a-effective-scope')).toBe('governance');

    // D51:?scope= 不参与任何校验/判定——越界值静默视为未声明,
    // effective-scope 头只随显式声明出现。
    const forged = await GET(
      new Request(
        'http://localhost:3100/_meta/api/entity?rel=meta%2Fagent-definitions&scope=root-admin',
      ),
    );
    expect(forged.status).toBe(200);
    expect(forged.headers.get('x-ui4a-effective-scope')).toBeNull();
  });
});
