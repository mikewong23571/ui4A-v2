import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';
import type { SirenEntity } from '@ui4a/engine';

import { businessFlows } from '../../domain/flows';
import { ensureEventsTable, readLog } from '../../db/events';
import { getPool } from '../../db/pool';
import { getEngine, resetEngineForTests } from '../../engine/service';

import { GET as getSitemap } from '../.well-known/ui4a.json/route';
import { GET as getEntityRoute } from './entity/route';
import { POST as postExecRoute } from './exec/route';
import { GET as getEvents } from './events/route';

// 合同级测试(T2 Phase C / Task C4):跨端点一致性,route handler 直测
// (server 级 fetch smoke 留给 Phase D E2E——编排决定)。
// - DoD3:exec 拒绝响应 {layer,reason} 与 /api/events 最新 action-rejected 一致;
// - DoD 并发:route 层并发 POST 无交错,增量快照与 fold(日志) hash 一致;
// - B1 投影联动:exec publish 后 /api/entity?rel=articles 计数 2→3;
// - sitemap 表面 → entity 端点可达(集合面)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

function entity(rel: string): Promise<Response> {
  return getEntityRoute(
    new Request(`http://localhost:3100/api/entity?rel=${encodeURIComponent(rel)}`),
  );
}

function exec(body: Record<string, unknown>): Promise<Response> {
  return postExecRoute(
    new Request('http://localhost:3100/api/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  reason: string | null;
  detail: unknown;
}

async function latestRejection(): Promise<LoggedEvent> {
  const res = await getEvents(new Request('http://localhost:3100/api/events'));
  const body = (await res.json()) as { events: LoggedEvent[] };
  const rejected = body.events.filter((event) => event.kind === 'action-rejected');
  return rejected[rejected.length - 1]!;
}

async function advanceWizard(): Promise<void> {
  const steps = [
    { params: { title: 'New Article' } },
    { params: { category: 'tech', tags: 'ui4a' } },
    { params: { body: '正文内容' } },
  ];
  for (const step of steps) {
    const res = await exec({ rel: 'article-drafting:main', action: 'next', params: step.params, actor: 'agent' });
    expect(res.status).toBe(200);
  }
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('DoD3:exec 拒绝响应与 /api/events 最新 action-rejected 一致(同源)', () => {
  it('声明层:layer/reason 逐字一致', async () => {
    const res = await exec({ rel: 'comment:c1', action: 'explode', params: {}, actor: 'agent' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { layer: string; reason: string };

    const event = await latestRejection();
    expect(event).toMatchObject({ kind: 'action-rejected', rel: 'comment:c1', action: 'explode' });
    expect(event.reason).toBe(body.reason);
    expect((event.detail as { layer: string }).layer).toBe(body.layer);
  });

  it('guard 层:layer/reason 一致且 detail 均含谓词求值', async () => {
    await advanceWizard();
    const res = await exec({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: '欢迎来到 UI4A' },
      actor: 'agent',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { layer: string; reason: string; detail: unknown };

    const event = await latestRejection();
    expect(event.reason).toBe(body.reason);
    expect((event.detail as { layer: string }).layer).toBe(body.layer);
    expect(JSON.stringify(event.detail)).toContain('title-not-taken');
    expect(JSON.stringify(body.detail)).toContain('title-not-taken');
  });

  it('schema 层:layer/reason 一致', async () => {
    const res = await exec({ rel: 'article-drafting:main', action: 'next', params: {} });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { layer: string; reason: string };

    const event = await latestRejection();
    expect(event.reason).toBe(body.reason);
    expect((event.detail as { layer: string }).layer).toBe(body.layer);
  });
});

describe('并发 exec 串行(route 层,单 atom)', () => {
  it('4 路并发清空 pending 队列,恰 1 路被拒,增量快照=fold(日志)', async () => {
    const responses = await Promise.all([
      exec({ rel: 'comment:c1', action: 'approve', params: {}, actor: 'agent' }),
      exec({ rel: 'comment:c2', action: 'approve', params: {}, actor: 'agent' }),
      exec({ rel: 'comment:c3', action: 'approve', params: {}, actor: 'agent' }),
      exec({ rel: 'comment:c3', action: 'reject', params: {}, actor: 'agent' }),
    ]);
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 200, 200, 400]); // 输家:approve/reject 已不在 pending 声明集

    // 每条评论恰好迁移一次,队列清零。
    for (const rel of ['comment:c1', 'comment:c2', 'comment:c3']) {
      const res = await entity(rel);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SirenEntity;
      expect(body.properties.node).not.toBe('pending');
    }

    // 拒绝留痕恰 1 条(I6),且可作下一步上下文读取。
    const res = await getEvents(new Request('http://localhost:3100/api/events'));
    const body = (await res.json()) as { events: LoggedEvent[] };
    const rejections = body.events.filter((event) => event.kind === 'action-rejected');
    expect(rejections).toHaveLength(1);

    // 增量快照与重放一致(无交错损坏)。
    const engine = await getEngine(pool);
    const replayed = fold(await readLog(pool), { flows: businessFlows });
    expect(contentVersion(replayed)).toBe(contentVersion(engine.getSnapshot()));
  });
});

describe('B1 投影联动:exec → /api/entity', () => {
  it('publish 后 articles 计数 2→3,新文章直达且挂 post-status 动作', async () => {
    await advanceWizard();
    const publish = await exec({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: 'New Article' },
      actor: 'agent',
      principal: 'user:mike',
    });
    expect(publish.status).toBe(200);

    const listRes = await entity('articles');
    const list = (await listRes.json()) as SirenEntity & {
      entities: { properties: { rel: string } }[];
    };
    expect(list.properties).toMatchObject({ count: 3 });
    expect(list.entities.map((sub) => sub.properties.rel)).toContain('post:new-article');

    const postRes = await entity('post:new-article');
    expect(postRes.status).toBe(200);
    const post = (await postRes.json()) as SirenEntity;
    expect(post.properties).toMatchObject({ rel: 'post:new-article', node: 'published' });
    expect(post.actions.map((action) => action.name)).toEqual(['unpublish', 'archive']);
  });

  it('B2:unpublish 后该篇 offline,另一篇不受影响(精确下线)', async () => {
    const res = await exec({ rel: 'post:post-welcome', action: 'unpublish', params: {}, actor: 'human' });
    expect(res.status).toBe(200);

    const welcome = (await (await entity('post:post-welcome')).json()) as SirenEntity;
    expect(welcome.properties.node).toBe('offline');
    expect(welcome.actions.map((action) => action.name)).toEqual(['republish']);

    const other = (await (await entity('post:first-post')).json()) as SirenEntity;
    expect(other.properties.node).toBe('published');
  });
});

describe('sitemap 表面 ↔ entity 端点一致', () => {
  it('sitemap 中的集合表面全部可经 /api/entity 取到', async () => {
    const sitemap = (await (await getSitemap()).json()) as {
      surfaces: { rel: string; collection?: boolean }[];
    };

    const collections = sitemap.surfaces.filter((surface) => surface.collection);
    expect(collections.map((surface) => surface.rel).sort()).toEqual(['articles', 'comments']);
    for (const surface of collections) {
      const res = await entity(surface.rel);
      expect(res.status, `集合面 ${surface.rel} 应可达`).toBe(200);
    }
  });
});
