import { beforeEach, describe, expect, it } from 'vitest';

import { metaApplicationRel } from '@ui4a/shared';

import { appendEvent, ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { getDb, getEngine, resetEngineForTests } from '../../../engine/service';

import { GET } from './route';

// /.well-known/ui4a.json 契约测试(spec FR4 + T10 验收 4):
// - 200 sitemap 结构:version(内容 hash 短码)/surfaces/flows/applications;
// - 界面清单覆盖三个 flow 与两个集合面;
// - applications 分组:name/title/intent/flows;扁平 flows 索引保留且条目带 app;
// - 版本稳定(同一份定义同一版本,缓存键语义);app 定义变更 → version 变化;
//   db 不可达 → 503。
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const BAD_URL = 'postgres://ui4a:ui4a@localhost:5999/ui4a';
const pool = getPool(REAL_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

function request(): Request {
  return new Request('http://localhost:3100/.well-known/ui4a.json');
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('GET /.well-known/ui4a.json', () => {
  it('200 sitemap:版本号有值,界面清单含 flow 面与集合面', async () => {
    const res = await GET(request());

    expect(res.status).toBe(200);
    const sitemap = (await res.json()) as {
      version: string;
      surfaces: { rel: string; title: string; collection?: boolean }[];
      flows: { name: string; initial: string; nodes: unknown[]; edges: unknown[] }[];
    };
    expect(sitemap.version).toMatch(/^[0-9a-f]{12}$/);
    expect(sitemap.surfaces.map((surface) => surface.rel)).toEqual(
      expect.arrayContaining([
        'flow:article-drafting',
        'flow:post-status',
        'flow:comment-moderation',
        'flow:software-change',
        'articles',
        'comments',
      ]),
    );
    expect(sitemap.flows.map((flow) => flow.name)).toEqual([
      'article-drafting',
      'post-status',
      'comment-moderation',
      'software-change',
      'writing-request',
    ]);
    expect(sitemap.flows[0]?.initial).toBe('basic-info');
  });

  it('每节点 action schema 在 flows[].nodes 内(agent 工具投影的原料)', async () => {
    const res = await GET(request());
    const sitemap = (await res.json()) as {
      flows: {
        name: string;
        nodes: { name: string; actions: { name: string; fields: Record<string, unknown> }[] }[];
        edges: { from: string; action: string; to: string }[];
      }[];
    };

    const drafting = sitemap.flows.find((flow) => flow.name === 'article-drafting');
    const ready = drafting?.nodes.find((node) => node.name === 'ready');
    expect(ready?.actions.map((action) => action.name)).toEqual(['publish']);
    expect(ready?.actions[0]?.fields).toMatchObject({ required: ['title'] });

    const postStatus = sitemap.flows.find((flow) => flow.name === 'post-status');
    expect(postStatus?.edges).toEqual(
      expect.arrayContaining([
        { from: 'published', action: 'unpublish', to: 'offline' },
        { from: 'offline', action: 'republish', to: 'published' },
      ]),
    );
  });

  it('版本稳定:两次请求同版本(定义未变,缓存键不变)', async () => {
    const first = (await (await GET(request())).json()) as { version: string };
    const second = (await (await GET(request())).json()) as { version: string };
    expect(second.version).toBe(first.version);
  });

  it('applications 分组:name/title/intent/flows 齐全;扁平 flows 保留且条目带 app', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const sitemap = (await res.json()) as {
      flows: { name: string; app: string }[];
      applications: {
        name: string;
        title: string;
        intent: string;
        flows: { name: string; app: string }[];
      }[];
    };

    // 分组序 = seed 声明序(default 兜底桶在首);intent 是发现层第一层依据。
    expect(sitemap.applications.map((app) => app.name)).toEqual([
      'default',
      'publishing',
      'community',
      'development',
      'editorial',
    ]);
    const publishing = sitemap.applications.find((app) => app.name === 'publishing');
    expect(publishing).toMatchObject({ title: '内容发布' });
    expect(publishing?.intent).toContain('内容起草与发布');
    expect(publishing?.flows.map((flow) => flow.name)).toEqual(['article-drafting', 'post-status']);
    const community = sitemap.applications.find((app) => app.name === 'community');
    expect(community?.flows.map((flow) => flow.name)).toEqual(['comment-moderation']);
    const development = sitemap.applications.find((app) => app.name === 'development');
    expect(development?.flows.map((flow) => flow.name)).toEqual(['software-change']);

    // 扁平 flows 索引保留(向后兼容),条目带归一化后的 app 归属。
    expect(sitemap.flows.map((flow) => `${flow.name}:${flow.app}`)).toEqual([
      'article-drafting:publishing',
      'post-status:publishing',
      'comment-moderation:community',
      'software-change:development',
      'writing-request:editorial',
    ]);
  });

  it('app 定义变更(日志补种)→ version 变化(缓存键覆盖 applications)', async () => {
    const before = (await (await GET(request())).json()) as { version: string };

    // T1 无 app 编辑动词,定义变更只能经日志进入:直写 application-seeded
    // (与 boot seed 同构),读路径增量 fold 后快照即携带(spec 决定 4)。
    // sitemap 是纯推导不触库,故先 readSnapshot 同步外部事件再取。
    await appendEvent(pool, {
      kind: 'application-seeded',
      rel: metaApplicationRel('labs'),
      detail: {
        name: 'labs',
        definition: { name: 'labs', title: '实验场', intent: '验证中的新能力归组' },
      },
    });
    const engine = await getEngine(getDb());
    await engine.readSnapshot();

    const after = (await (await GET(request())).json()) as {
      version: string;
      applications: { name: string }[];
    };
    expect(after.applications.map((app) => app.name)).toContain('labs');
    expect(after.version).not.toBe(before.version);
  });

  it('db 不可达 → 503 JSON,不抛 500', async () => {
    process.env.DATABASE_URL = BAD_URL;
    try {
      const res = await GET(request());
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
