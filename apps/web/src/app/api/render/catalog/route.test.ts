import { describe, expect, it } from 'vitest';

import { CATALOG_ID } from '../../../../render/registry';

import { GET } from './route';

// /api/render/catalog 契约测试(T7 Phase A Task 2):GET → 200 目录 JSON
// (A2UI catalog 形状:$id/catalogId + components{词名: bindSchema}),
// 十词条齐全,与注册表同源(词汇表身份 = 扩展目录,以 URL 引用)。

describe('GET /api/render/catalog', () => {
  it('HTTP 200,JSON 目录(catalogId 为稳定 URI)', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { catalogId: string; components: Record<string, unknown> };
    expect(body.catalogId).toBe(CATALOG_ID);
    expect(Object.keys(body.components)).toHaveLength(10);
  });

  it('components 与注册表 bindSchema 同源(chart 词条在场)', async () => {
    const res = await GET();
    const body = (await res.json()) as {
      components: Record<string, { type?: string; description?: string }>;
    };
    expect(body.components.chart?.type).toBe('object');
    expect(typeof body.components.chart?.description).toBe('string');
  });
});
