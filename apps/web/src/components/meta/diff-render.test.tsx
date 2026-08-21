// @vitest-environment jsdom
/**
 * 机械 diff 内建渲染(T4 Phase C Task 2;铁律 5"审计渲染路径零 AI")。
 *
 * - 输入是结构化 diff 纯数据(DefinitionDiff:deep-object-diff 三视角 + 前后全文),
 *   经 JSON 往返的纯数据即可渲染(证明输入与渲染器解耦、可来自日志重放);
 * - react-diff-view 呈现 before/after:新增行(绿)含新增动作、删除行(红)含旧值、
 *   更新行成对(- 旧值 / + 新值);
 * - 数组语义:数组按下标比对,删除数组元素时 diff 树留空对象标记——渲染器从
 *   before/after 按路径机械取值(零 AI,无任何推断);
 * - 源级断言:BIOS 渲染路径(diff-render/activation-view/meta-client/
 *   flow-definition-view)不 import 任何 AI/LLM/agent 模块。
 */
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import type { DefinitionDiff, FlowDefinition } from '@ui4a/engine';

import { DefinitionDiffView } from './diff-render';

const beforeDefinition: FlowDefinition = {
  name: 'article-drafting',
  title: '文章发布向导',
  initial: 'basic-info',
  nodes: [
    {
      name: 'ready',
      title: '就绪',
      actions: [{ name: 'publish', title: '发布', to: 'done' }],
    },
  ],
};

const afterDefinition: FlowDefinition = {
  name: 'article-drafting',
  title: '文章发布向导(v2)',
  initial: 'basic-info',
  nodes: [
    {
      name: 'ready',
      title: '就绪',
      actions: [
        { name: 'publish', title: '发布', to: 'done' },
        { name: 'pin', title: '置顶', to: 'done', guards: [] },
      ],
    },
  ],
};

/** 与引擎 definitionDiff 输出同构的纯数据 fixture(含数组删除标记场景)。 */
function diffFixture(): DefinitionDiff {
  return {
    algorithm: 'deep-object-diff',
    before: beforeDefinition,
    after: afterDefinition,
    changed: {
      added: {
        nodes: { 0: { actions: { 1: { name: 'pin', title: '置顶', to: 'done', guards: [] } } } },
      },
      // 数组元素删除:deep-object-diff 对数组按下标比对,被删下标留空对象标记。
      deleted: { nodes: { 0: { actions: {} } } },
      updated: { title: '文章发布向导(v2)' },
    },
  };
}

afterEach(cleanup);

describe('DefinitionDiffView(纯数据 → react-diff-view 组件树)', () => {
  it('JSON 往返的纯数据即可渲染(输入与渲染器解耦,可来自日志重放)', () => {
    const { container } = render(
      <DefinitionDiffView diff={JSON.parse(JSON.stringify(diffFixture()))} />,
    );
    expect(container.querySelector('table.diff')).not.toBeNull();
  });

  it('新增行(绿)呈现新增动作 pin 的逐字段路径与值', () => {
    const { container } = render(<DefinitionDiffView diff={diffFixture()} />);
    const inserts = [...container.querySelectorAll('.diff-code-insert')].map(
      (node) => node.textContent ?? '',
    );
    expect(inserts.join('\n')).toContain('nodes[0].actions[1].name = "pin"');
    expect(inserts.join('\n')).toContain('nodes[0].actions[1].title = "置顶"');
    expect(inserts.join('\n')).toContain('nodes[0].actions[1].guards = []');
  });

  it('更新行成对:- 行含旧值(before 按路径取),+ 行含新值', () => {
    const { container } = render(<DefinitionDiffView diff={diffFixture()} />);
    const deletes = [...container.querySelectorAll('.diff-code-delete')].map(
      (node) => node.textContent ?? '',
    );
    const inserts = [...container.querySelectorAll('.diff-code-insert')].map(
      (node) => node.textContent ?? '',
    );
    expect(deletes.join('\n')).toContain('title = "文章发布向导"');
    expect(inserts.join('\n')).toContain('title = "文章发布向导(v2)"');
  });

  it('数组删除标记:从 before 机械取回被删子树(publish 动作可见于 - 行)', () => {
    const { container } = render(<DefinitionDiffView diff={diffFixture()} />);
    const deletes = [...container.querySelectorAll('.diff-code-delete')].map(
      (node) => node.textContent ?? '',
    );
    // 空对象标记路径 nodes[0].actions → 旧值整个数组(含 publish)呈现于删除行。
    expect(deletes.join('\n')).toContain('nodes[0].actions');
    expect(deletes.join('\n')).toContain('"name":"publish"');
  });

  it('无差异:不渲染 diff 表,呈现全等提示', () => {
    const { container } = render(
      <DefinitionDiffView
        diff={{
          algorithm: 'deep-object-diff',
          before: beforeDefinition,
          after: beforeDefinition,
          changed: { added: {}, deleted: {}, updated: {} },
        }}
      />,
    );
    expect(container.querySelector('table.diff')).toBeNull();
    expect(container.textContent).toContain('无差异');
  });
});

describe('铁律 5:BIOS 渲染路径零 AI(源级断言)', () => {
  const RENDER_PATH_SOURCES = [
    'diff-render.tsx',
    'activation-view.tsx',
    'flow-definition-view.tsx',
    'meta-client.ts',
  ];

  it('渲染路径源文件不 import 任何 AI/LLM/agent 模块', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const AI_IMPORT_PATTERN =
      /from\s+['"]([^'"]*(?:@ai-sdk|openai|@anthropic-ai|@ui4a\/agent|generateText|llm-driver)[^'"]*)['"]/;
    for (const name of RENDER_PATH_SOURCES) {
      const source = readFileSync(join(dir, name), 'utf8');
      expect(source, `${name} 引入了 AI/LLM/agent 模块`).not.toMatch(AI_IMPORT_PATTERN);
    }
  });
});
