import { describe, expect, it } from 'vitest';

import type { LogEvent } from './fold';
import {
  APPLICATION_BUNDLE_SCHEMA,
  assertMetaBootstrapIntegrity,
  parseApplicationBundle,
  planMetaBootstrap,
} from './meta-bootstrap';

const artifact = {
  schema: APPLICATION_BUNDLE_SCHEMA,
  bundle: { name: 'test-app', version: 1 },
  applications: [
    { name: 'default', title: '默认应用', intent: '兜底' },
    { name: 'publishing', title: '发布', intent: '发布内容' },
  ],
  capabilities: [
    {
      name: 'draft',
      title: '起草',
      kind: 'extract',
      intent: '起草正文',
      input: '上下文',
      output: '草稿',
    },
  ],
  flows: [
    {
      name: 'post-status',
      title: '文章状态',
      app: 'publishing',
      initial: 'published',
      nodes: [{ name: 'published', title: '已发布', fields: [], actions: [] }],
      fields: [],
    },
  ],
  seed: {
    rel: 'seed:test-app',
    detail: {
      instances: {
        'post:first': {
          rel: 'post:first',
          flow: 'post-status',
          node: 'published',
          fields: { title: { value: '第一篇', origin: 'default' } },
        },
      },
      collections: { articles: ['post:first'] },
    },
  },
} as const;

describe('meta application bundle bootstrap', () => {
  it('解析并规范化独立应用制品，业务定义不是安装器代码常量', () => {
    const parsed = parseApplicationBundle(artifact);
    expect(parsed.bundle).toEqual({ name: 'test-app', version: 1 });
    expect(parsed.flows[0]).toMatchObject({ name: 'post-status', app: 'publishing' });
    expect(parsed.seed.detail.instances['post:first']?.flow).toBe('post-status');
  });

  it('空日志按 app → capability → flow → seed → receipt 规划 meta 安装事件', () => {
    const bundle = parseApplicationBundle(artifact);
    const events = planMetaBootstrap(bundle, []);

    expect(events.map((event) => event.kind)).toEqual([
      'application-seeded',
      'application-seeded',
      'capability-seeded',
      'definition-seeded',
      'seed',
      'meta-bootstrap-applied',
    ]);
    expect(events.at(-1)).toMatchObject({
      rel: 'meta/bootstrap:test-app@1',
      actor: 'agent',
      channel: 'meta',
      detail: {
        bundle: { name: 'test-app', version: 1 },
        installed: { applications: 2, capabilities: 1, flows: 1, seed: true },
        inventory: {
          applications: ['default', 'publishing'],
          capabilities: ['draft'],
          flows: ['post-status'],
          seedRel: 'seed:test-app',
        },
      },
    });
    const stored = events.map((event, index) => ({ ...event, seq: index + 1 })) as LogEvent[];
    expect(() => assertMetaBootstrapIntegrity(stored)).not.toThrow();
    expect(() =>
      assertMetaBootstrapIntegrity(stored.filter((event) => event.kind !== 'definition-seeded')),
    ).toThrow(/runtime 定义缺失.*post-status/);
  });

  it('同版本 receipt 在场时幂等；旧库部分种子在场时只补缺项再写 receipt', () => {
    const bundle = parseApplicationBundle(artifact);
    const installed = planMetaBootstrap(bundle, []).map((event, index) => ({
      ...event,
      seq: index + 1,
    })) as LogEvent[];
    expect(planMetaBootstrap(bundle, installed)).toEqual([]);

    const partial: LogEvent[] = [
      installed[0]!,
      installed.find((event) => event.kind === 'definition-seeded')!,
      installed.find((event) => event.kind === 'seed')!,
    ];
    const migrated = planMetaBootstrap(bundle, partial);
    expect(migrated.map((event) => event.kind)).toEqual([
      'application-seeded',
      'capability-seeded',
      'meta-bootstrap-applied',
    ]);
    expect(migrated.at(-1)?.detail).toMatchObject({
      installed: { applications: 1, capabilities: 1, flows: 0, seed: false },
    });

    const legacyReceipt = {
      ...installed.at(-1)!,
      detail: { bundle: { name: 'test-app', version: 1 }, installed: {} },
    } as LogEvent;
    const upgraded = planMetaBootstrap(bundle, [...installed.slice(0, -1), legacyReceipt]);
    expect(upgraded.map((event) => event.kind)).toEqual(['meta-bootstrap-applied']);
    expect(() =>
      assertMetaBootstrapIntegrity([
        ...installed.slice(0, -1),
        legacyReceipt,
        { ...upgraded[0]!, seq: 99 } as LogEvent,
      ]),
    ).not.toThrow();
  });

  it('拒绝 flow 指向未安装 application、seed 指向未知 flow 的制品', () => {
    expect(() =>
      parseApplicationBundle({
        ...artifact,
        flows: [{ ...artifact.flows[0], app: 'missing' }],
      }),
    ).toThrow(/application.*missing/);

    expect(() =>
      parseApplicationBundle({
        ...artifact,
        seed: {
          ...artifact.seed,
          detail: {
            ...artifact.seed.detail,
            instances: {
              ...artifact.seed.detail.instances,
              'post:bad': {
                ...artifact.seed.detail.instances['post:first'],
                rel: 'post:bad',
                flow: 'missing-flow',
              },
            },
          },
        },
      }),
    ).toThrow(/seed.*post:bad.*missing-flow/);
  });
});
