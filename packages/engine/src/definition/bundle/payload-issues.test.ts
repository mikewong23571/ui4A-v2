import { describe, expect, it } from 'vitest';

import { APPLICATION_BUNDLE_SCHEMA, parseApplicationBundle } from '../meta-bootstrap';
import { validateApplicationBundleDraft } from './application-bundle-draft';
import { applicationBundleIssues } from './payload-issues';

// T50 Phase 2 / D69.3 拒绝数据化:parseApplicationBundle 内部错误结构化为
// {code, path, message, expected},validateApplicationBundleDraft 透传;抛出式
// 公共行为零变化(首条 issue 的 message 即抛出文案,逐字一致)。
type Json = Record<string, unknown>;

function dig(node: unknown, ...segments: (string | number)[]): unknown {
  let current: unknown = node;
  for (const segment of segments) {
    current = (current as Json)[segment];
  }
  return current;
}

function bundle(): Json {
  return {
    schema: APPLICATION_BUNDLE_SCHEMA,
    bundle: { name: 'demo-bundle', version: 1 },
    applications: [{ name: 'demo-bundle', title: 'Demo', intent: 'Demonstrate a governed bundle' }],
    capabilities: [],
    flows: [
      {
        name: 'demo-entry',
        title: 'Demo entry',
        app: 'demo-bundle',
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    ],
    seed: { rel: 'seed:demo-bundle', detail: { instances: {} } },
  };
}

function thrownMessage(payload: unknown): string {
  try {
    parseApplicationBundle(payload);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected parseApplicationBundle to throw');
}

function withInstance(payload: Json, key: string, instance: Json): Json {
  (dig(payload, 'seed', 'detail', 'instances') as Json)[key] = instance;
  return payload;
}

describe('applicationBundleIssues:结构化拒绝', () => {
  it('seed 条目缺 fields:path 精确到条目、expected 给出四必填形状、message 与现状逐字一致', () => {
    const payload = withInstance(bundle(), 'todo-item', {
      rel: 'todo-item',
      flow: 'demo-entry',
      node: 'start',
    });
    const [issue] = applicationBundleIssues(payload);
    expect(issue).toEqual({
      code: 'parse-error',
      path: 'seed.instances.todo-item',
      message: 'application bundle seed instance "todo-item" 形状非法',
      expected: { required: ['rel', 'flow', 'node', 'fields'], note: 'key 必须等于 rel' },
    });
    expect(thrownMessage(payload)).toBe('application bundle seed instance "todo-item" 形状非法');
  });

  it('顶层必填键缺失:path 精确到键、expected 在场、message 与现状逐字一致', () => {
    const missingSchema = bundle();
    delete missingSchema.schema;
    expect(applicationBundleIssues(missingSchema)[0]).toEqual({
      code: 'parse-error',
      path: 'schema',
      message: 'application bundle schema 必须是 https://ui4a.dev/application-bundle/v1',
      expected: 'https://ui4a.dev/application-bundle/v1',
    });
    expect(thrownMessage(missingSchema)).toBe(
      'application bundle schema 必须是 https://ui4a.dev/application-bundle/v1',
    );

    const missingBundle = bundle();
    delete missingBundle.bundle;
    expect(applicationBundleIssues(missingBundle)[0]).toMatchObject({
      code: 'parse-error',
      path: 'bundle',
      expected: { type: 'object', required: ['name', 'version'] },
    });
    expect(thrownMessage(missingBundle)).toBe('application bundle bundle 必须是对象');

    const missingFlows = bundle();
    delete missingFlows.flows;
    expect(applicationBundleIssues(missingFlows)[0]).toMatchObject({
      code: 'parse-error',
      path: 'flows',
      expected: { type: 'array' },
    });
    expect(thrownMessage(missingFlows)).toBe(
      'application bundle applications/capabilities/flows 必须是数组',
    );
  });

  it('bundle.version 非正整数:path 精确、expected 给出整数下界', () => {
    const payload = bundle();
    (payload.bundle as Json).version = 0;
    expect(applicationBundleIssues(payload)[0]).toMatchObject({
      code: 'parse-error',
      path: 'bundle.version',
      message: 'application bundle bundle.version 必须是正整数',
      expected: { type: 'integer', minimum: 1 },
    });
    expect(thrownMessage(payload)).toBe('application bundle bundle.version 必须是正整数');
  });

  it('非对象根:issue 落在 /,给出期望对象形状', () => {
    for (const payload of [null, undefined, 42, 'demo-bundle', [], true]) {
      expect(applicationBundleIssues(payload)).toEqual([
        {
          code: 'parse-error',
          path: '/',
          message: 'application bundle 必须是对象',
          expected: { type: 'object' },
        },
      ]);
    }
  });

  it('seed 条目 key 与 rel 不一致、flow 缺失分别产出精确定位', () => {
    const mismatched = withInstance(bundle(), 'todo-item', {
      rel: 'other-rel',
      flow: 'demo-entry',
      node: 'start',
      fields: {},
    });
    expect(applicationBundleIssues(mismatched)[0]).toMatchObject({
      path: 'seed.instances.todo-item',
      message: 'application bundle seed instance key "todo-item" 与 rel "other-rel" 不一致',
    });

    const noFlow = withInstance(bundle(), 'todo-item', {
      rel: 'todo-item',
      node: 'start',
      fields: {},
    });
    expect(applicationBundleIssues(noFlow)[0]).toMatchObject({
      path: 'seed.instances.todo-item.flow',
      message: 'application bundle seed.instances.todo-item.flow 必须是非空字符串',
    });
  });

  it('元素级解析失败:path 指向元素下标,message 与子解析器抛出文案逐字一致', () => {
    const payload = bundle();
    (payload.applications as Json[])[0] = { name: 'demo-bundle', title: '', intent: 'Demo' };
    const [issue] = applicationBundleIssues(payload);
    expect(issue).toMatchObject({
      code: 'invalid-application',
      path: 'applications[0]',
      message: '非法 application 定义:\n  - title: title 必须是非空字符串',
    });
    expect(thrownMessage(payload)).toBe(
      '非法 application 定义:\n  - title: title 必须是非空字符串',
    );
  });

  it('跨引用失败:code 数据化且 message 与现状逐字一致', () => {
    const payload = bundle();
    (payload.flows as Json[])[0]!.app = 'missing';
    expect(applicationBundleIssues(payload)[0]).toMatchObject({
      code: 'unknown-reference',
      path: 'flows.demo-entry.app',
      message: 'application bundle flow "demo-entry" 引用未知 application "missing"',
    });
    expect(thrownMessage(payload)).toBe(
      'application bundle flow "demo-entry" 引用未知 application "missing"',
    );
  });

  it('一次收集全部结构问题(拒绝即教育,不逐个往返)', () => {
    const payload = bundle();
    (payload.bundle as Json).name = '';
    delete payload.capabilities;
    const issues = applicationBundleIssues(payload);
    expect(issues.map((issue) => issue.path)).toEqual(['bundle.name', 'capabilities']);
  });

  it('合法 bundle:结构化通道零问题,抛出通道正常返回', () => {
    expect(applicationBundleIssues(bundle())).toEqual([]);
    expect(parseApplicationBundle(bundle()).bundle).toEqual({ name: 'demo-bundle', version: 1 });
  });
});

describe('抛出通道公共行为零变化(D69.3)', () => {
  const cases: Record<string, unknown> = {
    根非对象: 42,
    schema不符: { ...bundle(), schema: 'https://example.com/other/v9' },
    bundle名空: { ...bundle(), bundle: { name: '', version: 1 } },
    applications非数组: { ...bundle(), applications: 'x' },
    seed非对象: { ...bundle(), seed: 'x' },
    seedRel空: { ...bundle(), seed: { rel: '', detail: { instances: {} } } },
    collections非字符串数组: {
      ...bundle(),
      seed: { rel: 'seed:demo-bundle', detail: { instances: {}, collections: { articles: 'x' } } },
    },
  };

  it('每类非法载荷:抛出文案 === 首条结构化 issue 的 message', () => {
    for (const [name, payload] of Object.entries(cases)) {
      const issues = applicationBundleIssues(payload);
      expect(issues.length, `${name} 应至少产出一条 issue`).toBeGreaterThan(0);
      expect(thrownMessage(payload), `${name} 抛出文案应与首条 issue 一致`).toBe(issues[0].message);
    }
  });
});

describe('validateApplicationBundleDraft 透传(D69.3)', () => {
  it('结构化 issue 原样进入 Draft 校验合同(expected 在场,内部 cause 不泄漏)', () => {
    const payload = withInstance(bundle(), 'todo-item', {
      rel: 'todo-item',
      flow: 'demo-entry',
      node: 'start',
    });
    const validation = validateApplicationBundleDraft(payload);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual([
      {
        code: 'parse-error',
        path: 'seed.instances.todo-item',
        message: 'application bundle seed instance "todo-item" 形状非法',
        expected: { required: ['rel', 'flow', 'node', 'fields'], note: 'key 必须等于 rel' },
      },
    ]);
    expect(validation.value).toBeUndefined();
  });

  it('合法 payload 透传后仍返回规范化 value', () => {
    const validation = validateApplicationBundleDraft(bundle());
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.value).toMatchObject({ bundle: { name: 'demo-bundle', version: 1 } });
  });
});
