import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '../../../../../db/events';
import { getPool } from '../../../../../db/pool';
import { resetEngineForTests } from '../../../../../engine/service';

import { GET } from './route';

// /_meta/.well-known/ui4a.json 契约测试(T4 Phase B Task 2,TDD 红→绿):
// meta 站点 sitemap——meta rel 面(self/flows/activations/capabilities +
// 每个定义实体 + 每个 capability 实体[T13 Phase C]),
// agent 进入定义层的第一跳(显式意图,业务站 sitemap 不携带任何 _meta 入口)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('GET /_meta/.well-known/ui4a.json', () => {
  it('200:meta rel 面齐备并包含 Agent Definition registry，版本为内容 hash 短码', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const sitemap = (await res.json()) as {
      version: string;
      site: string;
      surfaces: { rel: string; title: string; collection?: boolean }[];
    };
    expect(sitemap.version).toMatch(/^[0-9a-f]{12}$/);
    expect(sitemap.site).toBe('meta');
    const stableSurfaces = sitemap.surfaces
      .map((surface) => surface.rel)
      .filter((rel) => !rel.startsWith('meta/agent-definition:'));
    expect(stableSurfaces).toEqual([
      'meta/self',
      'meta/flows',
      'meta/activations',
      'meta/applications',
      'meta/application:default',
      'meta/application:publishing',
      'meta/application:community',
      'meta/application:development',
      'meta/application:editorial',
      'meta/application:governance',
      'meta/flow:article-drafting',
      'meta/flow:post-status',
      'meta/flow:comment-moderation',
      'meta/flow:software-change',
      'meta/flow:writing-request',
      'meta/flow:agent-definition-authoring',
      'meta/capabilities',
      'meta/capability:draft',
      'meta/capability:notify',
      'meta/capability:clarify',
      'meta/capability:coding.execute',
      'meta/capability:writing.compose',
      'meta/capability:agent-definition.author',
      'meta/drafts',
      'meta/agent-definitions',
    ]);
  });
});
