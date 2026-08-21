import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { entityRef, fieldRef, type BindTree, type RenderSpec } from './spec';
import { deref, type EntityCache } from './deref';
import { validateSpec } from './validator';

// I2 property test(T7 Phase A Task 1 / GOAL I2):随机实体快照 × 随机合法
// render spec → 解引用输出每个数值/字符串都能在实体快照中找到出处(逐项
// 溯源:并行遍历 bind 树与输出树,引用节点断言同一性,聚合输出独立重算);
// 反向:随机注入字面 → 校验器必拒且路径指向注入点(binding-only 剃刀)。

// ---------------------------------------------------------------------------
// 随机世界生成器:实体(rel + 属性,含一层嵌套)+ posts 集合
// ---------------------------------------------------------------------------

/** 安全字符集(rel/键不含 '.',保证 field-ref 的 rel/path 切分无歧义)。 */
const safeKeyArb = fc
  .array(fc.constantFrom(...'abcdefgh'.split('')), { minLength: 2, maxLength: 5 })
  .map((chars) => chars.join(''));

/** 全体成员必带的维度键(保证 dimension path 对每个成员都存在)。 */
const DIMENSION_KEY = 'category';
const COLLECTION_REL = 'posts';

const primitiveArb = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }),
  fc.double({ noNaN: true, min: -100, max: 100 }),
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.boolean(),
);

const valueArb = fc.oneof(
  primitiveArb,
  fc.dictionary(safeKeyArb, primitiveArb, { minKeys: 1, maxKeys: 2 }),
);

const propertiesArb = fc.dictionary(safeKeyArb, valueArb, { minKeys: 1, maxKeys: 3 });

interface WorldEntity {
  rel: string;
  properties: Record<string, unknown>;
}

interface World {
  entities: WorldEntity[];
  /** 集合成员(实体表前 min(3, n) 个,全部带维度键)。 */
  members: WorldEntity[];
  cache: EntityCache;
}

/** 生成实体世界:成员实体补维度键(维度路径对成员全覆盖)。 */
const worldArb = fc
  .tuple(
    fc.array(propertiesArb, { minLength: 1, maxLength: 5 }),
    fc.array(fc.constantFrom('tech', 'essay', 'news', 'meta'), { minLength: 1, maxLength: 3 }),
  )
  .map(([propsList, categories]): World => {
    const entities: WorldEntity[] = propsList.map((properties, index) => ({
      rel: `e${index}`,
      properties,
    }));
    const memberCount = Math.min(3, entities.length);
    const members = entities.slice(0, memberCount).map((candidate, index) => {
      const withDimension: WorldEntity = {
        ...candidate,
        properties: {
          ...candidate.properties,
          [DIMENSION_KEY]: categories[index % categories.length]!,
        },
      };
      entities[index] = withDimension;
      return withDimension;
    });
    const toSiren = (source: WorldEntity): SirenEntity => ({
      class: ['instance'],
      properties: source.properties,
      actions: [],
      links: [],
    });
    const cache: EntityCache = new Map(
      entities.map((source) => [source.rel, toSiren(source)] as const),
    );
    cache.set(COLLECTION_REL, {
      class: ['collection', COLLECTION_REL],
      properties: { rel: COLLECTION_REL, count: members.length },
      actions: [],
      links: [],
      entities: members.map((member) => ({ ...toSiren(member), rel: ['item'] })),
    });
    return { entities, members, cache };
  });

// ---------------------------------------------------------------------------
// 随机合法 spec 生成器(从世界中取既有 rel/字段路径,保证可解引用)
// ---------------------------------------------------------------------------

/** 收集实体属性的全部字段路径(一层嵌套展开)。 */
function fieldPathsOf(properties: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const inner of Object.keys(value)) paths.push(`${key}.${inner}`);
    } else {
      paths.push(key);
    }
  }
  return paths;
}

const bindArbFor = (world: World, depth: number): fc.Arbitrary<BindTree> => {
  const leaf: fc.Arbitrary<BindTree>[] = [
    fc.constantFrom(...world.entities.map((source) => ({ ref: entityRef(source.rel) }))),
    fc.constantFrom(
      ...world.entities.flatMap((source) =>
        fieldPathsOf(source.properties).map((path) => ({ field: fieldRef(source.rel, path) })),
      ),
    ),
    fc.constantFrom<BindTree>(
      { collection: COLLECTION_REL },
      { collection: COLLECTION_REL, dimension: fieldRef(COLLECTION_REL, DIMENSION_KEY) },
    ),
  ];
  if (depth <= 0) return fc.oneof(...leaf);
  const structure: fc.Arbitrary<BindTree>[] = [
    fc.array(bindArbFor(world, depth - 1), { minLength: 0, maxLength: 3 }),
    fc.dictionary(safeKeyArb, bindArbFor(world, depth - 1), { minKeys: 0, maxKeys: 3 }),
  ];
  return fc.oneof(...leaf, ...structure);
};

const specArbFor = (world: World): fc.Arbitrary<RenderSpec> =>
  fc
    .tuple(bindArbFor(world, 2), fc.constantFrom('stat', 'chart', 'table', 'detail'))
    .map(([bind, component]) => ({ concern: `concern-${component}`, component, bind }));

// ---------------------------------------------------------------------------
// 逐项溯源断言:并行遍历 bind 与输出
// ---------------------------------------------------------------------------

/** 深度收集世界全部原始值(溯源宇宙;实体属性是真值来源)。 */
function valueUniverse(world: World): Set<string> {
  const universe = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'object' && value !== null) {
      for (const inner of Object.values(value as Record<string, unknown>)) add(inner);
      return;
    }
    if (value === null) return;
    universe.add(`${typeof value}:${String(value)}`);
  };
  for (const source of world.entities) {
    for (const value of Object.values(source.properties)) add(value);
  }
  return universe;
}

function assertProvenance(
  bind: BindTree,
  out: unknown,
  universe: Set<string>,
  world: World,
  where: string,
): void {
  if (Array.isArray(bind)) {
    expect(Array.isArray(out), `${where}: 数组节点输出应为数组`).toBe(true);
    const items = out as unknown[];
    expect(items, `${where}: 数组长度一致`).toHaveLength(bind.length);
    bind.forEach((child, index) =>
      assertProvenance(child, items[index], universe, world, `${where}[${index}]`),
    );
    return;
  }
  if (typeof bind === 'object' && bind !== null) {
    const record = bind as Record<string, unknown>;
    if ('ref' in record) {
      const rel = String(record.ref).slice('entity:'.length);
      expect(out, `${where}: ref 输出应是缓存实体本身`).toBe(world.cache.get(rel));
      return;
    }
    if ('field' in record) {
      const [rel, ...path] = String(record.field).split('.');
      let expected: unknown = world.cache.get(rel)?.properties;
      for (const segment of path) {
        expected = (expected as Record<string, unknown> | undefined)?.[segment];
      }
      expect(out, `${where}: field 输出应与实体快照逐项相等`).toEqual(expected);
      if (expected !== null && expected !== undefined && typeof expected !== 'object') {
        expect(
          universe.has(`${typeof expected}:${String(expected)}`),
          `${where}: 字段值应在实体快照中找到出处(${typeof expected}:${String(expected)})`,
        ).toBe(true);
      }
      return;
    }
    if ('collection' in record) {
      if (typeof record.dimension === 'string') {
        const [collectionRel, ...path] = record.dimension.split('.');
        expect(collectionRel).toBe(COLLECTION_REL);
        // 独立重算分组计数(不依赖被测实现;count 是唯一计算值,其出处是
        // 集合成员资格;key 是成员维度值的字符串化)。
        const expected = new Map<string, number>();
        for (const member of world.members) {
          let value: unknown = member.properties;
          for (const segment of path) {
            value = (value as Record<string, unknown> | undefined)?.[segment];
          }
          const key = String(value);
          expected.set(key, (expected.get(key) ?? 0) + 1);
        }
        const groups = out as { key: string; count: number }[];
        expect(
          groups.map((group) => [group.key, group.count]),
          `${where}: 聚合输出应与独立重算一致`,
        ).toEqual([...expected.entries()]);
        for (const group of groups) {
          expect(
            universe.has(`string:${group.key}`),
            `${where}: 聚合键应是实体快照中的维度值`,
          ).toBe(true);
        }
        return;
      }
      const members = out as SirenEntity[];
      const expectedMembers = world.cache.get(COLLECTION_REL)?.entities ?? [];
      expect(members, `${where}: 集合输出应是集合子实体`).toEqual(expectedMembers);
      expect(members.length).toBe(world.members.length);
      return;
    }
    // 结构字典:逐键递归。
    expect(typeof out, `${where}: 字典节点输出应为对象`).toBe('object');
    const outRecord = out as Record<string, unknown>;
    expect(Object.keys(outRecord).sort(), `${where}: 字典键一致`).toEqual(
      Object.keys(record).sort(),
    );
    for (const [key, child] of Object.entries(record)) {
      assertProvenance(child as BindTree, outRecord[key], universe, world, `${where}.${key}`);
    }
    return;
  }
  throw new Error(`${where}: 测试生成的 bind 不应包含字面(生成器 bug)`);
}

// ---------------------------------------------------------------------------
// 字面注入器(校验器必拒;位置 = bind 树的任意值节点含根)
// ---------------------------------------------------------------------------

interface BindPosition {
  /** 从 bind 根出发的段路径(数组下标为数字段)。 */
  path: string[];
  /** 展示用路径(校验器错误口径)。 */
  label: string;
}

function positionsOf(bind: BindTree, path: string[], label: string): BindPosition[] {
  const here: BindPosition[] = [{ path, label }];
  if (Array.isArray(bind)) {
    bind.forEach((child, index) =>
      here.push(...positionsOf(child, [...path, String(index)], `${label}[${index}]`)),
    );
    return here;
  }
  if (typeof bind === 'object' && bind !== null) {
    const record = bind as Record<string, unknown>;
    if (!('ref' in record || 'field' in record || 'collection' in record)) {
      for (const [key, child] of Object.entries(record)) {
        here.push(...positionsOf(child as BindTree, [...path, key], `${label}.${key}`));
      }
    }
    return here;
  }
  return here;
}

function setAt(bind: BindTree, path: readonly string[], literal: unknown): BindTree {
  const [head, ...rest] = path;
  if (head === undefined) return literal as BindTree;
  if (/^\d+$/.test(head)) {
    const index = Number(head);
    const copy = [...(bind as BindTree[])];
    copy[index] = setAt(copy[index]!, rest, literal);
    return copy;
  }
  const record = { ...(bind as Record<string, unknown>) };
  record[head] = setAt(record[head] as BindTree, rest, literal);
  return record as BindTree;
}

const literalArb = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.string({ minLength: 0, maxLength: 10 }),
  fc.boolean(),
  fc.constant(null),
);

describe('I2 property:解引用输出逐项溯源', () => {
  it('随机实体快照 × 随机合法 spec → 输出每个值都能在快照中找到出处', () => {
    fc.assert(
      fc.property(
        worldArb.chain((world) => specArbFor(world).map((spec) => ({ world, spec }))),
        ({ world, spec }) => {
          // 前置:生成的 spec 必过零字面校验器(生成器正确性自检)。
          expect(validateSpec(spec)).toEqual({ valid: true });
          // bind 级并行遍历(derefSpec 对非字典根有 {value} 包装,属词条
          // props 入口约定,在 deref.test.ts 单测覆盖;溯源断言走同构输出)。
          const out = deref(spec.bind, world.cache);
          assertProvenance(spec.bind, out, valueUniverse(world), world, 'props');
        },
      ),
      { numRuns: 150 },
    );
  });

  it('随机注入字面载荷(任意位置/任意类型)→ 校验器必拒且路径指向注入点', () => {
    fc.assert(
      fc.property(
        worldArb
          .chain((world) => specArbFor(world).map((spec) => ({ world, spec })))
          .chain((seed) => {
            const positions = positionsOf(seed.spec.bind, [], 'bind');
            return fc
              .constantFrom(...positions)
              .map((position) => ({ spec: seed.spec, position }));
          }),
        literalArb,
        ({ spec, position }, literal) => {
          const injected: RenderSpec = {
            ...spec,
            bind: setAt(spec.bind, position.path, literal),
          };
          const validation = validateSpec(injected);
          expect(validation.valid).toBe(false);
          if (!validation.valid) {
            expect(
              validation.errors.some((error) => error.path === position.label),
              `错误路径应指向注入点 ${position.label},实际 ${validation.errors
                .map((e) => e.path)
                .join(',')}`,
            ).toBe(true);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
