import { beforeEach, describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';
import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';
import { CollectionQueryError } from '../service-collection-query';

// 集合读面查询(T38 FR1/FR2)服务层测试:
// - getEntity 透传原始查询参数 → 引擎解析/切片(页大小是投影策略,服务端驱动);
// - 不带参数 = 全量(无参路径零变化,CLI parity 的服务层锚点);
// - 非法参数与非成员集合目标 → CollectionQueryError(结构化拒绝,拒绝即教育)。
const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);
const ARTICLE_COLLECTION_PRESENTATION = {
  version: 1,
  traits: ['output-catalog'],
  fields: [
    { path: 'properties.title', title: '标题', role: 'identity' },
    {
      path: 'properties.fields.title',
      title: '文章标题',
      role: 'identity',
      overview: true,
    },
    {
      path: 'properties.fields.body',
      title: '正文',
      role: 'primary-content',
      overview: true,
    },
    {
      path: 'properties.fields.category',
      title: '分类',
      role: 'metadata',
      overview: true,
    },
  ],
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('EngineRuntime.getEntity — 集合读面查询(T38)', () => {
  it('无参数 = 全量:articles 返回全部成员与 flow 入口链接', async () => {
    const engine = await getEngine(pool);
    const entity = await engine.getEntity('articles');
    expect(entity?.properties).toEqual({
      rel: 'articles',
      title: '文章',
      identity: '文章',
      count: 2,
      presentation: ARTICLE_COLLECTION_PRESENTATION,
    });
    expect(entity?.entities?.map((child) => child.properties.rel)).toEqual([
      'post:post-welcome',
      'post:first-post',
    ]);
  });

  it('offset 分页:切片成员与 next/prev 声明链接(service → project 透传)', async () => {
    const engine = await getEngine(pool);
    const entity = (await engine.getEntity('articles', { offset: '1' })) as SirenEntity;
    expect(entity.properties).toEqual({
      rel: 'articles',
      title: '文章',
      identity: '文章',
      count: 1,
      offset: 1,
      presentation: ARTICLE_COLLECTION_PRESENTATION,
    });
    expect(entity.entities?.map((child) => child.properties.rel)).toEqual(['post:first-post']);
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles&offset=1' },
      { rel: ['prev'], href: '/api/entity?rel=articles&offset=0' },
      { rel: ['flow'], href: '/api/entity?rel=flow%3Aarticle-drafting' },
    ]);
    // 集合入口链接补全(flow-entry)与分页共存。
    const flowEntry = await engine.getEntity('articles', { offset: '0' });
    expect(flowEntry?.links.map((link) => link.rel)).toEqual([['self'], ['flow']]);
  });

  it('非法 offset → CollectionQueryError(结构化拒绝)', async () => {
    const engine = await getEngine(pool);
    for (const offset of ['-1', 'abc', '1.5']) {
      try {
        await engine.getEntity('articles', { offset });
        expect.unreachable(`offset=${offset} 应被拒绝`);
      } catch (error) {
        expect(error).toBeInstanceOf(CollectionQueryError);
        const rejection = (error as CollectionQueryError).rejection;
        expect(rejection.layer).toBe('query');
        expect(rejection.reason).toBe('invalid-offset');
      }
    }
  });

  it('非成员集合目标(inbox/实例)带查询参数 → CollectionQueryError', async () => {
    const engine = await getEngine(pool);
    for (const rel of ['inbox', 'post:post-welcome']) {
      try {
        await engine.getEntity(rel, { offset: '0' });
        expect.unreachable(`rel=${rel} 应被拒绝`);
      } catch (error) {
        expect(error).toBeInstanceOf(CollectionQueryError);
        expect((error as CollectionQueryError).rejection.reason).toBe('query-target-not-pageable');
      }
    }
  });
});
