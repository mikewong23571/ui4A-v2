// @vitest-environment jsdom
/**
 * BIOS 定义查看面(T4 Phase C Task 2;T13 Phase A 增拓扑区;Phase B 增版本历史区,
 * Task 2 增两版对比;spec 架构决定 7/1/2):
 * - meta/flow:<name>:拓扑区(只读图)+ 属性(name/version/status/initial/
 *   terminal)+ 节点表 + 动作表(name/to/guards/requires-confirmation/effect)+
 *   字段表——全部来自 Siren 投影,零业务分支、零 AI;
 * - meta/self 复用同一组件(definition-lifecycle 的状态机视图:拓扑 + 节点/动作
 *   表 + 种子 guard 集)。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { FlowDefinition, SirenEntity } from '@ui4a/engine';

import { stubBrowserApis } from '@/test/browser-stubs';

import { FlowDefinitionView } from './flow-definition-view';

// React Flow 在浏览器依赖 ResizeObserver/DOMMatrixReadOnly——jsdom 缺失,
// 统一注入极简 stub(同 flow 词条测试口径)。
stubBrowserApis();

// ---- fixtures(形状与 projectFlowDefinition / projectSelf 投影一致)---------

// T13 Phase B Task 2:版本子实体 properties.definition 内嵌全文——v1 → v2 的
// 机械差异覆盖三视角:added(v2 新增动作 pin)/ deleted(v1 的 retire 动作整组
// 删除)/ updated(标题修订)。
const postStatusV1: FlowDefinition = {
  name: 'post-status',
  title: '文章状态',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      title: '已发布',
      actions: [{ name: 'archive', title: '归档', to: 'archived' }],
    },
    {
      name: 'offline',
      title: '下线',
      actions: [{ name: 'retire', title: '退役', to: 'archived' }],
    },
  ],
};

const postStatusV2: FlowDefinition = {
  name: 'post-status',
  title: '文章状态(修订)',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      title: '已发布',
      actions: [
        { name: 'archive', title: '归档', to: 'archived' },
        { name: 'pin', title: '置顶', to: 'offline' },
      ],
    },
    { name: 'offline', title: '下线', actions: [] },
  ],
};

const postStatusEntity: SirenEntity = {
  class: ['meta', 'flow-definition'],
  properties: {
    name: 'post-status',
    // T35 S7.1:引擎投影现携带 flow 级 title(声明了才出现)——详情标题
    // 以业务标题为主,raw id 在副行(rel)。
    title: '文章状态',
    version: 2,
    status: 'active',
    initial: 'published',
    terminal: ['offline', 'archived'],
  },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/flow:post-status' }],
  'guard-results': [],
  entities: [
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'published', title: '已发布' },
      actions: [],
      links: [],
      entities: [
        {
          class: ['meta', 'action-definition'],
          rel: ['action'],
          properties: {
            name: 'archive',
            title: '归档',
            method: 'POST',
            to: 'archived',
            guards: [],
            'requires-confirmation': 'high',
            effect: [{ type: 'transition', to: 'archived' }],
            fields: [{ name: 'note', type: 'text', required: true, semantics: 'intent' }],
          },
          actions: [],
          links: [],
        },
      ],
    },
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'offline', title: '下线' },
      actions: [],
      links: [],
      entities: [],
    },
    // T13 Phase B:版本历史摘要子实体(与节点子实体同级,按 class 各表其区;
    // properties.definition 内嵌该版全文——两版对比(Task 2)的数据源;
    // 有意无 href:子实体 href 会进 agent 可导航候选)。
    {
      class: ['meta', 'definition-version'],
      rel: ['version'],
      properties: {
        version: 1,
        status: 'superseded',
        source: 'definition-seeded',
        definition: postStatusV1,
      },
      actions: [],
      links: [],
    },
    {
      class: ['meta', 'definition-version'],
      rel: ['version'],
      properties: {
        version: 2,
        status: 'active',
        source: 'definition-activated',
        activation: 'a2',
        'decided-by': { actor: 'human', principal: 'local-user' },
        definition: postStatusV2,
      },
      actions: [],
      links: [],
    },
  ],
};

const selfEntity: SirenEntity = {
  class: ['meta', 'flow-definition'],
  properties: {
    name: 'definition-lifecycle',
    version: 1,
    status: 'active',
    initial: 'draft',
    terminal: ['rejected', 'deprecated'],
    guards: ['is-draft', 'is-active', 'actor-is-human'],
  },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/self' }],
  'guard-results': [],
  entities: [
    {
      class: ['meta', 'node-definition'],
      rel: ['node'],
      properties: { name: 'pending-approval', title: '待批准' },
      actions: [],
      links: [],
      entities: [
        {
          class: ['meta', 'action-definition'],
          rel: ['action'],
          properties: {
            name: 'approve',
            title: '批准',
            method: 'POST',
            to: 'active',
            guards: ['actor-is-human'],
          },
          actions: [],
          links: [],
        },
      ],
    },
  ],
};

afterEach(cleanup);

describe('FlowDefinitionView(定义查看,纯文本表格)', () => {
  it('属性表:name/version/status/initial/terminal', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    expect(container.querySelector('h1')!.textContent).toBe('文章状态');
    const terminalRow = [...container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent === 'terminal',
    )!;
    expect(terminalRow.textContent).toContain('offline');
    expect(terminalRow.textContent).toContain('archived');
    const statusRow = [...container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent === 'status',
    )!;
    expect(statusRow.textContent).toContain('active');
  });

  it('底部生命周期动作区:修订可触发,废弃禁用原因取 guard-results 人话主句(T35 S7.3)', () => {
    const entity: SirenEntity = {
      ...postStatusEntity,
      actions: [
        {
          name: 'revise',
          title: '修订(开新草稿)',
          method: 'POST',
          href: '/_meta/api/exec',
          fields: {},
        },
        {
          name: 'deprecate',
          title: '废弃',
          method: 'POST',
          href: '/_meta/api/exec',
          fields: {},
        },
      ],
      'guard-results': [
        {
          action: 'deprecate',
          blocked: true,
          guards: [{ name: 'no-live-instances', pass: false }],
          reason: '仍有进行中的实例,不能删除该定义(guard 不满足: no-live-instances=false)',
        },
      ],
    };
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={entity} />,
    );
    const actionsSection = container.querySelector('#meta-actions-heading')?.closest('section');
    expect(actionsSection).not.toBeNull();
    expect(within(actionsSection!).getByRole('button', { name: /修订/ })).toBeTruthy();
    expect(within(actionsSection!).getByText(/仍有进行中的实例,不能删除该定义/)).toBeTruthy();
    const deprecateButton = within(actionsSection!)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('废弃'));
    expect(deprecateButton?.hasAttribute('disabled')).toBe(true);
  });

  it('节点表与动作表:节点标题、动作 to/guards/requires-confirmation/effect 可见', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    // 节点行(限定节点表段:拓扑区同现节点 title,段外不查)。
    const nodeSection = container.querySelector<HTMLElement>('section[aria-label="节点"]')!;
    expect(within(nodeSection).getByText('已发布')).toBeTruthy();
    expect(within(nodeSection).getByText('下线')).toBeTruthy();
    // 动作行(按动作名格精确定位,不与属性表 terminal 相混):archive → archived,
    // guards 空数组,requires-confirmation=high,effect 原文。
    const row = [...container.querySelectorAll('tr')].find((tr) =>
      [...tr.querySelectorAll('td')].some((td) => td.textContent === 'archive'),
    )!;
    expect(row.textContent).toContain('archived');
    expect(row.textContent).toContain('[]');
    expect(row.textContent).toContain('high');
    expect(row.textContent).toContain('"type":"transition"');
  });

  it('字段表:动作字段(name/type/required/semantics)逐行可见', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const row = [...container.querySelectorAll('tr')].find(
      (tr) => tr.textContent?.includes('note') === true,
    )!;
    expect(row.textContent).toContain('text');
    expect(row.textContent).toContain('intent');
  });

  it('拓扑区(T13 Phase A):表格之上的只读拓扑图,节点 title 可见', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const topology = container.querySelector<HTMLElement>('section[aria-label="拓扑"]')!;
    expect(topology).not.toBeNull();
    expect(topology.querySelector('[data-topology="flow"]')).not.toBeNull();
    // 节点 title 出现于拓扑区(jsdom 无测量、边不真实渲染;边/只读口径见
    // flow-topology-view.test.tsx,真实浏览器渲染由 e2e 覆盖)。
    expect(topology.textContent).toContain('已发布');
    expect(topology.textContent).toContain('下线');
    // 视觉层级:拓扑区在属性表之前(spec 架构决定 1「既有表格之上」)。
    const sections = [...container.querySelectorAll('section')].map((section) =>
      section.getAttribute('aria-label'),
    );
    expect(sections.indexOf('拓扑')).toBeLessThan(sections.indexOf('属性'));
  });

  it('meta/self 复用:状态机文本视图 + 种子 guard 集(approve 声明 actor-is-human)', () => {
    const { container } = render(<FlowDefinitionView rel="meta/self" entity={selfEntity} />);
    expect(container.querySelector('h1')!.textContent).toBe('definition-lifecycle');
    const initialRow = [...container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent === 'initial',
    )!;
    expect(initialRow.textContent).toContain('draft');
    // 种子 guard 集(属性表)与动作声明(guards 列)两处可见。
    expect(screen.getAllByText(/actor-is-human/).length).toBeGreaterThanOrEqual(2);
    // 节点 title(限定节点表段:拓扑区同现,段外不查)。
    const nodeSection = container.querySelector<HTMLElement>('section[aria-label="节点"]')!;
    expect(within(nodeSection).getByText('待批准')).toBeTruthy();
    // meta/self 同形投影:拓扑区同样渲染(definition-lifecycle 节点 title)。
    const topology = container.querySelector<HTMLElement>('section[aria-label="拓扑"]')!;
    expect(topology.textContent).toContain('待批准');
  });

  it('版本历史区(T13 Phase B):版本号/状态徽标/来源,按版本序排列', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const section = container.querySelector<HTMLElement>('section[aria-label="版本历史"]')!;
    expect(section).not.toBeNull();
    const rows = [...section.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    // v1:superseded,来源种子(definition-seeded)。
    expect(rows[0]!.textContent).toContain('v1');
    expect(rows[0]!.textContent).toContain('superseded');
    expect(rows[0]!.textContent).toContain('种子');
    // v2:active 徽标,来源激活事件(激活 id + 审批者)。
    expect(rows[1]!.textContent).toContain('v2');
    expect(rows[1]!.textContent).toContain('active');
    expect(rows[1]!.textContent).toContain('激活 a2');
    expect(rows[1]!.textContent).toContain('human');
  });

  it('版本子实体不泄进节点表/动作表(按 class 各表其区)', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    // 节点表计数与行仍只是真实节点(版本子实体混入前为 2)。
    const nodeSection = container.querySelector<HTMLElement>('section[aria-label="节点"]')!;
    expect(nodeSection.querySelector('h2')!.textContent).toBe('节点(2)');
    expect(nodeSection.querySelectorAll('tbody tr')).toHaveLength(2);
    // 动作表只有 archive 一行(v1/v2 版本行不得出现)。
    const actionSection = container.querySelector<HTMLElement>('section[aria-label="动作"]')!;
    expect(actionSection.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('meta/self:无版本历史区(lifecycle 引擎常量自举,无 definitionVersions)', () => {
    const { container } = render(<FlowDefinitionView rel="meta/self" entity={selfEntity} />);
    expect(container.querySelector('section[aria-label="版本历史"]')).toBeNull();
  });
});

describe('版本两版对比(T13 Phase B Task 2;spec 架构决定 2 后半)', () => {
  // 单版本投影(种子态,只有 v1):版本区有表,但无可比对的第二版。
  const singleVersionEntity: SirenEntity = {
    ...postStatusEntity,
    entities: (postStatusEntity.entities ?? []).filter(
      (sub) => !(sub.class.includes('definition-version') && sub.properties.version === 2),
    ),
  };

  /** 版本历史区内的 diff 单元格文本(unified 行的 +/- 两侧,同 diff-render 测试口径)。 */
  function diffCells(section: HTMLElement, selector: string): string {
    return [...section.querySelectorAll(selector)].map((node) => node.textContent ?? '').join('\n');
  }

  it('对比入口:基线/对比两个下拉,选项为版本号;未选齐两版不出 diff', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const section = container.querySelector<HTMLElement>('section[aria-label="版本历史"]')!;
    const base = within(section).getByLabelText('基线版本');
    const candidate = within(section).getByLabelText('对比版本');
    expect(
      within(base)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['选择版本', 'v1', 'v2']);
    expect(
      within(candidate)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['选择版本', 'v1', 'v2']);
    // 初始未选择:不渲染 diff。
    expect(section.querySelector('[data-bios="diff"]')).toBeNull();
  });

  it('选 v1×v2:机械 diff 三视角(added 含新动作 pin/deleted 含 retire/updated 标题成对)', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const section = container.querySelector<HTMLElement>('section[aria-label="版本历史"]')!;
    fireEvent.change(within(section).getByLabelText('基线版本'), { target: { value: '1' } });
    fireEvent.change(within(section).getByLabelText('对比版本'), { target: { value: '2' } });
    expect(section.querySelector('[data-bios="diff"]')).not.toBeNull();
    const inserts = diffCells(section, '.diff-code-insert');
    const deletes = diffCells(section, '.diff-code-delete');
    // added 视角:v2 新增动作 pin 的逐字段路径与值。
    expect(inserts).toContain('nodes[0].actions[1].name = "pin"');
    expect(inserts).toContain('nodes[0].actions[1].title = "置顶"');
    // deleted 视角:v1 的 retire 动作整组删除(数组级删除行,旧值从 v1 全文取回)。
    expect(deletes).toContain('nodes[1].actions');
    expect(deletes).toContain('"name":"retire"');
    // updated 视角:标题新旧值成对(- 旧值 / + 新值)。
    expect(deletes).toContain('title = "文章状态"');
    expect(inserts).toContain('title = "文章状态(修订)"');
  });

  it('同版对比(v1×v1)不出 diff(对比须为两个不同版本)', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={postStatusEntity} />,
    );
    const section = container.querySelector<HTMLElement>('section[aria-label="版本历史"]')!;
    fireEvent.change(within(section).getByLabelText('基线版本'), { target: { value: '1' } });
    fireEvent.change(within(section).getByLabelText('对比版本'), { target: { value: '1' } });
    expect(section.querySelector('[data-bios="diff"]')).toBeNull();
  });

  it('单版本:版本表仍在,但无对比入口(下拉不出现)', () => {
    const { container } = render(
      <FlowDefinitionView rel="meta/flow:post-status" entity={singleVersionEntity} />,
    );
    const section = container.querySelector<HTMLElement>('section[aria-label="版本历史"]')!;
    expect(section).not.toBeNull();
    expect([...section.querySelectorAll('tbody tr')]).toHaveLength(1);
    expect(within(section).queryByLabelText('基线版本')).toBeNull();
    expect(within(section).queryByLabelText('对比版本')).toBeNull();
  });
});
