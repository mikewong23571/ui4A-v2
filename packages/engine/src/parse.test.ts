import { describe, expect, it } from 'vitest';

import { articleDraftingFlow, minimalFlow, postStatusFlow } from './fixtures';
import { FlowParseError, parseFlowDefinition, validateFlowDefinition } from './parse';
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
    expect(() =>
      parseFlowDefinition(flowWith(minimalFlow, (d) => (d.initial = 'zzz'))),
    ).toThrow(/initial/);
  });

  it('重复节点名拒绝', () => {
    expect(() =>
      parseFlowDefinition(
        flowWith(minimalFlow, (d) => (d.nodes[1].name = 'a')),
      ),
    ).toThrow(/重复/);
  });

  it('action.to 指向不存在的节点拒绝', () => {
    expect(() =>
      parseFlowDefinition(
        flowWith(minimalFlow, (d) => (d.nodes[0].actions[0].to = 'ghost')),
      ),
    ).toThrow(/to/);
  });

  it('未知 effect 类型拒绝', () => {
    expect(() =>
      parseFlowDefinition(
        flowWith(minimalFlow, (d) => ((d.nodes[0].actions[0] as { effect: unknown }).effect = [{ type: 'explode' }])),
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
        flowWith(articleDraftingFlow, (d) => d.nodes[0].fields?.push({ name: 'title', type: 'text' })),
      ),
    ).toThrow(/重复/);
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

describe('validateFlowDefinition(已类型化定义的语义校验)', () => {
  it('对三个种子 flow 返回空 issue 列表', () => {
    expect(validateFlowDefinition(articleDraftingFlow)).toEqual([]);
    expect(validateFlowDefinition(postStatusFlow)).toEqual([]);
  });

  it('spawn effect 缺 capability 报 issue', () => {
    const issues = validateFlowDefinition(
      flowWith(minimalFlow, (d) => ((d.nodes[0].actions[0] as { effect: unknown }).effect = { type: 'spawn' })),
    );
    expect(issues.some((i) => i.path.includes('capability'))).toBe(true);
  });
});
