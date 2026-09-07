import { describe, expect, it } from 'vitest';

import {
  ideasApplicationBundle,
  todoApplicationBundle,
  walkthroughApplicationBundle,
} from './bundles';

describe('walkthrough application entries', () => {
  it('parses structured default entries for every installed application scope', () => {
    expect(
      Object.fromEntries(
        walkthroughApplicationBundle.applications.map(({ name, entry }) => [name, entry]),
      ),
    ).toEqual({
      default: undefined,
      publishing: { target: 'flow:article-drafting', role: 'primary-create' },
      community: { target: 'comments', role: 'primary-collection' },
      development: { target: 'flow:software-change', role: 'primary-task' },
      editorial: { target: 'flow:writing-request', role: 'primary-task' },
      governance: { target: 'flow:agent-definition-authoring', role: 'primary-task' },
    });
  });

  it('keeps direct bundle versions aligned with changed installed declaration data', () => {
    expect(todoApplicationBundle.bundle).toEqual({ name: 'todo', version: 9 });
    expect(ideasApplicationBundle.bundle).toEqual({ name: 'ideas', version: 8 });

    expect(todoApplicationBundle.flows.find(({ name }) => name === 'todo-item')).toMatchObject({
      collections: [{ collection: 'todos', filters: [{ field: 'status' }] }],
      cognitive: { version: 1, traits: ['work-queue'], emptyMeaning: 'ready-to-start' },
      fields: [
        { name: 'title', presentation: { role: 'identity', overview: true } },
        { name: 'note', presentation: { role: 'primary-content', overview: true } },
      ],
    });
    expect(ideasApplicationBundle.flows.find(({ name }) => name === 'idea-item')).toMatchObject({
      collections: [{ collection: 'ideas', filters: [{ field: 'status' }] }],
      cognitive: { version: 1, traits: ['work-queue'], emptyMeaning: 'ready-to-start' },
      fields: [
        { name: 'title', presentation: { role: 'identity', overview: true } },
        { name: 'insight', presentation: { role: 'primary-content', overview: true } },
      ],
    });
  });

  it('G09 捕捉输入不认领向导实例身份:呈现角色降为 metadata,身份回退声明的流程任务标题', () => {
    // 捕捉节点输入是「正在新建」的动作输入,不是向导实例的身份;role=identity 会
    // 让上一轮残留的产物名顶替区域标题。产物身份由产物流(todo-item/idea-item)
    // 的流级字段声明携带(上例钉住),流程任务身份由投影回退 flow.title 承载。
    for (const bundle of [todoApplicationBundle, ideasApplicationBundle]) {
      const captureNode = bundle.flows
        .find(({ name }) => name.endsWith('-capture'))!
        .nodes.find(({ name }) => name === 'capture')!;
      const titleField = (captureNode.fields ?? []).find(({ name }) => name === 'title');
      expect(titleField?.presentation).toEqual({ role: 'metadata' });
    }
  });
});
