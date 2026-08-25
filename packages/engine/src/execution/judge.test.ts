import { describe, expect, it } from 'vitest';

import type { GuardRegistry } from '@ui4a/shared';

import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
  seedSnapshot,
} from '../core/fixtures';
import { judge } from './judge';
import type { ExecRequest, JudgeResult } from './judge';

/** 与种子谓词同义的测试注册表(实现在 Task 3 挪进 @ui4a/shared)。 */
const testGuards: GuardRegistry = {
  'is-pending': (ctx) => ctx.instance.node === 'pending',
  'is-published': (ctx) => ctx.instance.node === 'published',
  'always-true': () => true,
  'always-false': () => false,
};

const deps = {
  flows: flowRegistry(articleDraftingFlow, postStatusFlow, commentModerationFlow),
  guards: testGuards,
};

/** 便捷 exec。 */
function exec(
  rel: string,
  action: string,
  params?: Record<string, unknown>,
  overrides?: { guards?: GuardRegistry },
): JudgeResult {
  return judge({ rel, action, params }, seedSnapshot, {
    flows: deps.flows,
    guards: overrides?.guards ?? deps.guards,
  });
}

describe('三层裁决 — 通过路径', () => {
  it('声明+guard+schema 全过 → accepted,携带动作声明、规范化效果与字段 schema', () => {
    const result = exec('comment:c1', 'approve');
    expect(result).toEqual({
      kind: 'accepted',
      // T3 机械适配:accepted 结果携带动作声明(确认门读 requires-confirmation 标注)。
      action: commentModerationFlow.nodes[0].actions.find((a) => a.name === 'approve'),
      guards: [{ name: 'is-pending', pass: true }],
      effects: [{ type: 'transition', to: 'approved' }],
      schema: expect.objectContaining({ type: 'object' }),
    });
  });

  it('带字段动作参数合法 → accepted,schema 含字段定义(select 枚举)', () => {
    const result = exec('article-drafting:main', 'next', {
      category: 'tech',
      tags: 'ui4a, siren',
    });
    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') return;
    expect(result.effects).toEqual([{ type: 'transition', to: 'content' }]);
    expect(result.schema).toMatchObject({
      type: 'object',
      required: ['category'],
      properties: expect.objectContaining({
        category: { type: 'string', enum: ['tech', 'essay', 'review'] },
        tags: { type: 'string' },
      }),
    });
  });
});

describe('三层裁决 — 顺序铁律(arch-brief §3:声明 → guard → schema,不可换)', () => {
  it('① 未声明动作 且 guard 也不满足 → layer=undeclared(不是 guard-failed)', () => {
    // comment:c4 在 approved 节点:approve 未声明于该节点,同时 is-pending 也不满足。
    const result = exec('comment:c4', 'approve');
    expect(result).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    expect(JSON.stringify(result)).not.toContain('guard-failed');
  });

  it('① 动作声明于其他节点 → undeclared', () => {
    expect(exec('post:post-welcome', 'approve')).toMatchObject({
      kind: 'rejected',
      layer: 'undeclared',
    });
  });

  it('① 实体 rel 不存在 → undeclared', () => {
    const result = exec('post:ghost', 'unpublish');
    expect(result).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });

  it('② guard 不满足 且 schema 也不满足 → layer=guard-failed(schema 层不再执行)', () => {
    const registry: GuardRegistry = { ...testGuards, 'is-pending': () => false };
    const result = exec(
      'comment:c1',
      'approve',
      { junk: 'schema 也会挂' },
      {
        guards: registry,
      },
    );
    expect(result).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
  });

  it('② 多 guard 全部求值(不短路),任一 false 即拒,原因含谓词名与求值结果', () => {
    const flowWithGuards = JSON.parse(JSON.stringify(commentModerationFlow));
    flowWithGuards.nodes[0].actions[0].guards = ['always-true', 'always-false', 'is-pending'];
    const result = judge({ rel: 'comment:c1', action: 'approve' }, seedSnapshot, {
      flows: flowRegistry(flowWithGuards),
      guards: testGuards,
    });
    expect(result).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (result.kind !== 'rejected') return;
    const evaluations = result.detail as Array<{ name: string; pass: boolean }>;
    expect(evaluations).toEqual([
      { name: 'always-true', pass: true },
      { name: 'always-false', pass: false },
      { name: 'is-pending', pass: true },
    ]);
    expect(result.reason).toContain('always-false=false');
  });

  it('② 未注册的 guard 名 → fail-closed 拒绝,原因注明未注册', () => {
    const flowWithGuards = JSON.parse(JSON.stringify(commentModerationFlow));
    flowWithGuards.nodes[0].actions[0].guards = ['ghost-guard'];
    const result = judge({ rel: 'comment:c1', action: 'approve' }, seedSnapshot, {
      flows: flowRegistry(flowWithGuards),
      guards: testGuards,
    });
    expect(result).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (result.kind !== 'rejected') return;
    expect(result.reason).toContain('ghost-guard');
    expect(JSON.stringify(result)).toContain('未注册');
  });

  it('③ 声明与 guard 均过、schema 挂 → layer=schema-invalid 且含 Ajv errors', () => {
    const result = exec('article-drafting:main', 'next', { tags: 'x' }); // 缺必填 category
    expect(result).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    if (result.kind !== 'rejected') return;
    const errors = result.detail as Array<{ instancePath: string; keyword: string }>;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });
});

describe('三层裁决 — schema 层矩阵', () => {
  it('类型不符(number 当 string)→ 拒绝', () => {
    expect(exec('article-drafting:main', 'next', { category: 42 })).toMatchObject({
      layer: 'schema-invalid',
    });
  });

  it('枚举外取值 → 拒绝', () => {
    expect(exec('article-drafting:main', 'next', { category: 'news' })).toMatchObject({
      layer: 'schema-invalid',
    });
  });

  it('多余参数 → 拒绝(additionalProperties: false,合同严格)', () => {
    const result = exec('comment:c1', 'approve', { spam: 1 });
    expect(result).toMatchObject({ layer: 'schema-invalid' });
    expect(JSON.stringify(result)).toContain('additionalProperties');
  });

  it('textarea 字段随节点校验,content 步提交 body → accepted 且 schema 含 format=textarea', () => {
    const snapshot = {
      ...seedSnapshot,
      instances: {
        ...seedSnapshot.instances,
        'article-drafting:main': {
          ...seedSnapshot.instances['article-drafting:main'],
          node: 'content',
        },
      },
    };
    const result = judge(
      { rel: 'article-drafting:main', action: 'next', params: { body: '正文内容' } },
      snapshot,
      deps,
    );
    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') return;
    const properties = result.schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.body).toMatchObject({ type: 'string', format: 'textarea' });
  });
});

describe('judge 纯函数性', () => {
  it('裁决不改动输入快照(拒绝路径)', () => {
    const before = JSON.stringify(seedSnapshot);
    exec('comment:c4', 'approve', { junk: 1 });
    expect(JSON.stringify(seedSnapshot)).toBe(before);
  });

  it('ExecRequest 完整字段(actor/principal/channel/paramOrigins)可携带不报错', () => {
    const request: ExecRequest = {
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      principal: 'user-mike',
      channel: 'chat',
      paramOrigins: {},
    };
    expect(judge(request, seedSnapshot, deps)).toMatchObject({ kind: 'accepted' });
  });
});
