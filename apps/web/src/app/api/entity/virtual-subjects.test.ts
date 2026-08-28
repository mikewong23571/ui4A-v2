import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { GET as getSitemap } from '../../.well-known/ui4a.json/route';
import { POST as execEntity } from '../exec/route';
import { GET as getEntity } from './route';

// workspace:* 虚主体负向不变量(T31 R11,←T30 复审):组合主体只存在于
// Presentation 授权面内。业务合同面上它必须结构性不可达——当前靠"零特判
// 代码"成立,本 suite 把该口径钉成常驻回归:任何已激活应用组合下,
//   - GET /api/entity?rel=workspace:* → 404(含已注册组合 my-work);
//   - POST /api/exec {rel:workspace:*} → 声明层拒绝;
//   - 授权 sitemap(/.well-known/ui4a.json 全文)中不出现 workspace:* 条目。
// 将来任何人误加 workspace 特判(实体投影、exec 放行、sitemap 注入)即红。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test');

function entityRequest(rel: string): Request {
  return new Request(`http://localhost:3100/api/entity?rel=${encodeURIComponent(rel)}`);
}

function execRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3100/api/exec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 深度收集对象中所有出现 "workspace:" 的字符串值与键(值哨兵即可覆盖键)。 */
function collectVirtualLeaks(value: unknown, path: string, leaks: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('workspace:')) leaks.push(`${path} = "${value}"`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectVirtualLeaks(entry, `${path}[${index}]`, leaks));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (key.includes('workspace:')) leaks.push(`${path} key "${key}"`);
      collectVirtualLeaks(entry, `${path}.${key}`, leaks);
    }
  }
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('workspace virtual subjects stay off the business contract face (T31 R11)', () => {
  // 非空虚化对照(证明下面的负向断言不是环境性全红):业务面在空事件表上
  // 由内置域 bootstrap 照常可达——真实合同 rel 走通,workspace:* 才算"结构性
  // 不可达"而非"服务坏了"。只引用既有先例 fixture(route.test.ts 的 articles/
  // 向导首步),不新增对 site 词表的钉死。
  it('对照:真实集合 rel articles 在同一状态下 → 200', async () => {
    const res = await getEntity(entityRequest('articles'));

    const entity = (await res.json()) as { class: string[] };
    expect(res.status).toBe(200);
    expect(entity.class).toContain('collection');
  });

  it('对照:向导首步 next 经声明层判定放行 → 200', async () => {
    const res = await execEntity(
      execRequest({
        rel: 'article-drafting:main',
        action: 'next',
        params: { title: 'R11 对照' },
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      }),
    );

    expect(res.status).toBe(200);
  });

  it.each(['workspace:', 'workspace:unknown', 'workspace:my-work'])(
    'GET /api/entity?rel=%s → 404',
    async (rel) => {
      const res = await getEntity(entityRequest(rel));

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain(rel);
    },
  );

  it.each([
    { rel: 'workspace:my-work', action: 'review' },
    { rel: 'workspace:my-work', action: 'open' },
    { rel: 'workspace:unknown', action: 'review' },
  ])('POST /api/exec %j → 声明层拒绝', async (request) => {
    const res = await execEntity(execRequest({ ...request, actor: 'human' }));

    // 口径按现状:无声明 rel 一律 declaration 层 undeclared 400,reason 指名 rel。
    expect(res.status).toBe(400);
    const body = (await res.json()) as { layer: string; reason: string };
    expect(body.layer).toBe('undeclared');
    expect(body.reason).toContain(request.rel);
  });

  it('授权 sitemap 中没有任何 workspace:* 条目或字面量泄漏', async () => {
    const res = await getSitemap();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { surfaces?: unknown[] };
    // 非空对照:扫描对象确实携带 surface 清单,泄漏扫描不是在扫空文档。
    expect(Array.isArray(body.surfaces)).toBe(true);
    expect(body.surfaces!.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    collectVirtualLeaks(body, '$', leaks);
    expect(leaks).toEqual([]);
  });
});
