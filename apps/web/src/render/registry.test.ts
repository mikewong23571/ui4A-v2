import { describe, expect, it } from 'vitest';

import { CATALOG_ID, RENDER_WORDS, catalogUrl, renderCatalogJson, wordOf } from './registry';

// 渲染词汇表注册表(T7 spec 架构决定 1):词条 = {名字, 组件(lazy),
// bind schema, dimension 支持};词汇表即 A2UI 自定义扩展目录——
// 目录 JSON($id/catalogId + components{词名: bindSchema})经
// /api/render/catalog 以 URL 引用(createSurface 的 catalogId 协商口径)。

const EXPECTED_WORDS = [
  'table',
  'chart',
  'stat',
  'timeline',
  'flow',
  'form',
  'diff',
  'kanban',
  'markdown',
  'detail',
] as const;

describe('词汇表注册表', () => {
  it('MVP 十词条齐全且无重复(spec 架构决定 1)', () => {
    const names = RENDER_WORDS.map((word) => word.name);
    expect(names).toEqual([...EXPECTED_WORDS]);
    expect(new Set(names).size).toBe(10);
  });

  it('每词条形状完整:name/title 非空、bindSchema 对象、component 为 lazy 引用', () => {
    for (const word of RENDER_WORDS) {
      expect(word.name, '词名非空').not.toBe('');
      expect(word.title, '标题非空').not.toBe('');
      expect(typeof word.bindSchema).toBe('object');
      expect(word.bindSchema).not.toBeNull();
      expect(typeof word.component, 'lazy 组件引用').toBe('function');
    }
  });

  it('lazy 引用可调用且解析为组件(Phase B 接真实组件前的占位约定)', async () => {
    for (const word of RENDER_WORDS) {
      const component = await word.component();
      expect(typeof component).toBe('function');
    }
  });

  it('chart 支持 dimension 聚合数据源;table 消费集合但不聚合', () => {
    expect(wordOf('chart')?.supportsDimension).toBe(true);
    expect(wordOf('table')?.supportsDimension).toBe(false);
  });

  it('wordOf:已知词名命中,未知词名 undefined', () => {
    expect(wordOf('stat')?.name).toBe('stat');
    expect(wordOf('nope')).toBeUndefined();
  });

  it('catalogUrl 指向目录端点', () => {
    expect(catalogUrl).toBe('/api/render/catalog');
  });
});

describe('A2UI 扩展目录 JSON 形状', () => {
  it('$id 与 catalogId 一致且为稳定 URI;components 十词条', () => {
    const catalog = renderCatalogJson();
    expect(catalog.$id).toBe(CATALOG_ID);
    expect(catalog.catalogId).toBe(CATALOG_ID);
    expect(CATALOG_ID).toMatch(/^https?:\/\//);
    expect(Object.keys(catalog.components).sort()).toEqual([...EXPECTED_WORDS].sort());
  });

  it('每个 component schema 有 description 与 type(目录自描述)', () => {
    const catalog = renderCatalogJson();
    for (const [name, schema] of Object.entries(catalog.components)) {
      expect(typeof schema.description, `${name}.description`).toBe('string');
      expect(schema.type, `${name}.type`).toBe('object');
    }
  });

  it('目录 JSON 可序列化(传输无关;catalog 与注册表同源)', () => {
    const catalog = renderCatalogJson();
    expect(() => JSON.stringify(catalog)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(catalog)) as ReturnType<typeof renderCatalogJson>;
    expect(parsed).toEqual(catalog);
  });
});
