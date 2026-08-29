import { describe, expect, it } from 'vitest';

import {
  articleDraftingFlow,
  commentModerationFlow,
  minimalFlow,
  postStatusFlow,
} from './fixtures';
import {
  AppParseError,
  CapabilityParseError,
  FlowParseError,
  parseApplicationDefinition,
  parseCapabilityDefinition,
  parseFlowDefinition,
  validateFlowDefinition,
} from './parse';
import type { FlowDefinition } from './types';

/** 深拷贝 + 局部覆盖,构造"被破坏"的 flow 定义(纯 JSON fixture,JSON 往返即可)。 */
function flowWith(flow: FlowDefinition, patch: (draft: FlowDefinition) => void): FlowDefinition {
  const draft = JSON.parse(JSON.stringify(flow)) as FlowDefinition;
  patch(draft);
  return draft;
}

describe('parseFlowDefinition — 规范化', () => {
  it('补默认值:method=POST、guards=[]、fields=[]、effect 数组化、title 回退 name', () => {
    const parsed = parseFlowDefinition(minimalFlow);
    expect(parsed.title).toBe('tiny');
    const node = parsed.nodes[0];
    expect(node.title).toBe('a');
    expect(node.fields).toEqual([]);
    const action = node.actions[0];
    expect(action.method).toBe('POST');
    expect(action.guards).toEqual([]);
    expect(action.fields).toEqual([]);
    expect(action.effect).toEqual([{ type: 'transition', to: 'b' }]);
  });

  it('接受 spec 形状的 article-drafting 并保留全部声明', () => {
    const parsed = parseFlowDefinition(articleDraftingFlow);
    expect(parsed.name).toBe('article-drafting');
    expect(parsed.initial).toBe('basic-info');
    expect(parsed.nodes.map((n) => n.name)).toEqual([
      'basic-info',
      'classification',
      'content',
      'ready',
      'done',
    ]);
    const publish = parsed.nodes[3].actions[0];
    expect(publish.effect).toEqual([
      { type: 'transition', to: 'done' },
      {
        type: 'append',
        collection: 'articles',
        'resource-type': 'post',
        'name-from': 'title',
        node: 'published',
      },
    ]);
  });

  it('requires-confirmation 与字段语义原样保留(不生效但可携带)', () => {
    const parsed = parseFlowDefinition(postStatusFlow);
    expect(parsed.nodes[0].actions[1]['requires-confirmation']).toBe('high');
    expect(parsed.nodes[0].actions[1].guards).toEqual([]);
  });

  it('保留字段的呈现语义与 contentMediaType', () => {
    const parsed = parseFlowDefinition({
      ...minimalFlow,
      fields: [
        {
          name: 'body',
          type: 'textarea',
          title: '正文',
          presentation: { role: 'primary-content' },
          contentMediaType: 'text/markdown',
        },
      ],
    });

    expect(parsed.fields).toEqual([
      expect.objectContaining({
        name: 'body',
        presentation: { role: 'primary-content' },
        contentMediaType: 'text/markdown',
      }),
    ]);
  });
});

describe('parseFlowDefinition — 拒绝非法定义', () => {
  it('非对象输入直接拒绝', () => {
    expect(() => parseFlowDefinition('not-a-flow')).toThrow(FlowParseError);
    expect(() => parseFlowDefinition(undefined)).toThrow(FlowParseError);
  });

  it('缺 nodes / nodes 非数组拒绝', () => {
    expect(() => parseFlowDefinition({ name: 'x', initial: 'a' })).toThrow(FlowParseError);
    expect(() => parseFlowDefinition({ name: 'x', initial: 'a', nodes: 'nope' })).toThrow(
      FlowParseError,
    );
  });

  it('initial 不存在于 nodes 拒绝,issue 带 path', () => {
    expect(() => parseFlowDefinition(flowWith(minimalFlow, (d) => (d.initial = 'zzz')))).toThrow(
      /initial/,
    );
  });

  it('重复节点名拒绝', () => {
    expect(() =>
      parseFlowDefinition(flowWith(minimalFlow, (d) => (d.nodes[1].name = 'a'))),
    ).toThrow(/重复/);
  });

  it('action.to 指向不存在的节点拒绝', () => {
    expect(() =>
      parseFlowDefinition(flowWith(minimalFlow, (d) => (d.nodes[0].actions[0].to = 'ghost'))),
    ).toThrow(/to/);
  });

  it('未知 effect 类型拒绝', () => {
    expect(() =>
      parseFlowDefinition(
        flowWith(
          minimalFlow,
          (d) => ((d.nodes[0].actions[0] as { effect: unknown }).effect = [{ type: 'explode' }]),
        ),
      ),
    ).toThrow(/effect/);
  });

  it('select 字段缺 options 拒绝', () => {
    expect(() =>
      parseFlowDefinition(
        flowWith(articleDraftingFlow, (d) => {
          const category = d.nodes[1].fields?.find((f) => f.name === 'category');
          if (category) delete (category as { options?: string[] }).options;
        }),
      ),
    ).toThrow(/category|options/);
  });

  it('节点内重复 action 名 / 重复字段名拒绝', () => {
    expect(() =>
      parseFlowDefinition(
        flowWith(minimalFlow, (d) => d.nodes[0].actions.push({ ...d.nodes[0].actions[0] })),
      ),
    ).toThrow(/重复/);
    expect(() =>
      parseFlowDefinition(
        flowWith(articleDraftingFlow, (d) =>
          d.nodes[0].fields?.push({ name: 'title', type: 'text' }),
        ),
      ),
    ).toThrow(/重复/);
  });

  it('拒绝未知呈现角色和空 contentMediaType', () => {
    expect(() =>
      parseFlowDefinition({
        ...minimalFlow,
        fields: [{ name: 'title', type: 'text', presentation: { role: 'hero-banner' } }],
      }),
    ).toThrow(/presentation.*role/);

    expect(() =>
      parseFlowDefinition({
        ...minimalFlow,
        fields: [{ name: 'body', type: 'textarea', contentMediaType: '' }],
      }),
    ).toThrow(/contentMediaType/);
  });

  it('FlowParseError 携带结构化 issues(path + message)', () => {
    try {
      parseFlowDefinition(flowWith(minimalFlow, (d) => (d.initial = 'zzz')));
      expect.unreachable('应当抛出 FlowParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(FlowParseError);
      const issues = (error as FlowParseError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].path).toContain('initial');
      expect(issues[0].message).toBeTruthy();
    }
  });
});

describe('parseFlowDefinition — app 归属(T10 架构决定 2)', () => {
  it('无 app 字段归一化为 default', () => {
    const parsed = parseFlowDefinition(minimalFlow);
    expect(parsed.app).toBe('default');
  });

  it('显式 app 原样保留', () => {
    const parsed = parseFlowDefinition({ ...minimalFlow, app: 'publishing' });
    expect(parsed.app).toBe('publishing');
  });

  it('显式空字符串 parse 不拒(归一化原样保留,留给激活不变式 app-known 拒绝)', () => {
    const parsed = parseFlowDefinition({ ...minimalFlow, app: '' });
    expect(parsed.app).toBe('');
  });

  it('非字符串 app 拒绝,issues 含 app path', () => {
    try {
      parseFlowDefinition({ ...minimalFlow, app: 123 });
      expect.unreachable('应当抛出 FlowParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(FlowParseError);
      const issues = (error as FlowParseError).issues;
      expect(issues.some((i) => i.path === 'app')).toBe(true);
    }
  });
});

describe('validateFlowDefinition(已类型化定义的语义校验)', () => {
  it('对三个种子 flow 返回空 issue 列表', () => {
    expect(validateFlowDefinition(articleDraftingFlow)).toEqual([]);
    expect(validateFlowDefinition(postStatusFlow)).toEqual([]);
  });

  it('spawn effect 缺 capability 报 issue', () => {
    const issues = validateFlowDefinition(
      flowWith(
        minimalFlow,
        (d) => ((d.nodes[0].actions[0] as { effect: unknown }).effect = { type: 'spawn' }),
      ),
    );
    expect(issues.some((i) => i.path.includes('capability'))).toBe(true);
  });
});

describe('parseApplicationDefinition — 规范化', () => {
  it('合法定义解析通过(含 entry),显式值原样保留', () => {
    const parsed = parseApplicationDefinition({
      name: 'publishing',
      title: '内容发布',
      intent: '把草稿变成可发布的内容',
      entry: 'article-drafting',
    });
    expect(parsed).toEqual({
      name: 'publishing',
      title: '内容发布',
      intent: '把草稿变成可发布的内容',
      entry: 'article-drafting',
    });
  });

  it('合法定义解析通过(不含 entry)', () => {
    const parsed = parseApplicationDefinition({
      name: 'default',
      title: '默认应用',
      intent: '无归属 flow 的归一化兜底',
    });
    expect(parsed.name).toBe('default');
    expect(parsed.entry).toBeUndefined();
  });
});

describe('parseApplicationDefinition — 拒绝非法定义', () => {
  it('非对象输入直接拒绝', () => {
    expect(() => parseApplicationDefinition('not-an-app')).toThrow(AppParseError);
    expect(() => parseApplicationDefinition(undefined)).toThrow(AppParseError);
    expect(() => parseApplicationDefinition(['publishing'])).toThrow(AppParseError);
  });

  it('name/title/intent 缺失或为空字符串逐一被拒,issues 带对应 path', () => {
    const valid = { name: 'publishing', title: '内容发布', intent: '发布内容' };
    for (const field of ['name', 'title', 'intent']) {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[field];
      const empty = { ...valid, [field]: '' };
      for (const input of [missing, empty]) {
        try {
          parseApplicationDefinition(input);
          expect.unreachable('应当抛出 AppParseError');
        } catch (error) {
          expect(error).toBeInstanceOf(AppParseError);
          const issues = (error as AppParseError).issues;
          expect(issues.some((i) => i.path === field)).toBe(true);
        }
      }
    }
  });

  it('entry 存在时必须是非空字符串', () => {
    const valid = { name: 'publishing', title: '内容发布', intent: '发布内容' };
    expect(() => parseApplicationDefinition({ ...valid, entry: '' })).toThrow(/entry/);
    expect(() => parseApplicationDefinition({ ...valid, entry: 42 })).toThrow(/entry/);
  });

  it('AppParseError 全量携带 issues,消息风格与 FlowParseError 同构', () => {
    try {
      parseApplicationDefinition({ name: '', intent: '发布内容' });
      expect.unreachable('应当抛出 AppParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(AppParseError);
      expect((error as AppParseError).message).toContain('非法 application 定义:');
      const issues = (error as AppParseError).issues;
      expect(issues.map((i) => i.path)).toEqual(['name', 'title']);
    }
  });
});

describe('parseCapabilityDefinition — 规范化', () => {
  it('三类 kind 逐一解析通过(含 input/output),显式值原样保留', () => {
    for (const kind of ['transform', 'extract', 'effect'] as const) {
      const parsed = parseCapabilityDefinition({
        name: 'draft',
        title: '起草',
        kind,
        intent: '把意图变成候选草稿',
        input: '意图文本',
        output: '候选草稿集',
      });
      expect(parsed).toEqual({
        name: 'draft',
        title: '起草',
        kind,
        intent: '把意图变成候选草稿',
        input: '意图文本',
        output: '候选草稿集',
      });
    }
  });

  it('合法定义解析通过(不含 input/output)', () => {
    const parsed = parseCapabilityDefinition({
      name: 'notify',
      title: '通知',
      kind: 'effect',
      intent: '向人类发送确认请求',
    });
    expect(parsed.name).toBe('notify');
    expect(parsed.input).toBeUndefined();
    expect(parsed.output).toBeUndefined();
  });

  it('保留 exact Agent Definition ref，Provider 仍只属于部署 profile', () => {
    const parsed = parseCapabilityDefinition({
      name: 'coding.execute',
      title: '执行代码任务',
      kind: 'effect',
      intent: '运行特化 Coding Agent',
      executor: {
        class: 'coding-agent',
        profile: 'default',
        agentDefinition: 'coding-agent@1',
        requiredFeatures: ['resume'],
      },
    });

    expect(parsed.executor).toEqual({
      class: 'coding-agent',
      profile: 'default',
      agentDefinition: 'coding-agent@1',
      requiredFeatures: ['resume'],
    });
  });
});

describe('parseCapabilityDefinition — 拒绝非法定义', () => {
  it('非对象输入直接拒绝', () => {
    expect(() => parseCapabilityDefinition('not-a-capability')).toThrow(CapabilityParseError);
    expect(() => parseCapabilityDefinition(undefined)).toThrow(CapabilityParseError);
    expect(() => parseCapabilityDefinition(['draft'])).toThrow(CapabilityParseError);
  });

  it('name/title/kind/intent 缺失或为空字符串逐一被拒,issues 带对应 path', () => {
    const valid = { name: 'draft', title: '起草', kind: 'transform', intent: '生成草稿' };
    for (const field of ['name', 'title', 'kind', 'intent']) {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[field];
      const empty = { ...valid, [field]: '' };
      for (const input of [missing, empty]) {
        try {
          parseCapabilityDefinition(input);
          expect.unreachable('应当抛出 CapabilityParseError');
        } catch (error) {
          expect(error).toBeInstanceOf(CapabilityParseError);
          const issues = (error as CapabilityParseError).issues;
          expect(issues.some((i) => i.path === field)).toBe(true);
        }
      }
    }
  });

  it('非法 kind 拒绝(不在 transform/extract/effect 中)', () => {
    const valid = { name: 'draft', title: '起草', kind: 'transform', intent: '生成草稿' };
    for (const kind of ['explode', 'TRANSFORM', 42]) {
      expect(() => parseCapabilityDefinition({ ...valid, kind })).toThrow(/kind/);
    }
  });

  it('input/output 存在时必须是非空字符串', () => {
    const valid = { name: 'draft', title: '起草', kind: 'transform', intent: '生成草稿' };
    expect(() => parseCapabilityDefinition({ ...valid, input: '' })).toThrow(/input/);
    expect(() => parseCapabilityDefinition({ ...valid, input: 42 })).toThrow(/input/);
    expect(() => parseCapabilityDefinition({ ...valid, output: '' })).toThrow(/output/);
    expect(() => parseCapabilityDefinition({ ...valid, output: null })).toThrow(/output/);
  });

  it.each(['coding-agent', 'coding-agent@0', 'coding-agent@latest', '@1'])(
    '拒绝非 exact version Agent Definition ref: %s',
    (agentDefinition) => {
      expect(() =>
        parseCapabilityDefinition({
          name: 'coding.execute',
          title: '执行代码任务',
          kind: 'effect',
          intent: '运行特化 Coding Agent',
          executor: { class: 'coding-agent', profile: 'default', agentDefinition },
        }),
      ).toThrow(/agentDefinition/);
    },
  );

  it('拒绝 Application executor 中的 Provider/模型部署字段', () => {
    expect(() =>
      parseCapabilityDefinition({
        name: 'coding.execute',
        title: '执行代码任务',
        kind: 'effect',
        intent: '运行特化 Coding Agent',
        executor: {
          class: 'coding-agent',
          profile: 'default',
          agentDefinition: 'coding-agent@1',
          provider: 'codex',
        },
      }),
    ).toThrow(/executor.provider/);
  });

  it('CapabilityParseError 全量携带 issues,消息风格与 AppParseError 同构', () => {
    try {
      parseCapabilityDefinition({ name: '', kind: 'explode' });
      expect.unreachable('应当抛出 CapabilityParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityParseError);
      expect((error as CapabilityParseError).message).toContain('非法 capability 定义:');
      const issues = (error as CapabilityParseError).issues;
      expect(issues.map((i) => i.path)).toEqual(['name', 'title', 'kind', 'intent']);
    }
  });
});

// ---------------------------------------------------------------------------
// 集合面读面能力声明(T38 FR3):collections 过滤维度声明解析与语义校验。
// ---------------------------------------------------------------------------

describe('parseFlowDefinition — collections 过滤声明(T38)', () => {
  const commentFlowWithFilters = () => ({
    ...commentModerationFlow,
    collections: [{ collection: 'comments', filters: [{ field: 'status', title: '状态' }] }],
  });

  it('status 维度声明合法(值域由节点拓扑推导)', () => {
    expect(parseFlowDefinition(commentFlowWithFilters()).collections).toEqual([
      { collection: 'comments', filters: [{ field: 'status', title: '状态' }] },
    ]);
  });

  it('select 字段维度声明合法(值域由 options 推导)', () => {
    const categoryFlow = {
      ...postStatusFlow,
      fields: [{ name: 'category', type: 'select' as const, options: ['tech', 'essay'] }],
      collections: [{ collection: 'articles', filters: [{ field: 'category', title: '分类' }] }],
    };
    expect(parseFlowDefinition(categoryFlow).collections).toEqual([
      { collection: 'articles', filters: [{ field: 'category', title: '分类' }] },
    ]);
  });

  it('引用非 select / 未声明字段 → 拒绝(值域须可由流拓扑封闭推导)', () => {
    expect(() => parseFlowDefinition(commentFlowWithFilters())).not.toThrow();
    expect(() =>
      parseFlowDefinition({
        ...commentModerationFlow,
        collections: [{ collection: 'comments', filters: [{ field: 'body', title: '内容' }] }],
      }),
    ).toThrow(/body/);
  });

  it('形状非法:collection/field/title 空串、filters 非数组 → 拒绝', () => {
    expect(() =>
      parseFlowDefinition({
        ...commentModerationFlow,
        collections: [{ collection: '', filters: [] }],
      }),
    ).toThrow(/collection/);
    expect(() =>
      parseFlowDefinition({
        ...commentModerationFlow,
        collections: [{ collection: 'comments', filters: [{ field: 'status', title: '' }] }],
      }),
    ).toThrow(/title/);
    expect(() =>
      parseFlowDefinition({
        ...commentModerationFlow,
        collections: [{ collection: 'comments', filters: 'status' }],
      }),
    ).toThrow(/filters/);
  });
});

// ---------------------------------------------------------------------------
// 概览显示 hint(T38 FR4):presentation.overview 必须是 boolean。
// ---------------------------------------------------------------------------

describe('parseFlowDefinition — presentation.overview(T38 FR4)', () => {
  it('overview: true 合法保留', () => {
    const parsed = parseFlowDefinition({
      ...postStatusFlow,
      fields: [
        {
          name: 'title',
          type: 'text',
          title: '文章标题',
          presentation: { role: 'identity', overview: true },
        },
      ],
    });
    expect(parsed.fields?.[0]?.presentation).toEqual({ role: 'identity', overview: true });
  });

  it('overview 非布尔 → 拒绝(拒绝即教育)', () => {
    expect(() =>
      parseFlowDefinition({
        ...postStatusFlow,
        fields: [
          {
            name: 'title',
            type: 'text',
            presentation: { role: 'identity', overview: 'yes' },
          },
        ],
      }),
    ).toThrow(/overview/);
  });
});
