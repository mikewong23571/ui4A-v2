// @vitest-environment jsdom
/**
 * T40 Phase C 实体页深路径测试(F-02 状态词 / F-03 字段分层):EntityView
 * 消费同一合同数据源——h1 取实例身份、属性表状态行显示节点中文标题、
 * 字段区按 properties.presentation.fields 声明逐字段独立成行(合同 title),
 * 未声明/未填字段不渲染空壳;成员行 = 声明字段值 + 中文状态词。
 * 自 entity-view.test.tsx 拆出(GR3:每文件测试 ≤800 有效行)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { EntityView } from './entity-view';

afterEach(cleanup);

describe('EntityView:T40 实体页深路径(F-02 状态词 / F-03 字段分层)', () => {
  /** 形状与 /api/entity 实测 todo:v2 合同一致(identity/title/status/node 并存)。 */
  const todoEntity: SirenEntity = {
    class: ['flow-instance', 'todo-item'],
    properties: {
      rel: 'todo:v2',
      flow: 'todo-item',
      node: 'open',
      title: '进行中',
      identity: '修订走查报告 v2',
      status: 'open',
      fields: { title: '修订走查报告 v2', note: '补 chat 链路检查' },
      presentation: {
        fields: [
          { path: 'properties.fields.title', title: '待办标题', role: 'identity', overview: true },
          {
            path: 'properties.fields.note',
            title: '备注',
            role: 'primary-content',
            overview: true,
          },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=todo%3Av2' }],
    'guard-results': [],
  };

  function propertyRows(container: HTMLElement): string[][] {
    const section = container.querySelector('section[aria-label="属性"]');
    expect(section).not.toBeNull();
    return [...(section?.querySelectorAll('tr') ?? [])].map((tr) =>
      [...tr.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
    );
  }

  it('F-02:h1 取实例身份;状态行/成员状态词为节点中文标题;裸 node 枚举退守 raw 层', () => {
    const { container } = render(<EntityView rel="todo:v2" entity={todoEntity} />);

    // h1 = 实例身份(identity 优先于节点标题/rel)。
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('修订走查报告 v2');
    // 副标题保留 rel,节点机器词汇退守。
    expect(container.querySelector('p')?.textContent).toBe('todo:v2');
    expect(container.textContent).not.toContain('节点');
    // 属性表状态行 = 节点中文标题(任务语),与列表成员同源。
    expect(propertyRows(container)).toEqual(
      expect.arrayContaining([
        ['状态', '进行中'],
        ['rel', 'todo:v2'],
        ['flow', 'todo-item'],
        ['identity', '修订走查报告 v2'],
      ]),
    );
    const allRows = propertyRows(container);
    expect(allRows.some((row) => row[0] === 'node')).toBe(false);
    expect(container.textContent).not.toContain('open');
  });

  it('F-03:声明字段按合同 title 独立成行;未声明字段不渲染;T14 字典痕迹不出现', () => {
    const { container } = render(<EntityView rel="todo:v2" entity={todoEntity} />);

    expect(propertyRows(container)).toEqual(
      expect.arrayContaining([
        ['待办标题', '修订走查报告 v2'],
        ['备注', '补 chat 链路检查'],
      ]),
    );
    expect(screen.queryByText('文章标题')).toBeNull();
    expect(screen.queryByText('字段值')).toBeNull();
  });

  it('F-03:已声明未填字段不渲染空壳行', () => {
    const entity: SirenEntity = {
      ...todoEntity,
      properties: { ...todoEntity.properties, fields: { title: '修订走查报告 v2' } },
    };
    const { container } = render(<EntityView rel="todo:v2" entity={entity} />);

    expect(propertyRows(container)).toEqual(
      expect.arrayContaining([['待办标题', '修订走查报告 v2']]),
    );
    expect(container.textContent).not.toContain('备注');
  });

  it('F-02/F-03:集合成员行 = 声明字段值 + 中文状态词,备注不整段泄漏,无裸 node', () => {
    const collection: SirenEntity = {
      class: ['collection', 'todos'],
      properties: { rel: 'todos', title: '待办', count: 1 },
      actions: [],
      links: [],
      entities: [{ ...todoEntity, rel: ['item'], href: '/api/entity?rel=todo%3Av2' }],
      'guard-results': [],
    };
    const { container } = render(<EntityView rel="todos" entity={collection} />);

    const anchor = container.querySelector<HTMLAnchorElement>('a[data-rel="todo:v2"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toContain('修订走查报告 v2');
    expect(anchor!.textContent).toContain('补 chat 链路检查');
    expect(anchor!.textContent).toContain('进行中');
    expect(anchor!.textContent).not.toContain('open');
  });

  /** 形状与 /api/entity?rel=thread:weekly-report 实测合同一致(无 node,statusText/resume 为声明路径)。 */
  const threadEntity: SirenEntity = {
    class: ['work-thread', 'open'],
    properties: {
      rel: 'thread:weekly-report',
      identity: '产出本周 UI 周报',
      id: 'weekly-report',
      owner: 'local-user',
      goal: { text: '产出本周 UI 周报', source: 'chat:walkthrough' },
      status: 'open',
      statusText: '进行中',
      context: [],
      resume: '停在「进行中」',
      active: [],
      approval: [],
      'recent-events': [],
      presentation: {
        fields: [
          { path: 'properties.identity', title: '目标', role: 'identity' },
          { path: 'properties.statusText', title: '状态', role: 'status' },
          { path: 'properties.resume', title: '上次停在哪', role: 'primary-content' },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=thread%3Aweekly-report' }],
    'guard-results': [],
  };

  it('F-02/F-08:工作线实体——声明路径去重,裸 status/goal JSON/空壳数组退守 raw 层', () => {
    const { container } = render(<EntityView rel="thread:weekly-report" entity={threadEntity} />);

    const rows = propertyRows(container);
    // 声明行在场(合同 title,状态词为中文)。
    expect(rows).toEqual(
      expect.arrayContaining([
        ['目标', '产出本周 UI 周报'],
        ['状态', '进行中'],
        ['上次停在哪', '停在「进行中」'],
      ]),
    );
    // 状态行唯一(声明行),裸机器枚举/声明路径原文/JSON blob/空壳数组全部退守。
    expect(rows.filter((row) => row[0] === '状态')).toHaveLength(1);
    for (const retired of [
      'statusText',
      'resume',
      'goal',
      'context',
      'active',
      'approval',
      'recent-events',
    ]) {
      expect(rows.some((row) => row[0] === retired)).toBe(false);
    }
    expect(container.textContent).not.toContain('chat:walkthrough');
    expect(container.textContent).not.toContain('open');
  });
});
