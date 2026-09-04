import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import {
  APPLICATION_ENTRY_ROLES,
  COGNITIVE_SEMANTICS_EMPTY_MEANINGS,
  COGNITIVE_SEMANTICS_GROUP_ROLES,
  COGNITIVE_SEMANTICS_PRIORITIES,
  COGNITIVE_SEMANTICS_TRAITS,
} from '@ui4a/shared';

// 钉版快照:apps/web/src/applications/ 下四个已安装 bundle 工件的只读副本。
// web 侧更新内置应用时需同步刷新本目录(D69.2 fixture 回环是防漂移不变量)。
import ideasArtifact from './test-fixtures/ideas.bundle.json';
import securityArtifact from './test-fixtures/security.bundle.json';
import todoArtifact from './test-fixtures/todo.bundle.json';
import walkthroughArtifact from './test-fixtures/ui4a-walkthrough.bundle.json';

import { parseApplicationBundle } from '../meta-bootstrap';
import { applicationBundlePayloadSchema } from './payload-schema';

const { schema, example } = applicationBundlePayloadSchema();

type Json = Record<string, unknown>;

function dig(node: unknown, ...segments: (string | number)[]): unknown {
  let current: unknown = node;
  for (const segment of segments) {
    current = (current as Json)[segment];
  }
  return current;
}

function validator(): (data: unknown) => boolean {
  return new Ajv({ allErrors: true, strict: false }).compile(schema) as (data: unknown) => boolean;
}

function cloneExample(): Json {
  return JSON.parse(JSON.stringify(example)) as Json;
}

describe('applicationBundlePayloadSchema:结构层覆盖', () => {
  it('六个顶层必填键缺失任一即整体拒绝', () => {
    const validate = validator();
    for (const key of ['schema', 'bundle', 'applications', 'capabilities', 'flows', 'seed']) {
      const candidate = cloneExample();
      delete candidate[key];
      expect(validate(candidate), `缺少顶层键 ${key} 应被拒绝`).toBe(false);
    }
  });

  it('类型层:根对象、bundle 形状、name/version、数组类型逐项生效', () => {
    const validate = validator();
    expect(validate(null)).toBe(false);
    expect(validate(42)).toBe(false);
    expect(validate('demo-bundle')).toBe(false);
    expect(validate([])).toBe(false);
    expect(validate({ ...cloneExample(), bundle: 'demo-bundle' })).toBe(false);
    expect(validate({ ...cloneExample(), bundle: { name: '', version: 1 } })).toBe(false);
    for (const version of [0, -1, 1.5, '1', null]) {
      expect(
        validate({ ...cloneExample(), bundle: { name: 'demo-bundle', version } }),
        `bundle.version=${String(version)} 应被拒绝`,
      ).toBe(false);
    }
    expect(validate({ ...cloneExample(), applications: {} })).toBe(false);
    expect(validate({ ...cloneExample(), capabilities: 'none' })).toBe(false);
    expect(validate({ ...cloneExample(), flows: null })).toBe(false);
    expect(validate({ ...cloneExample(), seed: [] })).toBe(false);
  });

  it('schema 词表封闭:唯一合法取值是安装合同声明的 URL', () => {
    const validate = validator();
    expect(dig(schema, 'properties', 'schema')).toEqual({
      enum: ['https://ui4a.dev/application-bundle/v1'],
    });
    expect(validate({ ...cloneExample(), schema: 'https://example.com/other/v9' })).toBe(false);
  });

  it('seed 条目四必填形状:缺 rel/flow/node/fields 任一即拒绝', () => {
    const validate = validator();
    const base = cloneExample();
    const seed = dig(base, 'seed') as Json;
    const detail = seed.detail as Json;
    for (const key of ['rel', 'flow', 'node', 'fields']) {
      const instance = {
        ...((detail.instances as Json)['example-entry:first'] as Json),
      } as Json;
      delete instance[key];
      const candidate = cloneExample();
      ((dig(candidate, 'seed', 'detail') as Json).instances as Json)['example-entry:first'] =
        instance;
      expect(validate(candidate), `seed 条目缺 ${key} 应被拒绝`).toBe(false);
    }
    // fields 必须是对象,不能是数组或标量。
    for (const fields of [[], 'x', 42]) {
      const candidate = cloneExample();
      (
        (dig(candidate, 'seed', 'detail', 'instances') as Json)['example-entry:first'] as Json
      ).fields = fields;
      expect(validate(candidate), `seed 条目 fields=${JSON.stringify(fields)} 应被拒绝`).toBe(
        false,
      );
    }
    // collections 值必须是字符串数组。
    const badCollections = cloneExample();
    (dig(badCollections, 'seed', 'detail') as Json).collections = { articles: 'post:first' };
    expect(validate(badCollections)).toBe(false);
  });

  it('封闭词表 enum 与 shared 常量同源(emptyMeaning 含 ready-to-start)', () => {
    expect(dig(schema, 'properties', 'schema')).toEqual({
      enum: ['https://ui4a.dev/application-bundle/v1'],
    });
    expect(dig(schema, 'properties', 'capabilities', 'items', 'properties', 'kind')).toEqual({
      enum: ['transform', 'extract', 'effect'],
    });
    expect(
      dig(
        schema,
        'properties',
        'applications',
        'items',
        'properties',
        'entry',
        'properties',
        'role',
      ),
    ).toEqual({ enum: [...APPLICATION_ENTRY_ROLES] });
    expect(dig(schema, 'definitions', 'cognitive', 'properties', 'traits')).toEqual({
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { enum: [...COGNITIVE_SEMANTICS_TRAITS] },
    });
    expect(dig(schema, 'definitions', 'cognitive', 'properties', 'groupRole')).toEqual({
      enum: [...COGNITIVE_SEMANTICS_GROUP_ROLES],
    });
    expect(dig(schema, 'definitions', 'cognitive', 'properties', 'priority')).toEqual({
      enum: [...COGNITIVE_SEMANTICS_PRIORITIES],
    });
    expect(dig(schema, 'definitions', 'cognitive', 'properties', 'emptyMeaning')).toEqual({
      enum: [...COGNITIVE_SEMANTICS_EMPTY_MEANINGS],
    });
    expect(COGNITIVE_SEMANTICS_EMPTY_MEANINGS).toContain('ready-to-start');
  });

  it('flows[].cognitive 通过 $ref 复用封闭词表定义', () => {
    expect(dig(schema, 'properties', 'flows', 'items', 'properties', 'cognitive')).toEqual({
      $ref: '#/definitions/cognitive',
    });
    const validate = validator();
    const badCognitive = cloneExample();
    (dig(badCognitive, 'flows') as Json[])[0]!.cognitive = {
      version: 1,
      traits: ['work-queue'],
      emptyMeaning: 'made-up-meaning',
    };
    expect(validate(badCognitive)).toBe(false);
  });
});

describe('applicationBundlePayloadSchema:深层开放', () => {
  it('flows/nodes/applications 元素与 seed 条目接受未知额外键', () => {
    const validate = validator();
    const candidate = cloneExample();
    candidate.unknownTopLevelKey = { free: true };
    const flows = candidate.flows as Json[];
    flows[0] = { ...flows[0]!, unknownFlowKey: { any: 'thing' } };
    const nodes = [...(flows[0]!.nodes as Json[])];
    nodes[0] = { ...nodes[0]!, unknownNodeKey: [1, 2, 3] };
    flows[0] = { ...flows[0]!, nodes };
    const applications = candidate.applications as Json[];
    applications[0] = { ...applications[0]!, futureKey: 'open' };
    const instances = dig(candidate, 'seed', 'detail', 'instances') as Json;
    instances['example-entry:first'] = {
      ...(instances['example-entry:first'] as Json),
      snapshotMeta: { keep: 'open' },
    };
    expect(validate(candidate)).toBe(true);
  });

  it('capabilities 元素除必填四键外保持开放(嵌套 schema 对象自由携带)', () => {
    const validate = validator();
    const candidate = cloneExample();
    (candidate.capabilities as Json[]).push({
      name: 'example.capability',
      title: 'Example capability',
      kind: 'transform',
      intent: 'Demonstrate openness',
      inputSchema: { type: 'object', properties: { anything: true } },
      scope: { applications: ['example-bundle'] },
    });
    expect(validate(candidate)).toBe(true);
  });
});

describe('applicationBundlePayloadSchema:序列化尺寸上限', () => {
  it('JSON.stringify(schema) ≤ 4000 字符(prompt 膨胀防线)', () => {
    expect(JSON.stringify(schema).length).toBeLessThanOrEqual(4000);
  });
});

describe('applicationBundlePayloadSchema:example 是最小合法 bundle', () => {
  it('可被 parseApplicationBundle 接受,且通过派生 schema 自洽校验', () => {
    expect(() => parseApplicationBundle(example)).not.toThrow();
    expect(parseApplicationBundle(example).bundle).toEqual({ name: 'example-bundle', version: 1 });
    expect(validator()(example)).toBe(true);
  });
});

describe('fixture 回环(D69.2 防漂移不变量)', () => {
  const fixtures: Record<string, unknown> = {
    'todo.bundle.json': todoArtifact,
    'ideas.bundle.json': ideasArtifact,
    'security.bundle.json': securityArtifact,
    'ui4a-walkthrough.bundle.json': walkthroughArtifact,
  };

  for (const [name, artifact] of Object.entries(fixtures)) {
    it(`派生 schema 结构化接受已安装工件 ${name}`, () => {
      expect(validator()(artifact), `${name} 必须通过结构层 schema`).toBe(true);
    });
  }

  it('回环测试自身有效:破坏工件结构层即被 schema 拒绝', () => {
    const validate = validator();
    const broken = JSON.parse(JSON.stringify(todoArtifact)) as Json;
    (broken.bundle as Json).version = '7';
    expect(validate(broken)).toBe(false);
    const brokenSeed = JSON.parse(JSON.stringify(todoArtifact)) as Json;
    const instances = dig(brokenSeed, 'seed', 'detail', 'instances') as Json;
    const firstKey = Object.keys(instances)[0]!;
    instances[firstKey] = { ...(instances[firstKey] as Json), fields: 'not-an-object' };
    expect(validate(brokenSeed)).toBe(false);
  });
});
