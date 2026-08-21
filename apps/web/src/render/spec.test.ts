import { describe, expect, it } from 'vitest';

import { collectionRef, dimensionRef, entityRef, fieldRef } from './spec';
import { validateSpec } from './validator';

// 零字面校验器矩阵(T7 Phase A Task 1 / spec 架构决定 2):
// "模型发不出一个数字"的 schema 剃刀——bind 树只允许引用节点
// (ref/field/collection+dimension)与结构容器(数组/字典),任何裸
// number/string/boolean/null 载荷都被拒,且错误带路径(注入防御的审计口径)。

describe('零字面校验器:合法 spec', () => {
  it('最小合法:field 引用 + 结构字典', () => {
    const spec = {
      concern: 'home-status',
      component: 'stat',
      bind: { value: { field: fieldRef('post:post-welcome', 'title') } },
    };
    expect(validateSpec(spec)).toEqual({ valid: true });
  });

  it('dimension 声明合法(collection + dimension field-ref)', () => {
    const spec = {
      concern: 'articles-by-category',
      component: 'chart',
      bind: { series: { collection: 'posts', dimension: dimensionRef('posts', 'category') } },
    };
    expect(validateSpec(spec)).toEqual({ valid: true });
  });

  it('实体引用 + 深层结构(数组×字典×引用混合)合法', () => {
    const spec = {
      concern: 'fleet',
      component: 'table',
      bind: {
        rows: [
          { cells: [{ field: fieldRef('post:post-welcome', 'title') }] },
          { cells: [{ ref: entityRef('post:post-welcome') }] },
          { items: { collection: collectionRef('posts') } },
        ],
        emptyDict: {},
        emptyArray: [],
      },
    };
    expect(validateSpec(spec)).toEqual({ valid: true });
  });

  it('collection 不带 dimension 也合法(dimension 可选)', () => {
    const spec = {
      concern: 'c',
      component: 'kanban',
      bind: { columns: { collection: collectionRef('comments') } },
    };
    expect(validateSpec(spec)).toEqual({ valid: true });
  });
});

describe('零字面校验器:字面载荷注入全部被拒(带路径)', () => {
  it('裸数字载荷 → invalid,路径指向注入点', () => {
    const spec = {
      concern: 'c',
      component: 'stat',
      bind: { value: 42 },
    };
    const result = validateSpec(spec);
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'bind.value')).toBe(true);
    }
  });

  it('裸字符串载荷 → invalid', () => {
    const spec = { concern: 'c', component: 'markdown', bind: { body: '你好世界' } };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'bind.body')).toBe(true);
    }
  });

  it('裸 boolean 载荷 → invalid', () => {
    const spec = { concern: 'c', component: 'stat', bind: { visible: true } };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'bind.visible')).toBe(true);
    }
  });

  it('null 载荷 → invalid', () => {
    const spec = { concern: 'c', component: 'detail', bind: { note: null } };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'bind.note')).toBe(true);
    }
  });

  it('数组内字面 → 路径带下标', () => {
    const spec = {
      concern: 'c',
      component: 'table',
      bind: { rows: [{ field: fieldRef('posts', 'count') }, 7] },
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'bind.rows[1]')).toBe(true);
    }
  });

  it('嵌套字典深层字面 → 完整路径', () => {
    const spec = {
      concern: 'c',
      component: 'chart',
      bind: { a: { b: { c: { lit: 'injected' } } } },
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'bind.a.b.c.lit')).toBe(true);
    }
  });

  it('bind 根直接是字面 → 路径 bind', () => {
    expect(validateSpec({ concern: 'c', component: 'stat', bind: 3 }).valid).toBe(false);
    expect(validateSpec({ concern: 'c', component: 'stat', bind: 'text' }).valid).toBe(false);
  });
});

describe('零字面校验器:引用格式与节点形状', () => {
  it('ref 缺 entity: 前缀 → invalid', () => {
    const spec = { concern: 'c', component: 'detail', bind: { e: { ref: 'post:post-welcome' } } };
    expect(validateSpec(spec).valid).toBe(false);
  });

  it('ref 空实体名 → invalid', () => {
    const spec = { concern: 'c', component: 'detail', bind: { e: { ref: 'entity:' } } };
    expect(validateSpec(spec).valid).toBe(false);
  });

  it('field 无 rel/path 分隔 → invalid', () => {
    expect(
      validateSpec({
        concern: 'c',
        component: 'stat',
        bind: { v: { field: 'no-separator' } },
      }).valid,
    ).toBe(false);
  });

  it('field 空 rel 或空 path → invalid', () => {
    expect(
      validateSpec({ concern: 'c', component: 'stat', bind: { v: { field: '.title' } } }).valid,
    ).toBe(false);
    expect(
      validateSpec({
        concern: 'c',
        component: 'stat',
        bind: { v: { field: 'post:post-welcome.' } },
      }).valid,
    ).toBe(false);
  });

  it('引用节点混入其他键 → invalid(节点必须恰是一种引用)', () => {
    const spec = {
      concern: 'c',
      component: 'detail',
      bind: { e: { ref: entityRef('post:post-welcome'), field: fieldRef('posts', 'count') } },
    };
    expect(validateSpec(spec).valid).toBe(false);
  });

  it('collection 节点混入未知键 → invalid', () => {
    const spec = {
      concern: 'c',
      component: 'table',
      bind: { rows: { collection: 'posts', limit: 10 } },
    };
    expect(validateSpec(spec).valid).toBe(false);
  });

  it('dimension 的 rel 前缀与 collection 不一致 → invalid', () => {
    const spec = {
      concern: 'c',
      component: 'chart',
      bind: { series: { collection: 'posts', dimension: fieldRef('comments', 'status') } },
    };
    expect(validateSpec(spec).valid).toBe(false);
  });

  it('dimension 非字符串 → invalid', () => {
    const spec = {
      concern: 'c',
      component: 'chart',
      bind: { series: { collection: 'posts', dimension: 3 } },
    };
    expect(validateSpec(spec).valid).toBe(false);
  });

  it('collection 空名 → invalid', () => {
    expect(
      validateSpec({ concern: 'c', component: 'table', bind: { rows: { collection: '' } } }).valid,
    ).toBe(false);
  });
});

describe('零字面校验器:顶层形状', () => {
  it('spec 非对象 → invalid', () => {
    expect(validateSpec(null).valid).toBe(false);
    expect(validateSpec('spec').valid).toBe(false);
    expect(validateSpec(42).valid).toBe(false);
  });

  it('concern 缺失/空/非字符串 → invalid', () => {
    expect(validateSpec({ component: 'stat', bind: {} }).valid).toBe(false);
    expect(validateSpec({ concern: '', component: 'stat', bind: {} }).valid).toBe(false);
    expect(validateSpec({ concern: 3, component: 'stat', bind: {} }).valid).toBe(false);
  });

  it('component 缺失/非字符串 → invalid', () => {
    expect(validateSpec({ concern: 'c', bind: {} }).valid).toBe(false);
    expect(validateSpec({ concern: 'c', component: 7, bind: {} }).valid).toBe(false);
  });

  it('bind 缺失 → invalid', () => {
    expect(validateSpec({ concern: 'c', component: 'stat' }).valid).toBe(false);
  });

  it('错误信息含路径与原因(审计口径)', () => {
    const result = validateSpec({ concern: 'c', component: 'stat', bind: { value: 1 } });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const error = result.errors.find((e) => e.path === 'bind.value');
      expect(error).toBeDefined();
      expect(error?.message).toContain('字面');
    }
  });
});
