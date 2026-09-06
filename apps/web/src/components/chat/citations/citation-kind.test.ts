import { describe, expect, it } from 'vitest';

import { citationKindOf, declaredFieldTitleOf, declaredTitleOf } from './citation-kind';

/**
 * T56 P3.4 / D78 决定 5:两型判别与声明标题派生的纯单元契约。
 * 判别只用 pointer 结构;数组位置/集合容器 = 集合/成员型。
 */
describe('citationKindOf:精确型 vs 集合/成员型(纯指针前缀判别)', () => {
  it('对象级与稳定字段路径 = 精确型', () => {
    expect(citationKindOf('/')).toBe('exact');
    expect(citationKindOf('/properties/status')).toBe('exact');
    expect(citationKindOf('/properties/fields/body')).toBe('exact');
    expect(citationKindOf('/properties/fields/summary')).toBe('exact');
  });

  it('数组位置段、/entities/ 前缀与集合容器终点 = 集合/成员型', () => {
    expect(citationKindOf('/entities')).toBe('collection');
    expect(citationKindOf('/entities/1')).toBe('collection');
    expect(citationKindOf('/entities/1/properties/rel')).toBe('collection');
    expect(citationKindOf('/items/2/properties/title')).toBe('collection');
    // 任意位置的数组下标都是位置寻址,不因嵌套在 properties 下而假称稳定定位。
    expect(citationKindOf('/properties/tags/0')).toBe('collection');
  });
});

describe('declaredTitleOf:声明身份键(G10 口径)', () => {
  it('identity/title 优先于 target/flow,且不回显 rel 本身', () => {
    expect(declaredTitleOf({ properties: { rel: 'idea:1', identity: '想法 A' } })).toBe('想法 A');
    expect(declaredTitleOf({ properties: { rel: 'idea:1', title: '想法标题' } })).toBe('想法标题');
    expect(declaredTitleOf({ properties: { rel: 'idea:1', target: 'post:x' } })).toBe('post:x');
    expect(declaredTitleOf({ properties: { rel: 'idea:1', flow: 'idea-item' } })).toBe('idea-item');
    // identity 等于 rel 时不算声明身份,继续找 title。
    expect(
      declaredTitleOf({ properties: { rel: 'idea:1', identity: 'idea:1', title: '备选' } }),
    ).toBe('备选');
  });

  it('无声明身份或非对象文档 → null(调用方回退 rel,不猜名称)', () => {
    expect(declaredTitleOf({ properties: { rel: 'idea:1', count: 3 } })).toBeNull();
    expect(declaredTitleOf({ properties: {} })).toBeNull();
    expect(declaredTitleOf(null)).toBeNull();
    expect(declaredTitleOf(['entity'])).toBeNull();
  });
});

describe('declaredFieldTitleOf:presentation.fields 合同 title(与 entity-view 同源)', () => {
  const document = {
    properties: {
      presentation: {
        fields: [
          { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
          { path: 'properties.fields.summary', title: '摘要', role: 'metadata' },
        ],
      },
    },
  };

  it('按 pointer → 声明 path 匹配字段标题', () => {
    expect(declaredFieldTitleOf(document, '/properties/fields/body')).toBe('正文');
    expect(declaredFieldTitleOf(document, '/properties/fields/summary')).toBe('摘要');
  });

  it('未声明/非字段路径/JSON Pointer 转义对齐', () => {
    expect(declaredFieldTitleOf(document, '/properties/count')).toBeNull();
    expect(declaredFieldTitleOf(document, '/')).toBeNull();
    expect(declaredFieldTitleOf({}, '/properties/fields/body')).toBeNull();
    // 段名含 / 或 ~ 时声明 path 用原字符,匹配前须还原转义。
    const escaped = {
      properties: {
        presentation: { fields: [{ path: 'properties.fields.a/b', title: '特殊字段' }] },
      },
    };
    expect(declaredFieldTitleOf(escaped, '/properties/fields/a~1b')).toBe('特殊字段');
  });
});
