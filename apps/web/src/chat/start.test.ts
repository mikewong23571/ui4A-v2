/**
 * sitemap 感知的起始 rel 解析测试(T2 Phase E / Task E2)。
 * 聊天路由以 sitemap 为"前缀"(arch-brief §6):目标与 surface 词级交集 →
 * 逐个探测可达性(向导 flow 别名 200;多实例 flow 404 跳过),否则回落 articles。
 */
import { describe, expect, it } from 'vitest';

import { resolveStartRel } from './start';
import type { FetchLike } from '@ui4a/agent';

const BASE = 'http://contract.test';

/** 本地脚本化传输(测试留痕;不依赖 agent 包内部 testkit)。 */
function scriptedFetch(responder: (url: string) => Response): {
  fetch: FetchLike;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    fetch: async (url) => {
      const target = String(url);
      urls.push(target);
      return responder(target);
    },
    urls,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SITEMAP = {
  version: 'abc123',
  surfaces: [
    { rel: 'flow:article-drafting', title: '文章发布向导' },
    { rel: 'articles', title: 'articles', collection: true },
    { rel: 'flow:post-status', title: '文章状态' },
    { rel: 'flow:comment-moderation', title: '评论审核' },
    { rel: 'comments', title: '评论', collection: true },
  ],
  flows: [],
};

describe('resolveStartRel', () => {
  it('发布目标 → flow:article-drafting(词级交集且可达)', async () => {
    const transport = scriptedFetch((url) => {
      if (url.includes('well-known')) return jsonResponse(SITEMAP);
      if (url.includes('rel=flow%3Aarticle-drafting'))
        return jsonResponse({ class: ['flow-instance'] });
      return jsonResponse({ error: 'x' }, 404);
    });
    await expect(resolveStartRel(BASE, { verb: '发布一篇文章' }, transport.fetch)).resolves.toBe(
      'flow:article-drafting',
    );
  });

  it('审核目标 → 多实例 flow 404 跳过,落到可达的 comments 集合', async () => {
    const transport = scriptedFetch((url) => {
      if (url.includes('well-known')) return jsonResponse(SITEMAP);
      if (url.includes('rel=comments')) return jsonResponse({ class: ['collection'] });
      return jsonResponse({ error: 'x' }, 404);
    });
    await expect(
      resolveStartRel(BASE, { verb: '审核所有待处理评论' }, transport.fetch),
    ).resolves.toBe('comments');
  });

  it('无词级交集(如下线点名)→ 回落 articles,且只发一次 sitemap 请求', async () => {
    // 实体探测一律 404:'post-welcome' 的词元 post 与 flow:post-status 有词级交集,
    // 但该 flow 别名不可达(多实例)→ 跳过;其余表面无交集 → 兜底 articles。
    const transport = scriptedFetch((url) => {
      if (url.includes('well-known')) return jsonResponse(SITEMAP);
      return jsonResponse({ error: 'x' }, 404);
    });
    await expect(
      resolveStartRel(BASE, { verb: '下线', resource: 'post-welcome' }, transport.fetch),
    ).resolves.toBe('articles');
    expect(transport.urls[0]).toContain('/.well-known/ui4a.json');
    expect(transport.urls.length).toBeGreaterThanOrEqual(1);
  });

  it('sitemap 不可得 → 回落 articles(机械层兜底)', async () => {
    const transport = scriptedFetch(() => jsonResponse({ error: 'x' }, 500));
    await expect(resolveStartRel(BASE, { verb: '发布' }, transport.fetch)).resolves.toBe(
      'articles',
    );
  });
});
